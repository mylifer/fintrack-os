import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Account, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   accounts.store — silme kaskadı ve bakiye türetimi

   Hesap silme, uygulamanın en geniş kaskadı: bağlı işlemler tombstone'lanır,
   borç ödemeleri geri alınır, tekrarlayan şablonlar silinir, yatırım
   referansları temizlenir. Bu kaskadın borç ayağı KALICI bir sütunu
   (debts.paidAmount) değiştirdiği için bir hatası veriyi kalıcı bozar —
   denetim öncesi bu dosyanın hiç testi yoktu.

   Dexie/sync/diğer store'lar mock'lanır; test store'un KARARINI doğrular:
   hangi işlemler için revertPayment çağrılıyor.
──────────────────────────────────────────────────────────────────────── */

// Dexie'deki HAM tablo — tombstone'lu satırlar da burada durur (silinmez).
let dexieTransactions: Transaction[] = []

vi.mock('@/lib/db', () => ({
  db: {
    transactions: {
      filter: (fn: (t: Transaction) => boolean) => ({
        toArray: async () => dexieTransactions.filter(fn),
      }),
    },
    accounts: { toArray: async () => [] },
  },
}))

const batches: unknown[][] = []
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localPatch: async () => {},
  localBatch: async (ops: unknown[]) => { batches.push(ops) },
  reconcilingPull: async () => [],
}))

// revertPayment çağrılarını kaydet — testin asıl gözlemi bu.
const revertCalls: { debtId: string; amount: number }[] = []
vi.mock('./debts.store', () => ({
  useDebtStore: {
    getState: () => ({
      debts: [],
      update: async () => {},
      revertPayment: async (debtId: string, amount: number) => { revertCalls.push({ debtId, amount }) },
    }),
  },
}))

vi.mock('./recurring.store', () => ({
  useRecurringStore: { getState: () => ({ recurring: [], remove: async () => {} }) },
}))

vi.mock('./investment.store', () => ({
  useInvestmentStore: { getState: () => ({ transactions: [] }), setState: () => {} },
}))

const storeTransactions: { transactions: Transaction[] } = { transactions: [] }
vi.mock('./transactions.store', () => ({
  useTransactionStore: {
    getState: () => storeTransactions,
    setState: (patch: { transactions: Transaction[] }) => { storeTransactions.transactions = patch.transactions },
  },
}))

const { useAccountStore } = await import('./accounts.store')

function acc(id: string, initialBalance = 0, currency: Account['currency'] = 'TRY'): Account {
  return {
    id, name: id, type: 'checking', currency, balance: 0, initialBalance,
    color: '#000', isArchived: false, createdAt: '2026-01-01',
  }
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'accountId'>): Transaction {
  return {
    currency: 'TRY', date: '2026-03-01', description: p.id, isInstallment: false,
    createdAt: '2026-03-01', updatedAt: '2026-03-01', ...p,
  }
}

beforeEach(() => {
  dexieTransactions = []
  batches.length = 0
  revertCalls.length = 0
  storeTransactions.transactions = []
  useAccountStore.setState({ accounts: [], loading: false, ready: true })
})

describe('recomputeBalances', () => {
  it('bakiyeyi initialBalance + işlem etkisi olarak türetir', () => {
    useAccountStore.setState({ accounts: [acc('a', 1_000)] })
    useAccountStore.getState().recomputeBalances([
      tx({ id: 't1', type: 'income',  amount: 500, accountId: 'a' }),
      tx({ id: 't2', type: 'expense', amount: 200, accountId: 'a' }),
    ])
    expect(useAccountStore.getState().accounts[0].balance).toBe(1_300)
  })

  it('gelecek tarihli ve onay bekleyen işlemleri bakiyeye katmaz', () => {
    useAccountStore.setState({ accounts: [acc('a', 1_000)] })
    useAccountStore.getState().recomputeBalances([
      tx({ id: 'gelecek', type: 'expense', amount: 999, accountId: 'a', date: '2099-01-01' }),
      tx({ id: 'bekleyen', type: 'expense', amount: 888, accountId: 'a', approvalStatus: 'pending' }),
    ])
    expect(useAccountStore.getState().accounts[0].balance).toBe(1_000)
  })

  it('transferi iki hesapta da hareket ettirir', () => {
    useAccountStore.setState({ accounts: [acc('a', 1_000), acc('b', 0)] })
    useAccountStore.getState().recomputeBalances([
      tx({ id: 't1', type: 'transfer', amount: 400, accountId: 'a', toAccountId: 'b' }),
    ])
    const [a, b] = useAccountStore.getState().accounts
    expect(a.balance).toBe(600)
    expect(b.balance).toBe(400)
  })
})

