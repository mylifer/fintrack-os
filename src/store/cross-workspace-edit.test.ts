import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Account, Debt, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Çalışma alanları arası transferi DÜZENLEME (updateCrossWorkspaceTransfer)
   ve bağı koparma (detachCrossWorkspaceTransfer). Kurulum
   cross-workspace-debt.test.ts ile aynı; aşağıdaki açıklama oradan.

   Çalışma alanları arası transferle borç ödemesi

   Kaynak alandaki hesaptan, BAŞKA bir alandaki borç ödenir. Üç satır doğar:
     1. kaynak alan  — 'expense' (kaynak hesaptan çıkış)
     2. hedef alan   — 'income'  (ara hesaba giriş)
     3. hedef alan   — debtId'li 'transfer' (ara hesaptan borç ödemesi)
   Üçü de aynı workspaceTransferId'yi taşır. Borç hedef alana ait olduğundan
   bellekteki borç listesinde YOKTUR — paidAmount yaması Dexie'deki borçtan
   hesaplanıp aynı atomik localBatch'e girmelidir; silme de geri almalıdır.
──────────────────────────────────────────────────────────────────────── */

let dexieTransactions: Transaction[] = []
let dexieAccounts: Account[] = []
let dexieDebts: Debt[] = []
let activeId = 'ws-a'
const patches: { table: string; id: string; patch: Record<string, unknown> }[] = []
const batches: { kind: string; table: string; id?: string; ids?: string[]; entity?: Transaction; patch?: Record<string, unknown> }[][] = []

vi.mock('@/lib/db', () => ({
  db: {
    transactions: {
      toArray: async () => dexieTransactions,
      where: (field: keyof Transaction) => ({
        equals: (value: unknown) => ({
          toArray: async () => dexieTransactions.filter(t => t[field] === value),
        }),
      }),
    },
    accounts: { get: async (id: string) => dexieAccounts.find(a => a.id === id) },
    debts: {
      get: async (id: string) => dexieDebts.find(d => d.id === id),
      bulkGet: async (ids: string[]) => ids.map(id => dexieDebts.find(d => d.id === id)),
    },
  },
}))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))

// localBatch, Dexie'yi de günceller ki silme akışı karşı bacakları bulabilsin.
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localBulkUpsert: async () => {},
  localPatch: async (table: string, id: string, patch: Record<string, unknown>) => {
    patches.push({ table, id, patch })
    if (table === 'transactions') dexieTransactions = dexieTransactions.map(t => t.id === id ? { ...t, ...patch } : t)
  },
  softDelete: async () => {},
  softDeleteMany: async () => {},
  reconcilingPull: async () => [],
  localBatch: async (ops: typeof batches[number]) => {
    batches.push(ops)
    for (const op of ops) {
      if (op.kind === 'upsert' && op.table === 'transactions') dexieTransactions = [...dexieTransactions.filter(t => t.id !== op.entity!.id), op.entity!]
      if (op.kind === 'patchMany' && op.table === 'transactions') {
        dexieTransactions = dexieTransactions.map(t => op.ids!.includes(t.id) ? { ...t, ...op.patch } : t)
      }
      if (op.kind === 'patch' && op.table === 'transactions') {
        dexieTransactions = dexieTransactions.map(t => t.id === op.id ? { ...t, ...op.patch } : t)
      }
      if (op.kind === 'patch' && op.table === 'debts') {
        dexieDebts = dexieDebts.map(d => d.id === op.id ? { ...d, ...op.patch } : d)
      }
    }
  },
}))

vi.mock('./accounts.store', () => ({
  useAccountStore: {
    getState: () => ({
      recomputeBalances: () => {},
      accounts: [account('kaynak', 'ws-a'), account('kaynak-usd', 'ws-a', 'USD')],
    }),
  },
}))

vi.mock('./workspace.store', () => ({
  useWorkspaceStore: { getState: () => ({ activeId }) },
}))

const { useTransactionStore } = await import('./transactions.store')
const { useDebtStore } = await import('./debts.store')

function account(id: string, workspaceId: string, currency = 'TRY'): Account {
  return {
    id, name: id, type: 'checking', currency: currency as Account['currency'], balance: 0, initialBalance: 0,
    color: '#000', isArchived: false, createdAt: '2026-01-01', workspaceId,
  }
}

