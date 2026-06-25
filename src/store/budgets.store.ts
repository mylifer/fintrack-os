'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import type { Budget, BudgetWithSpent, Transaction, MonthYear } from '@/types'
import { enrichBudget } from '@/lib/utils/calculations'

interface BudgetState {
  budgets: Budget[]
  loading: boolean
  load: () => Promise<void>
  add: (budget: Budget) => Promise<void>
  update: (id: string, patch: Partial<Budget>) => Promise<void>
  remove: (id: string) => Promise<void>
  getMonthBudgets: (my: MonthYear, transactions: Transaction[]) => BudgetWithSpent[]
}

export const useBudgetStore = create<BudgetState>()((set, get) => ({
  budgets: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    const budgets = await db.budgets.toArray()
    set({ budgets, loading: false })
  },

  add: async (budget) => {
    await db.budgets.add(budget)
    // spent, remaining, percentUsed, status, category BudgetWithSpent'e ait computed alanlar
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { spent: _s, remaining: _r, percentUsed: _pu, status: _st, category: _c, ...budgetForDb } = budget as BudgetWithSpent
    supabase.from('budgets').insert(budgetForDb).then(({ error }) => {
      if (error) console.error('[supabase:budgets:insert]', error)
    })
    set(s => ({ budgets: [...s.budgets, budget] }))
  },

  update: async (id, patch) => {
    await db.budgets.update(id, patch)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { spent: _s, remaining: _r, percentUsed: _pu, status: _st, category: _c, ...patchForDb } = patch as Partial<BudgetWithSpent>
    supabase.from('budgets').update(patchForDb).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:budgets:update]', error)
    })
    set(s => ({
      budgets: s.budgets.map(b => b.id === id ? { ...b, ...patch } : b),
    }))
  },

  remove: async (id) => {
    await db.budgets.delete(id)
    supabase.from('budgets').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:budgets:delete]', error)
    })
    set(s => ({ budgets: s.budgets.filter(b => b.id !== id) }))
  },

  getMonthBudgets: (my, transactions) => {
    return get().budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, transactions, my))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  },
}))
