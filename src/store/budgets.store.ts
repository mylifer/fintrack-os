'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase' // Supabase bağlantısı eklendi
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
    // Supabase'e ekle
    supabase.from('budgets').insert(budget).then()
    set(s => ({ budgets: [...s.budgets, budget] }))
  },

  update: async (id, patch) => {
    await db.budgets.update(id, patch)
    // Supabase'de güncelle
    supabase.from('budgets').update(patch).eq('id', id).then()
    set(s => ({
      budgets: s.budgets.map(b => b.id === id ? { ...b, ...patch } : b),
    }))
  },

  remove: async (id) => {
    await db.budgets.delete(id)
    // Supabase'den sil
    supabase.from('budgets').delete().eq('id', id).then()
    set(s => ({ budgets: s.budgets.filter(b => b.id !== id) }))
  },

  getMonthBudgets: (my, transactions) => {
    return get().budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, transactions, my))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  },
}))