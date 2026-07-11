'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Person, PersonRole } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'

interface PeopleState {
  people: Person[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (name: string, role: PersonRole) => Promise<Person>
  rename: (id: string, name: string) => Promise<void>
  setUrl: (id: string, url: string | undefined) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
}

export const usePeopleStore = create<PeopleState>()((set, get) => ({
  people: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const people = await loadEntities<Person>(
      'people', 'people',
      async () => (await db.people.toArray()).filter(isLive),
    )
    set({ people, loading: false, ready: true })
  },

  add: async (name, role) => {
    const person: Person = {
      id: crypto.randomUUID(),
      name: name.trim(),
      role,
      createdAt: new Date().toISOString(),
    }
    await localUpsert('people', person)
    set(s => ({ people: [...s.people, person] }))
    return person
  },

  rename: async (id, name) => {
    const trimmed = name.trim()
    await localPatch('people', id, { name: trimmed })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, name: trimmed } : p) }))
  },

  setUrl: async (id, url) => {
    const value = url?.trim() || undefined
    // null clears the column (undefined is normalised to null in the snapshot).
    await localPatch('people', id, { url: value ?? null })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, url: value } : p) }))
  },

  remove: async (id, opts) => {
    const person = get().people.find(p => p.id === id)
    await softDelete('people', id) // C3 — soft delete via durable outbox
    set(s => ({ people: s.people.filter(p => p.id !== id) }))
    if (person && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Kişi silindi', async () => {
        await localPatch('people', id, { deleted_at: null })
        set(s => ({ people: [...s.people, person] }))
      })
    }
  },
}))
