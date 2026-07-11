'use client'

import { create } from 'zustand'

/* ────────────────────────────────────────────────────────────────────────
   Undo store — holds transient "geri al" toasts for soft-deleted entities.

   Deliberately imports NOTHING from the data stores: it only stores opaque
   restore closures. The data stores import THIS store (to push a toast after a
   successful delete), so keeping the dependency one-way avoids an import cycle.

   Pending removal timers live in a module-level Map (not in the Zustand state)
   so `dismiss`/`runUndo` can clearTimeout the exact handle. State stays pure and
   serialisable; the Map is an implementation detail of the scheduler.
──────────────────────────────────────────────────────────────────────── */

export interface UndoToast {
  id: string
  label: string
  expiresAt: number
  undo: () => Promise<void>
}

/** Shared shape for the optional second arg of every store `remove(id, opts?)`. */
export interface RemoveOptions {
  /** When false, suppresses the undo toast (used for cascade child deletes). */
  undoable?: boolean
}

interface UndoState {
  toasts: UndoToast[]
  pushUndo: (label: string, undo: () => Promise<void>, ttlMs?: number) => void
  dismiss: (id: string) => void
  runUndo: (id: string) => Promise<void>
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearTimer(id: string): void {
  const handle = timers.get(id)
  if (handle) {
    clearTimeout(handle)
    timers.delete(id)
  }
}

export const useUndoStore = create<UndoState>()((set, get) => ({
  toasts: [],

  pushUndo: (label, undo, ttlMs = 6000) => {
    const id = crypto.randomUUID()
    const toast: UndoToast = { id, label, expiresAt: Date.now() + ttlMs, undo }
    set(s => ({ toasts: [...s.toasts, toast] }))
    // Auto-expire: drop the toast once its TTL elapses. Handle kept in the Map
    // so an explicit dismiss/undo can cancel it.
    const handle = setTimeout(() => {
      timers.delete(id)
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, ttlMs)
    timers.set(id, handle)
  },

  dismiss: (id) => {
    clearTimer(id)
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  },

  runUndo: async (id) => {
    const toast = get().toasts.find(t => t.id === id)
    // Dismiss FIRST so a double-click / racing tap can't fire the closure twice:
    // the second call finds no toast and returns.
    get().dismiss(id)
    if (!toast) return
    try {
      await toast.undo()
    } catch (err) {
      console.error('[undo:run]', err)
    }
  },
}))
