import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Account, Debt, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
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
  localPatch: async () => {},
  softDelete: async () => {},
  softDeleteMany: async () => {},
  reconcilingPull: async () => [],
  localBatch: async (ops: typeof batches[number]) => {
    batches.push(ops)
    for (const op of ops) {
      if (op.kind === 'upsert' && op.table === 'transactions') dexieTransactions.push(op.entity!)
      if (op.kind === 'patchMany' && op.table === 'transactions') {
        dexieTransactions = dexieTransactions.map(t => op.ids!.includes(t.id) ? { ...t, ...op.patch } : t)
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
      accounts: [account('kaynak', 'ws-a')],
    }),
  },
}))

vi.mock('./workspace.store', () => ({
  useWorkspaceStore: { getState: () => ({ activeId: 'ws-a' }) },
}))

const { useTransactionStore } = await import('./transactions.store')
const { useDebtStore } = await import('./debts.store')

function account(id: string, workspaceId: string): Account {
  return {
    id, name: id, type: 'checking', currency: 'TRY', balance: 0, initialBalance: 0,
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

const input = {
  sourceAccountId: 'kaynak',
  targetWorkspaceId: 'ws-b',
  targetAccountId: 'ara',
  amount: 1_500,
  date: '2026-03-01',
  description: 'Kredi ödemesi',
  targetDebtId: 'borc',
}

beforeEach(() => {
  batches.length = 0
  dexieTransactions = []
  dexieAccounts = [account('kaynak', 'ws-a'), account('ara', 'ws-b')]
  dexieDebts = [debt()]
  useTransactionStore.setState({ transactions: [], ready: true, loading: false })
  useDebtStore.setState({ debts: [] })   // aktif alan ws-a: borç bellekte YOK
})

describe('addCrossWorkspaceTransfer — borç ödemesi', () => {
  it('üç satırı ve borç yamasını tek atomik blokta yazar', async () => {
    await useTransactionStore.getState().addCrossWorkspaceTransfer(input)

    expect(batches).toHaveLength(1)
    const ops = batches[0]
    const rows = ops.filter(o => o.table === 'transactions').map(o => o.entity!)
    expect(rows).toHaveLength(3)

    const [out, inc, pay] = rows
    expect(out).toMatchObject({ type: 'expense', accountId: 'kaynak', workspaceId: 'ws-a', amount: 1_500 })
    expect(inc).toMatchObject({ type: 'income', accountId: 'ara', workspaceId: 'ws-b', amount: 1_500 })
    expect(pay).toMatchObject({ type: 'transfer', accountId: 'ara', workspaceId: 'ws-b', amount: 1_500, debtId: 'borc' })
    expect(pay.icon).toBeUndefined()
    expect(pay.toAccountId).toBeUndefined()
    expect(new Set(rows.map(r => r.workspaceTransferId)).size).toBe(1)

    const debtOp = ops.find(o => o.table === 'debts')
    expect(debtOp).toMatchObject({ kind: 'patch', id: 'borc', patch: { paidAmount: 3_500, paidInstallments: 3, isSettled: false } })
  })

  it('borcu kapatan ödeme isSettled yazar', async () => {
    await useTransactionStore.getState().addCrossWorkspaceTransfer({ ...input, amount: 8_000 })
    const debtOp = batches[0].find(o => o.table === 'debts')
    expect(debtOp?.patch).toMatchObject({ paidAmount: 10_000, isSettled: true })
  })

  it('borç verilmezse sıradan iki bacaklı transfer kalır', async () => {
    await useTransactionStore.getState().addCrossWorkspaceTransfer({ ...input, targetDebtId: undefined })
    const ops = batches[0]
    expect(ops.filter(o => o.table === 'transactions')).toHaveLength(2)
    expect(ops.some(o => o.table === 'debts')).toBe(false)
  })

  it('hedef alana ait olmayan ya da alacak yönündeki borcu reddeder', async () => {
    dexieDebts = [debt({ workspaceId: 'ws-c' })]
    await expect(useTransactionStore.getState().addCrossWorkspaceTransfer(input)).rejects.toThrow()
    dexieDebts = [debt({ direction: 'owed' })]
    await expect(useTransactionStore.getState().addCrossWorkspaceTransfer(input)).rejects.toThrow()
    expect(batches).toHaveLength(0)
  })

  it('hedef alana ait olmayan hesabı reddeder', async () => {
    dexieAccounts = [account('kaynak', 'ws-a'), account('ara', 'ws-c')]
    await expect(useTransactionStore.getState().addCrossWorkspaceTransfer(input)).rejects.toThrow()
    expect(batches).toHaveLength(0)
  })
})

describe('silme — alanlar arası borç ödemesi', () => {
  it('kaynak bacak silinince üç satır da silinir ve borç ödemesi geri alınır', async () => {
    await useTransactionStore.getState().addCrossWorkspaceTransfer(input)
    const out = useTransactionStore.getState().transactions[0]
    batches.length = 0

    await useTransactionStore.getState().remove(out.id)

    const ops = batches[0]
    const tomb = ops.find(o => o.kind === 'patchMany')
    expect(tomb?.ids).toHaveLength(3)
    expect(ops.find(o => o.table === 'debts')).toMatchObject({ id: 'borc', patch: { paidAmount: 2_000, paidInstallments: 2 } })
    expect(useTransactionStore.getState().transactions).toHaveLength(0)
  })

  it('hedef alanda giriş bacağı silinince bellekteki ödeme satırı da düşer, undo geri getirir', async () => {
    await useTransactionStore.getState().addCrossWorkspaceTransfer(input)
    // Hedef alana geçilmiş gibi: borç ve hedef alanın iki bacağı bellekte
    const [, inc, pay] = batches[0].filter(o => o.table === 'transactions').map(o => o.entity!)
    useTransactionStore.setState({ transactions: [inc, pay] })
    useDebtStore.setState({ debts: [{ ...dexieDebts[0] }] })
    batches.length = 0

    await useTransactionStore.getState().remove(inc.id, { undoable: true })

    expect(useTransactionStore.getState().transactions).toHaveLength(0)
    expect(useDebtStore.getState().debts[0]).toMatchObject({ paidAmount: 2_000, paidInstallments: 2 })

    const { useUndoStore } = await import('./undo.store')
    const toast = useUndoStore.getState().toasts.at(-1)!
    await toast.undo()

    expect(useTransactionStore.getState().transactions.map(t => t.id).sort()).toEqual([inc.id, pay.id].sort())
    expect(useDebtStore.getState().debts[0]).toMatchObject({ paidAmount: 3_500, paidInstallments: 3 })
  })
})
