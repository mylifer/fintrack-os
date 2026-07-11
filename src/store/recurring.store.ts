'use client'

import { create } from 'zustand'
import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import { db } from '@/lib/db'
import type { RecurringTransaction, RecurringFrequency } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'

function advanceDueDate(current: string, frequency: RecurringFrequency): string {
  const d = parseISO(current)
  switch (frequency) {
    case 'daily':   return format(addDays(d, 1),   'yyyy-MM-dd')
    case 'weekly':  return format(addWeeks(d, 1),  'yyyy-MM-dd')
    case 'monthly': return format(addMonths(d, 1), 'yyyy-MM-dd')
    case 'yearly':  return format(addYears(d, 1),  'yyyy-MM-dd')
  }
}

const OCCURRENCE_CAP = 1000 // runaway guard for a very stale nextDueDate

/** Every occurrence date from nextDueDate up to & including asOf (endDate-aware).
 *  Drives catch-up generation: months offline → one transaction per missed
 *  period, not a single one. */
export function recurringOccurrences(r: RecurringTransaction, asOf: string): string[] {
  const out: string[] = []
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && (!r.endDate || d <= r.endDate) && guard < OCCURRENCE_CAP) {
    out.push(d)
    d = advanceDueDate(d, r.frequency)
    guard++
  }
  return out
}

/** First occurrence strictly after asOf — the new nextDueDate after (re)processing. */
function nextDueAfter(r: RecurringTransaction, asOf: string): string {
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && guard < OCCURRENCE_CAP) {
    d = advanceDueDate(d, r.frequency)
    guard++
  }
  return d
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
  skip: (id: string, asOf: string) => Promise<void>
}

export const useRecurringStore = create<RecurringState>()((set, get) => ({
  recurring: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const byName = (rows: RecurringTransaction[]) =>
      rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    const recurring = await loadEntities<RecurringTransaction>(
      'recurring_transactions', 'recurring',
      async () => byName((await db.recurringTransactions.toArray()).filter(isLive)),
      byName,
    )
    set({ recurring, loading: false, ready: true })
  },

  add: async (r) => {
    await localUpsert('recurring_transactions', r)
    set(s => ({ recurring: [...s.recurring, r].sort((a, b) => a.name.localeCompare(b.name, 'tr')) }))
  },

  update: async (id, patch) => {
    await localPatch('recurring_transactions', id, patch as Record<string, unknown>)
    set(s => ({
      recurring: s.recurring.map(r => r.id === id ? { ...r, ...patch } : r),
    }))
  },

  remove: async (id) => {
    await softDelete('recurring_transactions', id) // C3 — soft delete via durable outbox
    set(s => ({ recurring: s.recurring.filter(r => r.id !== id) }))
  },

  toggleActive: async (id) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return
    const isActive = !r.isActive
    await localPatch('recurring_transactions', id, { isActive })
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

  // Advance past all periods up to asOf and stamp lastGeneratedDate to the LAST
  // generated occurrence (catch-up aware). Call AFTER generating the occurrences.
  markGenerated: async (id, asOf) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return

    const occ = recurringOccurrences(r, asOf)
    const patch: Partial<RecurringTransaction> = {
      nextDueDate: nextDueAfter(r, asOf),
      lastGeneratedDate: occ.length ? occ[occ.length - 1] : r.lastGeneratedDate,
    }
    await localPatch('recurring_transactions', id, patch as Record<string, unknown>)
    set(s => ({
      recurring: s.recurring.map(x => x.id === id ? { ...x, ...patch } : x),
    }))
  },

  // Skip the pending period(s) WITHOUT generating — advances nextDueDate but
  // leaves lastGeneratedDate untouched (a skip is not a generation, L1).
  skip: async (id, asOf) => {
    const r = get().recurring.find(x => x.id === id)
    if (!r) return
    const patch: Partial<RecurringTransaction> = { nextDueDate: nextDueAfter(r, asOf) }
    await localPatch('recurring_transactions', id, patch as Record<string, unknown>)
    set(s => ({
      recurring: s.recurring.map(x => x.id === id ? { ...x, ...patch } : x),
    }))
  },
}))