function debt(p: Partial<Debt> = {}): Debt {
  return {
    id: 'borc', name: 'Kredi', type: 'loan', direction: 'owe', totalAmount: 10_000,
    paidAmount: 2_000, paidInstallments: 2, startDate: '2026-01-01', isSettled: false,
    createdAt: '2026-01-01', workspaceId: 'ws-b', ...p,
  } as Debt
}

beforeEach(() => {
  batches.length = 0
  activeId = 'ws-a'
  patches.length = 0
  dexieTransactions = []
  dexieAccounts = [account('kaynak', 'ws-a'), account('ara', 'ws-b'), account('ara2', 'ws-b'), account('c-hesap', 'ws-c')]
  dexieDebts = [debt()]
  useTransactionStore.setState({ transactions: [], ready: true, loading: false })
  useDebtStore.setState({ debts: [] })   // aktif alan ws-a: borç bellekte YOK
})


function tx(p: Partial<Transaction>): Transaction {
  return {
    id: 't', type: 'transfer', amount: 500, currency: 'TRY', date: '2026-02-01',
    accountId: 'kaynak', description: 'Aktarım', isInstallment: false,
    createdAt: '2026-02-01', updatedAt: '2026-02-01', workspaceId: 'ws-a', ...p,
  }
}

const editInput = {
  sourceAccountId: 'kaynak', targetWorkspaceId: 'ws-b', targetAccountId: 'ara',
  amount: 750, date: '2026-02-05', description: 'Damla harçlık',
}

