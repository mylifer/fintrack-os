'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Person, PersonRole } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { getBrandDomain } from '@/lib/people/brands'
import { resolveBrandDomain } from '@/lib/people/brand-logo'

interface PeopleState {
  people: Person[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (name: string, role: PersonRole) => Promise<Person>
  rename: (id: string, name: string) => Promise<void>
  setUrl: (id: string, url: string | undefined) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
  restore: (id: string) => Promise<void>
}

// Alıcı logosu otomatik çözümleme (fire-and-forget): internetten BİREBİR isim
// eşleşmesi bulunursa favicon domain'ini person.url'e kalıcı yazar. Küratörlü
// liste zaten eşleşiyorsa atlanır — avatar onu kullanır ve online sonuç
// (ör. migros.ch) yereldeki daha doğru domain'i (migros.com.tr) ezmesin.
function autoResolveRecipientLogo(id: string, name: string) {
  if (getBrandDomain(name)) return
  resolveBrandDomain(name)
    .then(domain => {
      if (!domain) return
      const { people, setUrl } = usePeopleStore.getState()
      const p = people.find(p => p.id === id)
      // Kullanıcı bu arada elle URL girdiyse üzerine yazma
      if (p && !p.url) return setUrl(id, domain)
    })
    .catch(() => {})
}

// Oturum başına bir kez: URL'siz mevcut alıcılar için arka planda logo ara.
let backfillStarted = false
async function backfillRecipientLogos(people: Person[]) {
  if (backfillStarted || typeof window === 'undefined') return
  backfillStarted = true
  const targets = people.filter(p => p.role === 'recipient' && !p.url && !p.isArchived)
  // Sıralı: dış servisleri yoklamamak için (negatif sonuçlar localStorage'da
  // 7 gün susturulduğundan pratikte yalnızca yeni isimler sorgulanır)
  for (const p of targets) {
    if (getBrandDomain(p.name)) continue
    const domain = await resolveBrandDomain(p.name).catch(() => null)
    if (!domain) continue
    const { people: current, setUrl } = usePeopleStore.getState()
    const live = current.find(x => x.id === p.id)
    if (live && !live.url) await setUrl(p.id, domain).catch(() => {})
  }
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
    void backfillRecipientLogos(people)
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
    if (role === 'recipient') autoResolveRecipientLogo(person.id, person.name)
    return person
  },

  rename: async (id, name) => {
    const trimmed = name.trim()
    await localPatch('people', id, { name: trimmed })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, name: trimmed } : p) }))
    const person = get().people.find(p => p.id === id)
    if (person?.role === 'recipient' && !person.url) autoResolveRecipientLogo(id, trimmed)
  },

  setUrl: async (id, url) => {
    const value = url?.trim() || undefined
    // null clears the column (undefined is normalised to null in the snapshot).
    await localPatch('people', id, { url: value ?? null })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, url: value } : p) }))
  },

  // Archive, don't tombstone: the person stays in the store (flagged) so every
  // transaction referencing them keeps resolving the name; pickers/lists hide
  // archived people. Linked transactions are NEVER touched.
  remove: async (id, opts) => {
    const person = get().people.find(p => p.id === id)
    await localPatch('people', id, { isArchived: true })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, isArchived: true } : p) }))
    if (person && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Kişi arşivlendi', async () => {
        await get().restore(id)
      })
    }
  },

  restore: async (id) => {
    await localPatch('people', id, { isArchived: false })
    set(s => ({ people: s.people.map(p => p.id === id ? { ...p, isArchived: false } : p) }))
  },
}))
