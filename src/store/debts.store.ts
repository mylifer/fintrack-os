'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import type { Debt, DebtWithRemaining } from '@/types'
import { enrichDebt } from '@/lib/utils/calculations'
import { isDueSoon } from '@/lib/utils/date'

interface DebtState {
  debts: Debt[]
  loading: boolean
  load: () => Promise<void>
  add: (debt: Debt) => Promise<void>
  update: (id: string, patch: Partial<Debt>) => Promise<void>
  remove: (id: string) => Promise<void>
  recordPayment: (id: string, amount: number) => Promise<void>
  settle: (id: string) => Promise<void>
  getActive: () => DebtWithRemaining[]
  getDueSoon: (days?: number) => DebtWithRemaining[]
}

export const useDebtStore = create<DebtState>()((set, get) => ({
  debts: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('debts').select('*')
    if (!error) {
      const debts = (data ?? []) as Debt[]
      await db.transaction('rw', db.debts, async () => {
        await db.debts.clear()
        await db.debts.bulkAdd(debts)
      })
      set({ debts, loading: false })
    } else {
      console.error('[supabase:debts:load]', error)
      const debts = await db.debts.toArray()
      set({ debts, loading: false })
    }
  },

  add: async (debt) => {
    await db.debts.add(debt)
    const userId = await getUserId()
    // remainingAmount, progressPercent DebtWithRemaining'e ait computed alanlar
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { remainingAmount: _ra, progressPercent: _pp, ...debtForDb } = debt as DebtWithRemaining
    supabase.from('debts').insert({ ...debtForDb, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:debts:insert]', error)
    })
    set(s => ({ debts: [...s.debts, debt] }))
  },

  update: async (id, patch) => {
    await db.debts.update(id, patch)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { remainingAmount: _ra, progressPercent: _pp, ...patchForDb } = patch as Partial<DebtWithRemaining>
    supabase.from('debts').update(patchForDb).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:debts:update]', error)
    })
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  remove: async (id) => {
    await db.debts.delete(id)
    supabase.from('debts').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:debts:delete]', error)
    })
    set(s => ({ debts: s.debts.filter(d => d.id !== id) }))
  },

  recordPayment: async (id, amount) => {
    const debt = get().debts.find(d => d.id === id)
    if (!debt) return
    const paidAmount = Math.round((debt.paidAmount + amount) * 100) / 100
    const paidInstallments = (debt.paidInstallments ?? 0) + 1
    const isSettled = paidAmount >= debt.totalAmount
    const patch = { paidAmount, paidInstallments, isSettled }

    await db.debts.update(id, patch)
    supabase.from('debts').update(patch).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:debts:update-payment]', error)
    })
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  settle: async (id) => {
    const patch = { isSettled: true }
    await db.debts.update(id, patch)
    supabase.from('debts').update(patch).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:debts:settle]', error)
    })
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  getActive: () => get().debts.filter(d => !d.isSettled).map(enrichDebt),

  getDueSoon: (days = 7) =>
    get().debts
      .filter(d => !d.isSettled && d.dueDate && isDueSoon(d.dueDate, days))
      .map(enrichDebt),
}))