describe('updateCrossWorkspaceTransfer', () => {
  it('aynı-alan transferini alanlar arası transfere çevirir (id korunur, hedefte giriş doğar)', async () => {
    const t = tx({ id: 'tr', toAccountId: 'baska', categoryId: 'kat' })
    dexieTransactions = [t]
    useTransactionStore.setState({ transactions: [t] })

    await useTransactionStore.getState().updateCrossWorkspaceTransfer('tr', editInput)

    const out = dexieTransactions.find(r => r.id === 'tr')!
    const inc = dexieTransactions.find(r => r.id !== 'tr')!
    expect(out).toMatchObject({ type: 'expense', amount: 750, date: '2026-02-05', workspaceId: 'ws-a', peerWorkspaceId: 'ws-b', icon: '⇄' })
    expect(out.toAccountId).toBeUndefined()
    expect(out.categoryId).toBeUndefined()
    expect(inc).toMatchObject({ type: 'income', amount: 750, accountId: 'ara', workspaceId: 'ws-b', peerWorkspaceId: 'ws-a' })
    expect(inc.workspaceTransferId).toBe(out.workspaceTransferId)
    // Bellekte yalnız aktif alandaki çıkış bacağı
    expect(useTransactionStore.getState().transactions.map(r => r.id)).toEqual(['tr'])
    // Tek atomik yazma
    expect(batches).toHaveLength(1)
  })

  it('var olan alanlar arası transferin iki bacağını birlikte günceller (karşı bacak id korunur)', async () => {
    const out = tx({ id: 'out', type: 'expense', workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a', icon: '⇄' })
    dexieTransactions = [out, inc]
    useTransactionStore.setState({ transactions: [out] })

    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', {
      ...editInput, targetAccountId: 'ara2',
    })

    expect(dexieTransactions).toHaveLength(2)
    expect(dexieTransactions.find(r => r.id === 'inc')).toMatchObject({ accountId: 'ara2', amount: 750, date: '2026-02-05', workspaceTransferId: 'L' })
    expect(dexieTransactions.find(r => r.id === 'out')).toMatchObject({ amount: 750, workspaceTransferId: 'L' })
  })

  it('hedef alanı değiştirince karşı bacak yeni alana taşınır', async () => {
    const out = tx({ id: 'out', type: 'expense', workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a', icon: '⇄' })
    dexieTransactions = [out, inc]
    useTransactionStore.setState({ transactions: [out] })

    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', {
      ...editInput, targetWorkspaceId: 'ws-c', targetAccountId: 'c-hesap',
    })

    expect(dexieTransactions.find(r => r.id === 'inc')).toMatchObject({ workspaceId: 'ws-c', accountId: 'c-hesap' })
    expect(dexieTransactions.find(r => r.id === 'out')).toMatchObject({ peerWorkspaceId: 'ws-c' })
  })

  it('yetim bacak ve taksit düzenlenmez', async () => {
    const orphan = tx({ id: 'yetim', type: 'expense', workspaceTransferId: 'M' })
    dexieTransactions = [orphan]
    useTransactionStore.setState({ transactions: [orphan] })
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('yetim', editInput)).rejects.toThrow()

    const inst = tx({ id: 'ins', isInstallment: true, installGroupId: 'g' })
    useTransactionStore.setState({ transactions: [inst] })
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('ins', editInput)).rejects.toThrow()
    expect(batches).toHaveLength(0)
  })

  // Borç ödemeli üçlü: çıkış (ws-a) + giriş (ws-b, ara) + ödeme (ws-b, borc)
  function seedDebtTriple(amount = 1_500) {
    const out = tx({ id: 'out', type: 'expense', amount, workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', amount, accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a', icon: '⇄' })
    const pay = tx({ id: 'pay', type: 'transfer', amount, amountTry: amount, accountId: 'ara', debtId: 'borc', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a' })
    dexieTransactions = [out, inc, pay]
    // Borç bu ödemeyi zaten içeriyor: 2.000 + 1.500
    dexieDebts = [debt({ paidAmount: 3_500, paidInstallments: 3 })]
    useTransactionStore.setState({ transactions: [out] })
  }

  it('borç ödemeli transferde tutar değişince üç bacak ve borç farkla güncellenir (taksit sayısı aynı)', async () => {
    seedDebtTriple()
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', {
      ...editInput, amount: 2_000, targetDebtId: 'borc',
    })
    expect(dexieTransactions.filter(t => !t.deleted_at)).toHaveLength(3)
    expect(dexieTransactions.find(t => t.id === 'pay')).toMatchObject({ amount: 2_000, debtId: 'borc', accountId: 'ara' })
    expect(dexieTransactions.find(t => t.id === 'inc')).toMatchObject({ amount: 2_000 })
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 4_000, paidInstallments: 3 })
    expect(batches).toHaveLength(1)
  })

  it('borç ödemesi kaldırılınca ödeme bacağı silinir ve borç geri alınır', async () => {
    seedDebtTriple()
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', editInput)
    expect(dexieTransactions.find(t => t.id === 'pay')!.deleted_at).toBeTruthy()
    expect(dexieTransactions.find(t => t.id === 'inc')!.deleted_at).toBeFalsy()
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 2_000, paidInstallments: 2 })
  })

  it('düz alanlar arası transfere sonradan borç ödemesi eklenir', async () => {
    const out = tx({ id: 'out', type: 'expense', workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L' })
    dexieTransactions = [out, inc]
    useTransactionStore.setState({ transactions: [out] })
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', { ...editInput, targetDebtId: 'borc' })
    const pay = dexieTransactions.find(t => t.debtId === 'borc')!
    expect(pay).toMatchObject({ type: 'transfer', amount: 750, accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L' })
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 2_750, paidInstallments: 3 })
  })

  it('bu ödemenin kapattığı borç düzenlemede yine seçilebilir', async () => {
    seedDebtTriple()
    dexieDebts = [debt({ totalAmount: 3_500, paidAmount: 3_500, paidInstallments: 3, isSettled: true })]
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('out', { ...editInput, amount: 1_000, targetDebtId: 'borc' })
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 3_000, isSettled: false })
  })

  it('başka bir kapanmış borç seçilemez', async () => {
    seedDebtTriple()
    dexieDebts = [debt(), debt({ id: 'kapali', isSettled: true })]
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('out', { ...editInput, targetDebtId: 'kapali' })).rejects.toThrow()
  })

  it('hedef alan aktif alanla aynı olamaz', async () => {
    const t = tx({ id: 'tr', toAccountId: 'baska' })
    useTransactionStore.setState({ transactions: [t] })
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('tr', { ...editInput, targetWorkspaceId: 'ws-a' })).rejects.toThrow()
  })
})

