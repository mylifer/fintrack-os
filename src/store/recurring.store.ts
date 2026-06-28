'use client'

import { create } from 'zustand'
import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
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
    const rows = await db.recurringTransactions.toArray()
    rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    set({ recurring: rows, loading: false, ready: true })
    // Mevcut tekrarlayan işlemleri Supabase'e sync et (Phase 2 — accounts/categories önceden tamamlandı)
    if (rows.length > 0) {
      supabase.from('recurring_transactions').upsert(rows, { onConflict: 'id' }).then(({ error }) => {
        if (error) console.error('[supabase:recurring_transactions:sync]', error)
      })
    }
  },

  add: async (r) => {
    await db.recurringTransactions.add(r)
    supabase.from('recurring_transactions').insert(r).then(({ error }) => {
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
