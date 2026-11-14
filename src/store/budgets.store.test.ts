import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Budget, Transaction } from '@/types'

/* budgets.store — toplam aylık limit satırı (period 'total').
   Kimlik alandan türetilir: aynı alanda iki cihaz aynı anda limit koysa da
   bulutta (birincil anahtar + keep_newer_row) TEK satır olur. */

const upserts: Budget[] = []
const deletes: string[] = []
vi.mock('@/lib/sync/engine', () => ({
  reconcilingPull: async () => [],
  localUpsert: async (_t: string, row: Budget) => { upserts.push(row) },
  localPatch: async () => {},
  softDelete: async (_t: string, id: string) => { deletes.push(id) },
}))
vi.mock('@/lib/db', () => ({ db: { budgets: { toArray: async () => [] } } }))
vi.mock('./categories.store', async () => {
  const { create } = await import('zustand')
  return { useCategoryStore: create(() => ({ categories: [] })) }
})

const { useBudgetStore, selectTotalBudget } = await import('./budgets.store')
const { setActiveWorkspaceId } = await import('@/lib/workspace-context')

beforeEach(() => {
  upserts.length = 0
  deletes.length = 0
  setActiveWorkspaceId('ws-aile')
  useBudgetStore.setState({ budgets: [] })
})

describe('setTotalLimit', () => {
  it('iki cihaz (iki ayrı store) aynı alanda limit koyunca AYNI kimliği yazar', async () => {
    await useBudgetStore.getState().setTotalLimit(10_000)
    useBudgetStore.setState({ budgets: [] })                 // ikinci cihaz: satırı henüz görmedi
    await useBudgetStore.getState().setTotalLimit(12_000)
    expect(upserts.map(r => r.id)).toEqual(['total-budget-ws-aile', 'total-budget-ws-aile'])
    expect(upserts[1]).toMatchObject({ period: 'total', categoryId: '__total__', amount: 12_000, workspaceId: 'ws-aile' })
  })

  it('güncelleme store\'da ikinci satır üretmez; eşik korunur', async () => {
    await useBudgetStore.getState().setTotalLimit(10_000, 90)
    await useBudgetStore.getState().setTotalLimit(11_000)
    const { budgets } = useBudgetStore.getState()
    expect(budgets).toHaveLength(1)
    expect(selectTotalBudget(useBudgetStore.getState())).toMatchObject({ amount: 11_000, alertThreshold: 90 })
  })

  it('null/0 limiti kaldırır (tombstone)', async () => {
    await useBudgetStore.getState().setTotalLimit(10_000)
    await useBudgetStore.getState().setTotalLimit(null)
    expect(deletes).toEqual(['total-budget-ws-aile'])
    expect(selectTotalBudget(useBudgetStore.getState())).toBeUndefined()
  })

  it('farklı alanların kimlikleri ayrıdır', async () => {
    await useBudgetStore.getState().setTotalLimit(1)
    setActiveWorkspaceId('ws-genel')
    await useBudgetStore.getState().setTotalLimit(1)
    expect(upserts.map(r => r.id)).toEqual(['total-budget-ws-aile', 'total-budget-ws-genel'])
  })
})

describe('getMonthBudgets', () => {
  it('toplam limit satırı kategori bütçesi listesine karışmaz', async () => {
    await useBudgetStore.getState().setTotalLimit(5_000)
    useBudgetStore.setState(s => ({ budgets: [...s.budgets, {
      id: 'b1', categoryId: 'market', amount: 100, period: 'monthly', rollover: false, alertThreshold: 80,
    }] }))
    const list = useBudgetStore.getState().getMonthBudgets({ month: 1, year: 2026 }, [] as Transaction[])
    expect(list.map(b => b.id)).toEqual(['b1'])
  })
})
