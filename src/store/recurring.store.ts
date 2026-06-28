'use client'

import { create } from 'zustand'
import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import type { RecurringTransaction, RecurringFrequency } from '@/types'

function advanceDueDate(current: string, frequency: RecurringFrequency): string {
  const d = parseISO(current)
  switch (frequency) {
    case 'daily':   return format(addDays(d, 1),   'yyyy-MM-dd')
    case 'weekly':  return format(addWeeks(d, 1),  'yyyy-MM-dd')
    case 'monthly': return format(addMonths(d, 1), 'yyyy-MM-dd')
    case 'yearly':  return format(addYears(d, 1),  'yyyy-MM-dd')
  }
}

interface RecurringState {
  recurring: RecurringTransaction[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (r: RecurringTransaction) => Promise<void>
  update: (id: string, patch: Partial<RecurringTransaction>) => Promise<void>
  remove: (id: string) => Promise<void>
  toggleActive: (id: string) => Promise<void>
  getDue: (asOf: string) => RecurringTransaction[]
  markGenerated: (id: string, asOf: string) => Promise<void>
}

export const useRecurringStore = create<RecurringState>()((set, get) => ({
  recurring: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('recurring_transactions').select('*')
    if (!error) {
      const recurring = ((data ?? []) as RecurringTransaction[]).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      await db.transaction('rw', db.recurringTransactions, async () => {
        await db.recurringTransactions.clear()
        await db.recurringTransactions.bulkAdd(recurring)
      })
      set({ recurring, loading: false, ready: true })
    } else {
      console.error('[supabase:recurring_transactions:load]', error)
      const rows = await db.recurringTransactions.toArray()
      set({ recurring: rows.sort((a, b) => a.name.localeCompare(b.name, 'tr')), loading: false, ready: true })
    }
  },

  add: async (r) => {
    await db.recurringTransactions.add(r)
    const userId = await getUserId()
    supabase.from('recurring_transactions').insert({ ...r, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:recurring_transactions:insert]', error)
    })
    set(s => ({ recurring: [...s.recurring, r].sort((a, b) => a.name.localeCompare(b.name, 'tr')) }))
  },

  update: async (id, patch) => {
    await db.recurringTransactions.update(id, patch)
    supabase.from('recurring_transactions').update(patch).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:recurring_transactions:update]', error)
    })
    set(s => ({
      recurring: s.recurring.map(r => r.id === id ? { ...r, ...patch } : r),
    }))
  },

  remove: async (id) => {
    await db.recurringTransactions.delete(id)
    supabase.from('recurring_transactions').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:recurring_transactions:delete]', error)
    })
    set(s => ({ recurring: s.recurring.filter(r => r.id !== id) }))
  },

  toggleActive: async (id) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return
    const isActive = !r.isActive
    await db.recurringTransactions.update(id, { isActive })
    supabase.from('recurring_transactions').update({ isActive }).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:recurring_transactions:toggleActive]', error)
    })
    set(s => ({
      recurring: s.recurring.map(x => x.id === id ? { ...x, isActive } : x),
    }))
  },

  getDue: (asOf) => {
    return get().recurring.filter(r => {
      if (!r.isActive) return false
      if (r.endDate && r.endDate < asOf) return false
      return r.nextDueDate <= asOf
    })
  },

  markGenerated: async (id, asOf) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return

    let next = advanceDueDate(r.nextDueDate, r.frequency)
    while (next <= asOf) {
      next = advanceDueDate(next, r.frequency)
    }

    const patch: Partial<RecurringTransaction> = {
      nextDueDate: next,
      lastGeneratedDate: r.nextDueDate,
    }
    await db.recurringTransactions.update(id, patch)
    supabase.from('recurring_transactions').update(patch).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:recurring_transactions:markGenerated]', error)
    })
    set(s => ({
      recurring: s.recurring.map(x => x.id === id ? { ...x, ...patch } : x),
    }))
  },
}))