describe('detachCrossWorkspaceTransfer', () => {
  it('karşı bacağı siler ve bağ alanlarını temizler', async () => {
    const out = tx({ id: 'out', type: 'expense', workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L' })
    dexieTransactions = [out, inc]
    useTransactionStore.setState({ transactions: [out] })

    await useTransactionStore.getState().detachCrossWorkspaceTransfer('out')

    expect(dexieTransactions.find(r => r.id === 'inc')!.deleted_at).toBeTruthy()
    expect(patches).toEqual([{ table: 'transactions', id: 'out', patch: { workspaceTransferId: undefined, peerWorkspaceId: undefined, icon: undefined } }])
    const mem = useTransactionStore.getState().transactions.find(r => r.id === 'out')!
    expect(mem.workspaceTransferId).toBeUndefined()
    expect(mem.icon).toBeUndefined()
  })
})

describe('updateCrossWorkspaceTransfer — giriş bacağından (hedef alan aktif)', () => {
  function seed(withPayment: boolean) {
    activeId = 'ws-b'
    const out = tx({ id: 'out', type: 'expense', amount: 1_500, workspaceTransferId: 'L', peerWorkspaceId: 'ws-b', icon: '⇄' })
    const inc = tx({ id: 'inc', type: 'income', amount: 1_500, accountId: 'ara', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a', icon: '⇄' })
    const pay = tx({ id: 'pay', type: 'transfer', amount: 1_500, amountTry: 1_500, accountId: 'ara', debtId: 'borc', workspaceId: 'ws-b', workspaceTransferId: 'L', peerWorkspaceId: 'ws-a' })
    dexieTransactions = withPayment ? [out, inc, pay] : [out, inc]
    dexieDebts = [debt({ paidAmount: withPayment ? 3_500 : 2_000, paidInstallments: withPayment ? 3 : 2 })]
    // Aktif alan ws-b: bellekte giriş (ve varsa ödeme) bacağı
    useTransactionStore.setState({ transactions: withPayment ? [inc, pay] : [inc] })
  }
  const inInput = {
    sourceWorkspaceId: 'ws-a', sourceAccountId: 'kaynak',
    targetWorkspaceId: 'ws-b', targetAccountId: 'ara2',
    amount: 2_000, amountIn: 'target' as const,
    date: '2026-02-07', description: 'Harçlık',
  }

  it('kaynak (diğer alandaki çıkış) ve hedef birlikte güncellenir; bellekte yalnız aktif alan bacakları', async () => {
    seed(false)
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('inc', inInput)
    expect(dexieTransactions.find(t => t.id === 'out')).toMatchObject({ amount: 2_000, accountId: 'kaynak', workspaceId: 'ws-a', date: '2026-02-07' })
    expect(dexieTransactions.find(t => t.id === 'inc')).toMatchObject({ amount: 2_000, accountId: 'ara2', workspaceId: 'ws-b' })
    expect(useTransactionStore.getState().transactions.map(t => t.id)).toEqual(['inc'])
  })

  it('kaynak hesabı diğer alanda değiştirilebilir', async () => {
    seed(false)
    dexieAccounts.push(account('kaynak2', 'ws-a'))
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('inc', { ...inInput, sourceAccountId: 'kaynak2' })
    expect(dexieTransactions.find(t => t.id === 'out')).toMatchObject({ accountId: 'kaynak2' })
  })

  it('borç ödemesi (aktif alanda) güncellenir; ödeme bacağı bellekte de yenilenir', async () => {
    seed(true)
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('inc', { ...inInput, targetAccountId: 'ara', targetDebtId: 'borc' })
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 4_000, paidInstallments: 3 })
    const mem = useTransactionStore.getState().transactions
    expect(mem.map(t => t.id).sort()).toEqual(['inc', 'pay'])
    expect(mem.find(t => t.id === 'pay')).toMatchObject({ amount: 2_000 })
  })

  it('borç ödemesi kaldırılınca ödeme bacağı bellekten de düşer', async () => {
    seed(true)
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('inc', { ...inInput, targetAccountId: 'ara' })
    expect(useTransactionStore.getState().transactions.map(t => t.id)).toEqual(['inc'])
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 2_000, paidInstallments: 2 })
  })

  it('borç ödemesi satırından düzenlenir: tüm bacaklar ve borç güncellenir', async () => {
    seed(true)
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('pay', { ...inInput, targetAccountId: 'ara', targetDebtId: 'borc' })
    expect(dexieTransactions.find(t => t.id === 'out')).toMatchObject({ amount: 2_000, date: '2026-02-07' })
    expect(dexieTransactions.find(t => t.id === 'inc')).toMatchObject({ amount: 2_000 })
    expect(dexieTransactions.find(t => t.id === 'pay')).toMatchObject({ amount: 2_000, debtId: 'borc' })
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 4_000, paidInstallments: 3 })
  })

  it('borç ödemesi satırından borç kaldırılınca o satır silinir, giriş kalır', async () => {
    seed(true)
    await useTransactionStore.getState().updateCrossWorkspaceTransfer('pay', { ...inInput, targetAccountId: 'ara' })
    expect(dexieTransactions.find(t => t.id === 'pay')!.deleted_at).toBeTruthy()
    expect(useTransactionStore.getState().transactions.map(t => t.id)).toEqual(['inc'])
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 2_000, paidInstallments: 2 })
  })

  it('bu alandaki sıradan borç ödemesi alanlar arası transfere çevrilir: ödeme satırı kalır, çıkış ve giriş doğar', async () => {
    activeId = 'ws-b'
    // ws-b'de Garanti(ara)'dan Kredi'ye 1.500'lük sıradan ödeme; borç bunu içeriyor
    const lone = tx({ id: 'lone', amount: 1_500, amountTry: 1_500, accountId: 'ara', debtId: 'borc', workspaceId: 'ws-b', description: 'Kredi taksiti' })
    dexieTransactions = [lone]
    dexieDebts = [debt({ paidAmount: 3_500, paidInstallments: 3 })]
    useTransactionStore.setState({ transactions: [lone] })

    await useTransactionStore.getState().updateCrossWorkspaceTransfer('lone', {
      ...inInput, targetAccountId: 'ara', amount: 1_500, targetDebtId: 'borc',
    })

    const pay = dexieTransactions.find(t => t.id === 'lone')!
    const out = dexieTransactions.find(t => t.type === 'expense')!
    const inc = dexieTransactions.find(t => t.type === 'income')!
    expect(pay).toMatchObject({ type: 'transfer', debtId: 'borc', accountId: 'ara', workspaceId: 'ws-b', amount: 1_500 })
    expect(out).toMatchObject({ accountId: 'kaynak', workspaceId: 'ws-a', amount: 1_500, peerWorkspaceId: 'ws-b' })
    expect(out.debtId).toBeFalsy()
    expect(out.id).not.toBe('lone')
    expect(inc).toMatchObject({ accountId: 'ara', workspaceId: 'ws-b', amount: 1_500 })
    expect(new Set([pay.workspaceTransferId, out.workspaceTransferId, inc.workspaceTransferId]).size).toBe(1)
    expect(pay.workspaceTransferId).toBeTruthy()
    // Aynı tutar → borç değişmez, taksit sayısı aynı
    expect(dexieDebts[0]).toMatchObject({ paidAmount: 3_500, paidInstallments: 3 })
    // Bellek (ws-b): ödeme + yeni giriş
    expect(useTransactionStore.getState().transactions.map(t => t.id).sort()).toEqual([inc.id, 'lone'].sort())
  })

  it('hesaba giden sıradan borç olmayan gelir/gider çevrilemez', async () => {
    seed(false)
    const exp = tx({ id: 'exp', type: 'expense', workspaceId: 'ws-b' })
    useTransactionStore.setState({ transactions: [exp] })
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('exp', inInput)).rejects.toThrow()
  })

  it('düzenlenen giriş bacağı başka alana taşınamaz', async () => {
    seed(false)
    await expect(useTransactionStore.getState().updateCrossWorkspaceTransfer('inc', {
      ...inInput, targetWorkspaceId: 'ws-c', targetAccountId: 'c-hesap',
    })).rejects.toThrow()
  })
})
