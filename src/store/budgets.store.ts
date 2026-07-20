'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Budget, BudgetWithSpent, Transaction, MonthYear } from '@/types'
import { enrichBudget, getBudgetCategoryIds } from '@/lib/utils/calculations'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'
import { useCategoryStore } from './categories.store'
import { useUndoStore, type RemoveOptions } from './undo.store'

// Display-name snapshot: join the names of the budget's currently-live
// categories. Returns '' when none resolve (nothing safe to stamp).
function liveCategoryName(budget: Pick<Budget, 'categoryId'>): string {
  const categories = useCategoryStore.getState().categories
  if (categories.length === 0) return ''
  const names = getBudgetCategoryIds(budget as Budget)
    .map(id => categories.find(c => c.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  return names.join(', ')
}

interface BudgetState {
  budgets: Budget[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (budget: Budget) => Promise<void>
  update: (id: string, patch: Partial<Budget>) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
  getMonthBudgets: (my: MonthYear, transactions: Transaction[]) => BudgetWithSpent[]
}

export const useBudgetStore = create<BudgetState>()((set, get) => ({
  budgets: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const budgets = await loadEntities<Budget>(
      'budgets', 'budgets',
      async () => (await db.budgets.toArray()).filter(isLive),
    )
    // BACKFILL — capture the name snapshot for legacy budgets WHILE their
    // category is still alive, so it survives a later deletion. Categories load
    // in DataProvider Phase 1 (before budgets), so live categories are here.
    // Guard: skip if the category store isn't ready yet. Durable-migration
    // pattern (mirror categories.store load): patch in-memory + flow through the
    // outbox via localPatch.
    const toStamp: Array<{ id: string; categoryName: string }> = []
    if (useCategoryStore.getState().categories.length > 0) {
      for (const b of budgets) {
        if (b.categoryName) continue
        const categoryName = liveCategoryName(b)
        if (categoryName) {
          b.categoryName = categoryName
          toStamp.push({ id: b.id, categoryName })
        }
      }
    }
    set({ budgets, loading: false, ready: true })
    for (const { id, categoryName } of toStamp) {
      await localPatch('budgets', id, { categoryName })
    }
  },

  add: async (budget) => {
    // The outbox snapshot strips BudgetWithSpent computed fields (spent, etc.).
    // Belt-and-suspenders: stamp the name snapshot if the caller didn't.
    const entry: Budget = budget.categoryName
      ? budget
      : (() => { const n = liveCategoryName(budget); return n ? { ...budget, categoryName: n } : budget })()
    await localUpsert('budgets', entry)
    set(s => ({ budgets: [...s.budgets, entry] }))
  },

  update: async (id, patch) => {
    // Belt-and-suspenders: if the category is changing but no name snapshot was
    // supplied, resolve it from the incoming categoryId.
    let p = patch
    if (patch.categoryId !== undefined && patch.categoryName === undefined) {
      const categoryName = liveCategoryName({ categoryId: patch.categoryId })
      if (categoryName) p = { ...patch, categoryName }
    }
    await localPatch('budgets', id, p as Record<string, unknown>)
    set(s => ({
      budgets: s.budgets.map(b => b.id === id ? { ...b, ...p } : b),
    }))
  },

  remove: async (id, opts) => {
    const budget = get().budgets.find(b => b.id === id)
    await softDelete('budgets', id) // C3 — soft delete via durable outbox
    set(s => ({ budgets: s.budgets.filter(b => b.id !== id) }))
    if (budget && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Bütçe silindi', async () => {
        await localPatch('budgets', id, { deleted_at: null })
        set(s => ({ budgets: [...s.budgets, budget] }))
      })
    }
  },

  getMonthBudgets: (my, transactions) => {
    // Üst kategoriye açılan bütçe alt kategori harcamalarını da kapsasın
    const categories = useCategoryStore.getState().categories
    return get().budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, transactions, my, categories))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  },
}))
