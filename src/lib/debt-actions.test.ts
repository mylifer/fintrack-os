import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Debt, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Borç silme (denetim #12, ürün kararı): borç silinince bağlı anapara ve
   ödeme işlemleri de HER ZAMAN silinir. Borç + işlemler (+ alanlar arası
   transferin karşı bacakları) TEK localBatch'te tombstone'lanır; tek "geri
   al" hepsini birlikte geri getirir. Silinen borcun paidAmount'u yamalanmaz:
   borç zaten gidiyor, undo onu dokunulmamış haliyle geri getirir — ödeme
   katkısı çift geri alınmaz.
──────────────────────────────────────────────────────────────────────── */

type Op = { kind: string; table: string; id?: string; ids?: string[]; patch?: Record<string, unknown> }

let dexieTransactions: Transaction[] = []
let dexieDebts: Debt[] = []
const batches: Op[][] = []
let failNextBatch = false
const recompute = vi.fn()

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
    debts: {
      get: async (id: string) => dexieDebts.find(d => d.id === id),
      bulkGet: async (ids: string[]) => ids.map(id => dexieDebts.find(d => d.id === id)),
    },
  },
}))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))

vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localBulkUpsert: async () => {},
  localPatch: async () => {},
  softDelete: async () => {},
  softDeleteMany: async () => {},
  reconcilingPull: async () => [],
  localBatch: async (ops: Op[]) => {
    if (failNextBatch) { failNextBatch = false; throw new Error('IndexedDB işlemi iptal') }
    batches.push(ops)
    for (const op of ops) {
      if (op.kind === 'patchMany' && op.table === 'transactions') {
        dexieTransactions = dexieTransactions.map(t => op.ids!.includes(t.id) ? { ...t, ...op.patch } : t)
      }
      if (op.kind === 'patch' && op.table === 'debts') {
        dexieDebts = dexieDebts.map(d => d.id === op.id ? { ...d, ...op.patch } as Debt : d)
      }
    }
  },
}))

vi.mock('@/store/accounts.store', () => ({
  useAccountStore: { getState: () => ({ recomputeBalances: recompute, accounts: [] }) },
}))

vi.mock('@/store/workspace.store', () => ({
  useWorkspaceStore: { getState: () => ({ activeId: 'ws-b' }) },
}))

const { useTransactionStore } = await import('@/store/transactions.store')
const { useDebtStore } = await import('@/store/debts.store')
const { useUndoStore } = await import('@/store/undo.store')
const { debtDeletionPlan, deleteDebtWithTransactions } = await import('./debt-actions')

function debt(p: Partial<Debt> = {}): Debt {
  return {
    id: 'borc', name: 'Kredi', type: 'loan', direction: 'owe', totalAmount: 10_000,
    paidAmount: 3_000, paidInstallments: 2, startDate: '2026-01-01', isSettled: false,
    createdAt: '2026-01-01', workspaceId: 'ws-b', ...p,
  } as Debt
}

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(), type: 'expense', amount: 100, currency: 'TRY', date: '2026-02-01',
    accountId: 'hesap', description: 'x', isInstallment: false,
    createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z', workspaceId: 'ws-b', ...p,
  } as Transaction
}

const principal = () => tx({
  id: 'anapara', type: 'income', amount: 10_000, icon: '🏦', description: 'Kredi — Borç Anaparası',
  debtPrincipalId: 'borc', date: '2026-01-01',
})
const pay1 = () => tx({ id: 'odeme1', type: 'expense', amount: 1_500, debtId: 'borc', date: '2026-02-01' })
const pay2 = () => tx({ id: 'odeme2', type: 'expense', amount: 1_500, debtId: 'borc', date: '2026-03-01' })
const other = () => tx({ id: 'market', amount: 250, date: '2026-02-15' })

function seed(txs: Transaction[], d: Debt = debt()) {
  dexieTransactions = txs.map(t => ({ ...t }))
  dexieDebts = [{ ...d }]
  useTransactionStore.setState({ transactions: txs, ready: true, loading: false })
  useDebtStore.setState({ debts: [d] })
}

beforeEach(() => {
  batches.length = 0
  failNextBatch = false
  recompute.mockClear()
  useUndoStore.setState({ toasts: [] })
})

