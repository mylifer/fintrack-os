'use client'

import { create } from 'zustand'
import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
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
  // Returns active items whose nextDueDate <= asOf (today's date string)
  getDue: (asOf: string) => RecurringTransaction[]
  // Advances nextDueDate to the next occurrence; skips past any overdue cycles
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
  },

  add: async (r) => {
    await db.recurringTransactions.add(r)
    set(s => ({ recurring: [...s.recurring, r].sort((a, b) => a.name.localeCompare(b.name, 'tr')) }))
  },

  update: async (id, patch) => {
    await db.recurringTransactions.update(id, patch)
    set(s => ({
      recurring: s.recurring.map(r => r.id === id ? { ...r, ...patch } : r),
    }))
  },

  remove: async (id) => {
    await db.recurringTransactions.delete(id)
    set(s => ({ recurring: s.recurring.filter(r => r.id !== id) }))
  },

  toggleActive: async (id) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return
    const isActive = !r.isActive
    await db.recurringTransactions.update(id, { isActive })
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

    // Advance nextDueDate until it's past asOf (handles catching up after app was closed)
    let next = advanceDueDate(r.nextDueDate, r.frequency)
    while (next <= asOf) {
      next = advanceDueDate(next, r.frequency)
    }

    const patch: Partial<RecurringTransaction> = {
      nextDueDate: next,
      lastGeneratedDate: r.nextDueDate,
    }
    await db.recurringTransactions.update(id, patch)
    set(s => ({
      recurring: s.recurring.map(x => x.id === id ? { ...x, ...patch } : x),
    }))
  },
}))
