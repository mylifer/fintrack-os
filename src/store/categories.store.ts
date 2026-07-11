'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localBulkUpsert, localPatch, reconcilingPull } from '@/lib/sync/engine'
import type { Category, CategoryScope, DefaultCategoryDef } from '@/types'
import { DEFAULT_CATEGORIES } from '@/types'
// One-time icon migration map (emoji / Lucide PascalCase / noto: → Tabler kebab).
// Shared with the Dexie v6 upgrade — single source of truth in lib/legacy-icon-map.
// Run every load() so Supabase is always corrected on fetch, regardless of
// whether prior async Supabase writes succeeded.
import { NOTO_TO_TABLER, LEGACY_COLOR } from '@/lib/legacy-icon-map'
import { useUndoStore, type RemoveOptions } from './undo.store'

function applyIconMigration(raw: Category[]): { categories: Category[]; dirty: Category[] } {
  const dirty: Category[] = []
  const categories = raw.map(c => {
    const m = NOTO_TO_TABLER[c.icon]
    if (!m) return c
    const patched = { ...c, icon: m.icon, ...(c.color === LEGACY_COLOR && { color: m.color }) }
    dirty.push(patched)
    return patched
  })
  return { categories, dirty }
}

interface CategoryState {
  categories: Category[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  initDefaults: () => Promise<void>
  add: (cat: Category) => Promise<void>
  update: (id: string, patch: Partial<Category>) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
  restore: (id: string) => Promise<void>
  getByScope: (scope: CategoryScope) => Category[]
  getById: (id: string) => Category | undefined
}

export const useCategoryStore = create<CategoryState>()((set, get) => ({
  categories: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    try {
      const rows = await reconcilingPull<Category>('categories')
      const { categories, dirty } = applyIconMigration(rows.sort((a, b) => a.sortOrder - b.sortOrder))
      set({ categories, loading: false, ready: true })
      // Persist migrated icons durably (Dexie + outbox).
      for (const cat of dirty) {
        await localPatch('categories', cat.id, { icon: cat.icon, color: cat.color })
      }
    } catch (err) {
      console.error('[categories:load]', err)
      const raw = (await db.categories.toArray()).filter(isLive)
      const { categories } = applyIconMigration(raw.sort((a, b) => a.sortOrder - b.sortOrder))
      set({ categories, loading: false, ready: true })
    }
  },

  initDefaults: async () => {
    const existing = await db.categories.toArray()
    const byName   = new Map(existing.map(c => [c.name, c.id]))

    // Phase 1: üst kategoriler — _parentName olmayanlar
    const nameToId = new Map<string, string>(byName)
    const toInsert: Category[] = []

    for (const def of DEFAULT_CATEGORIES.filter((d: DefaultCategoryDef) => !d._parentName)) {
      if (byName.has(def.name)) continue
      const id = crypto.randomUUID()
      nameToId.set(def.name, id)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _parentName, ...cat } = def
      toInsert.push({ ...cat, id, isArchived: false })
    }

    // Phase 2: alt kategoriler — _parentName olanlar
    for (const def of DEFAULT_CATEGORIES.filter((d: DefaultCategoryDef) => !!d._parentName)) {
      if (byName.has(def.name)) continue
      const parentId = nameToId.get(def._parentName!)
      const id = crypto.randomUUID()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _parentName, ...cat } = def
      toInsert.push({ ...cat, id, isArchived: false, ...(parentId && { parentId }) })
    }

    if (toInsert.length > 0) {
      await localBulkUpsert('categories', toInsert)
      set(s => ({
        categories: [...s.categories, ...toInsert].sort((a, b) => a.sortOrder - b.sortOrder),
      }))
    }

    // Phase 3: icon sync for ALL system categories.
    // Pass A — name match: update categories whose name is in current DEFAULT_CATEGORIES.
    // Pass B — format detect: update any remaining system category whose icon is still a
    //          legacy format (emoji, Lucide PascalCase, noto:) using NOTO_TO_TABLER map.
    const defByName = new Map(
      DEFAULT_CATEGORIES.map(d => [d.name, { icon: d.icon, color: d.color }])
    )

    const isLegacyIcon = (icon: string) =>
      icon in NOTO_TO_TABLER ||          // known legacy format
      icon.includes(':') ||              // noto: / iconify
      /^[A-Z]/.test(icon) ||            // Lucide PascalCase
      !/^[a-z]/.test(icon)              // emoji or any non-kebab start

    const toSync = existing.filter(c => {
      if (!c.isSystem) return false
      const def = defByName.get(c.name)
      if (def) return c.icon !== def.icon || c.color !== def.color  // Pass A
      return isLegacyIcon(c.icon)                                    // Pass B
    })

    if (toSync.length > 0) {
      const updates: Array<{ id: string; patch: Partial<Category> }> = []
      for (const cat of toSync) {
        const def = defByName.get(cat.name)
        let patch: Partial<Category>
        if (def) {
          patch = { icon: def.icon, color: def.color }
        } else {
          const m = NOTO_TO_TABLER[cat.icon]
          patch = m
            ? { icon: m.icon }
            : { icon: 'package' }  // last-resort fallback for unknown icons
        }
        await localPatch('categories', cat.id, patch as Record<string, unknown>)
        updates.push({ id: cat.id, patch })
      }
      set(s => ({
        categories: s.categories.map(c => {
          if (!c.isSystem) return c
          const u = updates.find(x => x.id === c.id)
          return u ? { ...c, ...u.patch } : c
        }),
      }))
    }
  },

  add: async (cat) => {
    const entry: Category = { ...cat, isArchived: false }
    await localUpsert('categories', entry)
    set(s => ({ categories: [...s.categories, entry].sort((a, b) => a.sortOrder - b.sortOrder) }))
  },

  update: async (id, patch) => {
    await localPatch('categories', id, patch as Record<string, unknown>)
    set(s => ({
      categories: s.categories.map(c => c.id === id ? { ...c, ...patch } : c),
    }))
  },

  remove: async (id, opts) => {
    const cat = get().categories.find(c => c.id === id)
    if (cat?.isSystem) return

    // Categories use archive (isArchived), not tombstones — still durable via outbox.
    await localPatch('categories', id, { isArchived: true })
    set(s => ({
      categories: s.categories.map(c => c.id === id ? { ...c, isArchived: true } : c),
    }))

    if (cat && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Kategori arşivlendi', async () => {
        await get().restore(id)
      })
    }
  },

  restore: async (id) => {
    await localPatch('categories', id, { isArchived: false })
    set(s => ({
      categories: s.categories.map(c => c.id === id ? { ...c, isArchived: false } : c),
    }))
  },

  getByScope: (scope) => {
    return get().categories.filter(c => c.scope === scope && !c.isArchived)
  },

  getById: (id) => get().categories.find(c => c.id === id),
}))