describe('deleteDebtWithTransactions — her zaman kaskad', () => {
  it('borç, anapara ve ödemeler TEK atomik blokta silinir; ilgisiz işlem kalır', async () => {
    seed([principal(), pay1(), pay2(), other()])
    await deleteDebtWithTransactions(debt())

    expect(batches).toHaveLength(1)
    const ops = batches[0]
    expect(ops.find(o => o.table === 'debts')).toMatchObject({ kind: 'patch', id: 'borc' })
    expect(ops.find(o => o.table === 'debts')!.patch!.deleted_at).toBeTruthy()
    const tomb = ops.find(o => o.kind === 'patchMany')!
    expect([...tomb.ids!].sort()).toEqual(['anapara', 'odeme1', 'odeme2'])

    expect(useDebtStore.getState().debts).toHaveLength(0)
    expect(useTransactionStore.getState().transactions.map(t => t.id)).toEqual(['market'])
    expect(recompute).toHaveBeenLastCalledWith(useTransactionStore.getState().transactions)
  })

  it('silinen borcun paidAmount\'u yamalanmaz (ödeme çift geri alınmaz)', async () => {
    seed([principal(), pay1(), pay2()])
    await deleteDebtWithTransactions(debt())
    const debtOps = batches[0].filter(o => o.table === 'debts')
    expect(debtOps).toHaveLength(1)
    expect(Object.keys(debtOps[0].patch!)).toEqual(['deleted_at'])
  })

  it('geri al borcu ve tüm işlemleri birlikte, tek blokta geri getirir', async () => {
    seed([principal(), pay1(), pay2(), other()])
    await deleteDebtWithTransactions(debt())
    batches.length = 0

    await useUndoStore.getState().toasts.at(-1)!.undo()

    expect(batches).toHaveLength(1)
    const ops = batches[0]
    expect(ops.find(o => o.table === 'debts')).toMatchObject({ id: 'borc', patch: { deleted_at: null } })
    expect([...ops.find(o => o.kind === 'patchMany')!.ids!].sort()).toEqual(['anapara', 'odeme1', 'odeme2'])

    expect(useDebtStore.getState().debts).toEqual([debt()])
    expect(useTransactionStore.getState().transactions.map(t => t.id).sort())
      .toEqual(['anapara', 'market', 'odeme1', 'odeme2'])
    expect(recompute).toHaveBeenLastCalledWith(useTransactionStore.getState().transactions)
  })

  it('bağlı işlemi olmayan borçta yalnız borç silinir (boş patchMany yok)', async () => {
    seed([other()])
    await deleteDebtWithTransactions(debt())
    expect(batches[0]).toHaveLength(1)
    expect(batches[0][0]).toMatchObject({ table: 'debts', id: 'borc' })
    expect(useTransactionStore.getState().transactions.map(t => t.id)).toEqual(['market'])
  })

  it('taksitli ödemenin tüm taksitleri birlikte silinir', async () => {
    const t1 = tx({ id: 'tk1', debtId: 'borc', installGroupId: 'g' })
    const t2 = tx({ id: 'tk2', installGroupId: 'g', date: '2026-03-01' })
    seed([t1, t2, other()])
    await deleteDebtWithTransactions(debt())
    expect([...batches[0].find(o => o.kind === 'patchMany')!.ids!].sort()).toEqual(['tk1', 'tk2'])
  })

  it('yazma başarısız olursa hiçbir store değişmez (yetim kalmaz)', async () => {
    seed([principal(), pay1(), other()])
    failNextBatch = true
    await expect(deleteDebtWithTransactions(debt())).rejects.toThrow()
    expect(useDebtStore.getState().debts).toHaveLength(1)
    expect(useTransactionStore.getState().transactions).toHaveLength(3)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })
})

