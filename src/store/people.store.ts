'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase' // Supabase bağlantısı eklendi
import type { Person, PersonRole } from '@/types'

interface PeopleState {
  people: Person[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (name: string, role: PersonRole) => Promise<Person>
  rename: (id: string, name: string) => Promise<void>
  setUrl: (id: string, url: string | undefined) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const usePeopleStore = create<PeopleState>()((set) => ({
  people: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const people = await db.people.toArray()
    set({ people, loading: false, ready: true })
  },

  add: async (name, role) => {
    const person: Person = {
      id: crypto.randomUUID(),
      name: name.trim(),
      role,
      createdAt: new Date().toISOString(),
    }
    await db.people.add(person)
    
    // Supabase'e ekle
    supabase.from('people').insert(person).then()
    
    set(s => ({ people: [...s.people, person] }))
    return person
  },

  rename: async (id, name) => {
    const trimmed = name.trim()
    await db.people.update(id, { name: trimmed })
    
    // Supabase'de ismini güncelle
    supabase.from('people').update({ name: trimmed }).eq('id', id).then()
    
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, name: trimmed } : p) }))
  },

  setUrl: async (id, url) => {
    const value = url?.trim() || undefined
    // Dexie: update with empty string to "clear" since undefined is ignored
    await db.people.update(id, { url: value ?? '' } as Partial<Person>)
    
    // Supabase'de URL'yi güncelle (silinmişse null olarak yansıt)
    supabase.from('people').update({ url: value ?? null }).eq('id', id).then()
    
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, url: value } : p) }))
  },

  remove: async (id) => {
    await db.people.delete(id)
    
    // Supabase'den sil
    supabase.from('people').delete().eq('id', id).then()
    
    set(s => ({ people: s.people.filter(p => p.id !== id) }))
  },
}))