describe('remove — kaskad', () => {
  it('hesabı ve bağlı işlemleri TEK atomik blokta tombstone\'lar', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [tx({ id: 't1', type: 'expense', amount: 100, accountId: 'a' })]
    storeTransactions.transactions = [...dexieTransactions]

    await useAccountStore.getState().remove('a')

    expect(batches).toHaveLength(1)   // C5: yarım commit yok
    const ops = batches[0] as { table: string; ids?: string[]; id?: string }[]
    expect(ops.map(o => o.table)).toEqual(['transactions', 'accounts'])
    expect(ops[0].ids).toEqual(['t1'])
  })

  it('transferin karşı bacağını da kapsar (toAccountId eşleşmesi)', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [tx({ id: 'gelen', type: 'transfer', amount: 100, accountId: 'b', toAccountId: 'a' })]

    await useAccountStore.getState().remove('a')

    const ops = batches[0] as { ids?: string[] }[]
    expect(ops[0].ids).toEqual(['gelen'])
  })

  it('çalışma alanları arası transferin karşı bacağını da tombstone\'lar', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [
      tx({ id: 'giden',   type: 'expense', amount: 100, accountId: 'a', workspaceTransferId: 'x1' }),
      tx({ id: 'gelen',   type: 'income',  amount: 100, accountId: 'diger-alan', workspaceTransferId: 'x1' }),
      tx({ id: 'ilgisiz', type: 'income',  amount: 5,   accountId: 'diger-alan' }),
      tx({ id: 'olu',     type: 'income',  amount: 100, accountId: 'diger-alan', workspaceTransferId: 'x1', deleted_at: '2026-03-02T00:00:00Z' }),
    ]

    await useAccountStore.getState().remove('a')

    const ops = batches[0] as { ids?: string[] }[]
    expect(ops[0].ids).toEqual(['giden', 'gelen'])
  })

  it('CANLI borç ödemesini tam olarak bir kez geri alır', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [tx({ id: 'odeme', type: 'transfer', amount: 3_000, accountId: 'a', debtId: 'd1', amountTry: 3_000 })]

    await useAccountStore.getState().remove('a')

    expect(revertCalls).toEqual([{ debtId: 'd1', amount: 3_000 }])
  })

  it('borca bağlı OLMAYAN işlemler için revertPayment çağırmaz', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [tx({ id: 't1', type: 'expense', amount: 100, accountId: 'a' })]

    await useAccountStore.getState().remove('a')
    expect(revertCalls).toHaveLength(0)
  })

  it('hesabı store\'dan ve işlemlerini işlem store\'undan düşürür', async () => {
    useAccountStore.setState({ accounts: [acc('a'), acc('b')] })
    storeTransactions.transactions = [
      tx({ id: 't1', type: 'expense', amount: 100, accountId: 'a' }),
      tx({ id: 't2', type: 'expense', amount: 100, accountId: 'b' }),
    ]

    await useAccountStore.getState().remove('a')

    expect(useAccountStore.getState().accounts.map(a => a.id)).toEqual(['b'])
    expect(storeTransactions.transactions.map(t => t.id)).toEqual(['t2'])
  })
})

/* ── Zaten silinmiş işlemin borç ödemesi ──────────────────────────────────
   Denetim bulgusu #4. remove() bağlı işlemleri Dexie'den çekerken `isLive`
   filtresi UYGULAMIYOR (accounts.store.ts:63-66). Dexie tombstone'lu satırları
   tutmaya devam ettiği için, daha önce SİLİNMİŞ (ve o an zaten geri alınmış)
   bir borç ödemesi ikinci kez revertPayment'tan geçiyor.

   debts.store.revertPayment `Math.max(0, …)` ile kırptığı için basit vakada
   sonuç değişmiyor — hata bu yüzden gözden kaçmış. Borcun BAŞKA bir hesaptan
   yapılmış canlı ödemesi varsa clamp devreye girmiyor ve paidAmount gerçek
   değerinin altına düşüyor: kalan borç şişiyor, Net Varlık eksik görünüyor.
   debts.paidAmount KALICI bir sütun olduğu için bozulma buluta da yayılıyor.

   İlk test hatayı doğrudan gösteriyor (`it.fails`); ikincisi kırpmanın niçin
   maskelediğini kayda geçiriyor. Düzeltme: sorguya `.filter(isLive)` eklemek.
──────────────────────────────────────────────────────────────────────── */
describe('tombstone\'lu borç ödemesi — düzeltilen hata #4', () => {
  it('zaten silinmiş bir ödeme için revertPayment TEKRAR çağrılmamalı', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [
      // Kullanıcı bu ödemeyi daha önce sildi → o an revertPayment ZATEN çalıştı
      tx({ id: 'silinmis', type: 'transfer', amount: 3_000, accountId: 'a', debtId: 'd1', deleted_at: '2026-03-02T00:00:00Z' }),
    ]

    await useAccountStore.getState().remove('a')

    expect(revertCalls).toHaveLength(0)
  })

  it('canlı + silinmiş ödeme birlikteyken YALNIZCA canlı olan geri alınır', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [
      tx({ id: 'silinmis', type: 'transfer', amount: 3_000, accountId: 'a', debtId: 'd1', deleted_at: '2026-03-02T00:00:00Z' }),
      tx({ id: 'canli',    type: 'transfer', amount: 4_000, accountId: 'a', debtId: 'd1' }),
    ]

    await useAccountStore.getState().remove('a')

    // Düzeltme öncesi 7.000 geri alınıyordu (3.000 fazla) ve kalan borç şişiyordu.
    expect(revertCalls).toEqual([{ debtId: 'd1', amount: 4_000 }])
  })

  it('tombstone\'lu satır tombstone patch\'ine de dahil edilmez', async () => {
    useAccountStore.setState({ accounts: [acc('a')] })
    dexieTransactions = [
      tx({ id: 'canli',    type: 'expense', amount: 100, accountId: 'a' }),
      tx({ id: 'silinmis', type: 'expense', amount: 100, accountId: 'a', deleted_at: '2026-03-02T00:00:00Z' }),
    ]

    await useAccountStore.getState().remove('a')

    const ops = batches[0] as { ids?: string[] }[]
    expect(ops[0].ids).toEqual(['canli'])   // zaten ölü satır yeniden damgalanmaz
  })
})