describe('deleteDebtWithTransactions — alanlar arası borç ödemesi', () => {
  // Kaynak alan (ws-a) gideri + hedef alan (ws-b) girişi + debtId'li ödeme;
  // üçü aynı workspaceTransferId'yi taşır. Aktif alan ws-b: kaynak bacak
  // bellekte YOK, yalnız Dexie'de.
  const out = () => tx({ id: 'kaynak-gider', workspaceId: 'ws-a', accountId: 'kaynak', amount: 1_500, workspaceTransferId: 'L' })
  const inc = () => tx({ id: 'hedef-giris', type: 'income', accountId: 'ara', amount: 1_500, workspaceTransferId: 'L' })
  const pay = () => tx({ id: 'hedef-odeme', type: 'transfer', accountId: 'ara', amount: 1_500, debtId: 'borc', workspaceTransferId: 'L' })

  it('ödemenin karşı bacakları (başka alandaki dahil) aynı blokta silinir', async () => {
    seed([inc(), pay()])
    dexieTransactions.push(out())
    await deleteDebtWithTransactions(debt())

    expect(batches).toHaveLength(1)
    const tomb = batches[0].find(o => o.kind === 'patchMany')!
    expect([...tomb.ids!].sort()).toEqual(['hedef-giris', 'hedef-odeme', 'kaynak-gider'])
    expect(batches[0].filter(o => o.table === 'debts')).toHaveLength(1)
    expect(useTransactionStore.getState().transactions).toHaveLength(0)
  })

  it('zaten silinmiş karşı bacak yeniden tombstone\'lanmaz, undo onu diriltmez', async () => {
    seed([inc(), pay()])
    dexieTransactions.push({ ...out(), deleted_at: '2026-02-02T00:00:00.000Z' } as Transaction)
    await deleteDebtWithTransactions(debt())
    expect([...batches[0].find(o => o.kind === 'patchMany')!.ids!].sort()).toEqual(['hedef-giris', 'hedef-odeme'])

    batches.length = 0
    await useUndoStore.getState().toasts.at(-1)!.undo()
    expect([...batches[0].find(o => o.kind === 'patchMany')!.ids!].sort()).toEqual(['hedef-giris', 'hedef-odeme'])
  })

  it('karşı bacak BAŞKA bir borcun ödemesiyse o borcun katkısı geri alınır, undo yeniden uygular', async () => {
    const other = debt({ id: 'diger', name: 'Diğer', paidAmount: 2_000, paidInstallments: 1, workspaceId: 'ws-a' })
    seed([inc(), pay()])
    dexieTransactions.push({ ...out(), debtId: 'diger' })
    dexieDebts.push(other)
    await deleteDebtWithTransactions(debt())

    const otherOp = batches[0].find(o => o.table === 'debts' && o.id === 'diger')
    expect(otherOp).toMatchObject({ patch: { paidAmount: 500, paidInstallments: 0 } })
    expect(batches[0].find(o => o.table === 'debts' && o.id === 'borc')!.patch).toEqual({ deleted_at: expect.any(String) })

    batches.length = 0
    await useUndoStore.getState().toasts.at(-1)!.undo()
    expect(batches[0].find(o => o.table === 'debts' && o.id === 'diger')).toMatchObject({ patch: { paidAmount: 2_000, paidInstallments: 1 } })
  })
})

describe('debtDeletionPlan — onay penceresi ile silme aynı kümeyi görür', () => {
  const out = () => tx({ id: 'kaynak-gider', workspaceId: 'ws-a', accountId: 'kaynak', amount: 1_500, workspaceTransferId: 'L' })
  const inc = () => tx({ id: 'hedef-giris', type: 'income', accountId: 'ara', amount: 1_500, workspaceTransferId: 'L' })
  const pay = () => tx({ id: 'hedef-odeme', type: 'transfer', accountId: 'ara', amount: 1_500, debtId: 'borc', workspaceTransferId: 'L' })

  it('başka alandaki karşı bacağı sayar ve ayrıca bildirir', async () => {
    seed([principal(), inc(), pay(), other()])
    dexieTransactions.push(out())
    const plan = await debtDeletionPlan(debt())
    expect(plan.transactions.map(t => t.id).sort()).toEqual(['anapara', 'hedef-giris', 'hedef-odeme', 'kaynak-gider'])
    expect(plan.otherWorkspaceCount).toBe(1)
  })

  it('pencerede gösterilen küme silinen kümeyle birebir aynı', async () => {
    seed([principal(), pay1(), inc(), pay()])
    dexieTransactions.push(out())
    const plan = await debtDeletionPlan(debt())
    await deleteDebtWithTransactions(debt())
    const tomb = batches[0].find(o => o.kind === 'patchMany')!
    expect([...tomb.ids!].sort()).toEqual(plan.transactions.map(t => t.id).sort())
  })

  it('tüm bağlı işlemler aktif alandaysa başka alan sayısı 0', async () => {
    seed([principal(), pay1()])
    expect(await debtDeletionPlan(debt())).toMatchObject({ otherWorkspaceCount: 0 })
    expect((await debtDeletionPlan(debt())).transactions).toHaveLength(2)
  })
})
