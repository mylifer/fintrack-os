'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { RecurringTransaction } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { rowInActiveWorkspace } from '@/lib/workspace-context'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { recurringOccurrences, nextDueAfter } from '@/lib/utils/recurrence'

// recurringOccurrences moved to a store-free util so forecast/analytics can use
// it without pulling in the Supabase client. Re-exported for existing importers.
export { recurringOccurrences } from '@/lib/utils/recurrence'

interface RecurringState {
  recurring: RecurringTransaction[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (r: RecurringTransaction) => Promise<void>
  update: (id: string, patch: Partial<RecurringTransaction>) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
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
      async () => byName((await db.recurringTransactions.toArray()).filter(isLive).filter(rowInActiveWorkspace)),
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

  remove: async (id, opts) => {
    const r = get().recurring.find(x => x.id === id)
    await softDelete('recurring_transactions', id) // C3 — soft delete via durable outbox
    set(s => ({ recurring: s.recurring.filter(x => x.id !== id) }))
    if (r && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Tekrarlayan işlem silindi', async () => {
        await localPatch('recurring_transactions', id, { deleted_at: null })
        set(s => ({ recurring: [...s.recurring, r].sort((a, b) => a.name.localeCompare(b.name, 'tr')) }))
      })
    }
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
