'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase, nullifyUndefined } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import type { Budget, BudgetWithSpent, Transaction, MonthYear } from '@/types'
import { enrichBudget } from '@/lib/utils/calculations'
import { softDelete, isLive } from '@/lib/sync/tombstone'

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
    const { data, error } = await supabase.from('budgets').select('*').is('deleted_at', null)
    if (!error) {
      const budgets = (data ?? []) as Budget[]
      await db.transaction('rw', db.budgets, async () => {
        await db.budgets.clear()
        await db.budgets.bulkAdd(budgets)
      })
      set({ budgets, loading: false, ready: true })
    } else {
      console.error('[supabase:budgets:load]', error)
      const budgets = (await db.budgets.toArray()).filter(isLive)
      set({ budgets, loading: false, ready: true })
    }
  },

  add: async (budget) => {
    await db.budgets.add(budget)
    const userId = await getUserId()
    // spent, remaining, percentUsed, status, category BudgetWithSpent'e ait computed alanlar
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { spent: _s, remaining: _r, percentUsed: _pu, status: _st, category: _c, ...budgetForDb } = budget as BudgetWithSpent
    supabase.from('budgets').insert({ ...budgetForDb, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:budgets:insert]', error)
    })
    set(s => ({ budgets: [...s.budgets, budget] }))
  },

  update: async (id, patch) => {
    await db.budgets.update(id, patch)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { spent: _s, remaining: _r, percentUsed: _pu, status: _st, category: _c, ...patchForDb } = patch as Partial<BudgetWithSpent>
    supabase.from('budgets').update(nullifyUndefined(patchForDb)).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:budgets:update]', error)
    })
    set(s => ({
      budgets: s.budgets.map(b => b.id === id ? { ...b, ...patch } : b),
    }))
  },

  remove: async (id) => {
    await softDelete(db.budgets, 'budgets', id) // C3 — soft delete
    set(s => ({ budgets: s.budgets.filter(b => b.id !== id) }))
  },

  getMonthBudgets: (my, transactions) => {
    return get().budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, transactions, my))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  },
}))
