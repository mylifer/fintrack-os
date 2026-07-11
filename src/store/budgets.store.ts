'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Budget, BudgetWithSpent, Transaction, MonthYear } from '@/types'
import { enrichBudget } from '@/lib/utils/calculations'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'

interface BudgetState {
  budgets: Budget[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (budget: Budget) => Promise<void>
  update: (id: string, patch: Partial<Budget>) => Promise<void>
  remove: (id: string) => Promise<void>
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
    set({ budgets, loading: false, ready: true })
  },

  add: async (budget) => {
    // The outbox snapshot strips BudgetWithSpent computed fields (spent, etc.).
    await localUpsert('budgets', budget)
    set(s => ({ budgets: [...s.budgets, budget] }))
  },

  update: async (id, patch) => {
    await localPatch('budgets', id, patch as Record<string, unknown>)
    set(s => ({
      budgets: s.budgets.map(b => b.id === id ? { ...b, ...patch } : b),
    }))
  },

  remove: async (id) => {
    await softDelete('budgets', id) // C3 — soft delete via durable outbox
    set(s => ({ budgets: s.budgets.filter(b => b.id !== id) }))
  },

  getMonthBudgets: (my, transactions) => {
    return get().budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, transactions, my))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  },
}))
