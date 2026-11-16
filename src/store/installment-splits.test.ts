import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Transaction } from '@/types'
import { rescaleSplits, splitsForInstallments } from '@/lib/utils/categorySplits'
import { splitInstallments, splitMoney } from '@/lib/utils/money'

/* ────────────────────────────────────────────────────────────────────────
   Değişmez: taksitli + bölünmüş bir alışverişte her kategorinin taksitler
   boyunca toplamı, satın alma düzeyindeki paya KURUŞU KURUŞUNA eşittir.
   Grubu yazan her store yolu (oluşturma, düzenleme, kuruş düzeltme, pay
   onarımı) bu testten geçmeli.
──────────────────────────────────────────────────────────────────────── */

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localBulkUpsert: async () => {},
  localPatch: async () => {},
  softDelete: async () => {},
  softDeleteMany: async () => {},
  reconcilingPull: async () => [],
  localBatch: async () => {},
}))
vi.mock('./accounts.store', () => ({
  useAccountStore: { getState: () => ({ recomputeBalances: () => {}, accounts: [] }) },
}))
vi.mock('./workspace.store', () => ({ useWorkspaceStore: { getState: () => ({ activeId: 'ws' }) } }))

const { useTransactionStore } = await import('./transactions.store')

const SPLITS = [
  { categoryId: 'pets', amount: 9000 }, { categoryId: 'ev', amount: 2514.5 },
  { categoryId: 'temizlik', amount: 1699.5 }, { categoryId: 'mutfak', amount: 2199 },
]
const TOTAL = 15413
const N = 9

const k = (n: number) => Math.round(n * 100)
function groupRows(groupId?: string): Transaction[] {
  return useTransactionStore.getState().transactions
    .filter(t => t.installGroupId && (!groupId || t.installGroupId === groupId))
    .sort((a, b) => (a.installIndex ?? 0) - (b.installIndex ?? 0))
}
function expectInvariant(rows: Transaction[], splits = SPLITS) {
  for (const s of splits) {
    const sum = rows.reduce((a, r) => a + k(r.categorySplits!.find(x => x.categoryId === s.categoryId)!.amount), 0)
    expect(sum, s.categoryId).toBe(k(s.amount))
  }
  for (const r of rows) expect(r.categorySplits!.reduce((a, s) => a + k(s.amount), 0)).toBe(k(r.amount))
}

function row(p: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(), type: 'expense', amount: 0, currency: 'TRY', date: '2026-10-05',
    accountId: 'kart', description: 'Kedi Tuvaleti + Others', isInstallment: true,
    createdAt: '2026-10-05', updatedAt: '2026-10-05', workspaceId: 'ws', ...p,
  }
}

beforeEach(() => {
  useTransactionStore.setState({ transactions: [], ready: true, loading: false })
})

describe('taksitli bölünmüş alışveriş — kategori toplamı değişmezi', () => {
  it('addInstallmentGroup', async () => {
    await useTransactionStore.getState().addInstallmentGroup(
      row({ amount: TOTAL, categoryId: 'pets', categorySplits: SPLITS, isInstallment: false }) as never, N)
    const rows = groupRows()
    expect(rows).toHaveLength(N)
    expectInvariant(rows)
  })

  it('updateInstallmentGroup', async () => {
    await useTransactionStore.getState().addInstallmentGroup(
      row({ amount: TOTAL, categoryId: 'pets', categorySplits: SPLITS, isInstallment: false }) as never, N)
    const gid = groupRows()[0].installGroupId!
    const next = [{ categoryId: 'pets', amount: 8000 }, { categoryId: 'mutfak', amount: 7413 }]
    await useTransactionStore.getState().updateInstallmentGroup(gid, { categorySplits: next, date: '2026-10-05' }, splitInstallments(TOTAL, N))
    expectInvariant(groupRows(gid), next)
  })

  it('fixInstallmentRounding kategori toplamlarını korur', async () => {
    // Eski taksit bölüşümü (splitMoney) + kategori payları zaten tam dağıtılmış.
    const amounts = splitMoney(TOTAL, N)
    const dist = splitsForInstallments(SPLITS, amounts)
    useTransactionStore.setState({ transactions: amounts.map((amount, i) => row({
      amount, categoryId: 'pets', categorySplits: dist[i], installGroupId: 'g', installIndex: i + 1, installTotal: N,
    })) })
    expect(await useTransactionStore.getState().fixInstallmentRounding()).toBe(1)
    const rows = groupRows('g')
    expect(rows.map(r => r.amount)).toEqual(splitInstallments(TOTAL, N))
    expectInvariant(rows)
  })

  it('fixInstallmentSplits eski kaymış grubu onarır', async () => {
    const amounts = splitInstallments(TOTAL, N)
    useTransactionStore.setState({ transactions: amounts.map((amount, i) => row({
      amount, categoryId: 'pets', categorySplits: rescaleSplits(SPLITS, amount), installGroupId: 'g', installIndex: i + 1, installTotal: N,
    })) })
    expect(await useTransactionStore.getState().fixInstallmentSplits()).toBe(1)
    expectInvariant(groupRows('g'))
    expect(await useTransactionStore.getState().fixInstallmentSplits()).toBe(0)
  })
})
