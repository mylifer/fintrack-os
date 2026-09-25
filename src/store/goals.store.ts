'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { SavingsGoal } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { rowInActiveWorkspace } from '@/lib/workspace-context'
import { addMoney } from '@/lib/utils/money'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'

/* Birikim hedefleri store'u. İlerleme burada TUTULMAZ — her render'da
   lib/utils/goals.ts ile hesap bakiyesinden ya da savedAmount'tan türetilir. */

export type GoalPatch = Partial<Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>>

interface GoalsState {
  goals: SavingsGoal[]
  ready: boolean
  load: () => Promise<void>
  add: (goal: SavingsGoal) => Promise<void>
  update: (id: string, patch: GoalPatch) => Promise<void>
  /** Elle takip edilen hedefe para ekler (negatif = çıkarır); 0'ın altına inmez. */
  adjustSaved: (id: string, delta: number) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
}

// Engine yama anahtarlarındaki undefined'ı null yazar (nullifyPatch); bellekteki
// kopya da aynı değeri taşısın (payments.store ile aynı gerekçe).
function nullify<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v
  return out as T
}

export const useGoalsStore = create<GoalsState>()((set, get) => ({
  goals: [],
  ready: false,

  load: async () => {
    const goals = await loadEntities<SavingsGoal>(
      'savings_goals', 'savings-goals',
      async () => (await db.savingsGoals.toArray()).filter(isLive).filter(rowInActiveWorkspace),
    )
    set({ goals, ready: true })
  },

  add: async (goal) => {
    await localUpsert('savings_goals', goal)
    set(s => ({ goals: [...s.goals, goal] }))
  },

  update: async (id, patch) => {
    const full = nullify({ ...patch, updatedAt: new Date().toISOString() })
    await localPatch('savings_goals', id, full as Record<string, unknown>)
    set(s => ({ goals: s.goals.map(g => (g.id === id ? { ...g, ...full } : g)) }))
  },

  adjustSaved: async (id, delta) => {
    const goal = get().goals.find(g => g.id === id)
    if (!goal) return
    await get().update(id, { savedAmount: Math.max(0, addMoney(goal.savedAmount ?? 0, delta)) })
  },

  remove: async (id, opts) => {
    const goal = get().goals.find(g => g.id === id)
    await softDelete('savings_goals', id)
    set(s => ({ goals: s.goals.filter(g => g.id !== id) }))
    if (goal && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Hedef silindi', async () => {
        await localPatch('savings_goals', id, { deleted_at: null })
        set(s => ({ goals: [...s.goals, goal] }))
      })
    }
  },
}))
