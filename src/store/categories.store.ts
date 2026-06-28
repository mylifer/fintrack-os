'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import type { Category, CategoryScope } from '@/types'
import { DEFAULT_CATEGORIES } from '@/types'

interface CategoryState {
  categories: Category[]
  loading: boolean
  load: () => Promise<void>
  initDefaults: () => Promise<void>
  add: (cat: Category) => Promise<void>
  update: (id: string, patch: Partial<Category>) => Promise<void>
  remove: (id: string) => Promise<void>
  getByScope: (scope: CategoryScope) => Category[]
  getById: (id: string) => Category | undefined
}

export const useCategoryStore = create<CategoryState>()((set, get) => ({
  categories: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('categories').select('*')
    if (!error) {
      const categories = (data ?? [] as Category[]).sort((a, b) => a.sortOrder - b.sortOrder)
      await db.transaction('rw', db.categories, async () => {
        await db.categories.clear()
        await db.categories.bulkAdd(categories)
      })
      set({ categories, loading: false })
    } else {
      console.error('[supabase:categories:load]', error)
      const raw = await db.categories.toArray()
      set({ categories: raw.sort((a, b) => a.sortOrder - b.sortOrder), loading: false })
    }
  },

  initDefaults: async () => {
    const existing = await db.categories.count()
    if (existing > 0) return

    const cats: Category[] = DEFAULT_CATEGORIES.map(c => ({
      ...c,
      id: crypto.randomUUID(),
    }))
    await db.categories.bulkAdd(cats)
    const userId = await getUserId()
    const catsForDb = userId ? cats.map(c => ({ ...c, user_id: userId })) : cats
    supabase.from('categories').insert(catsForDb).then(({ error }) => {
      if (error) console.error('[supabase:categories:insert-defaults]', error)
    })
    set({ categories: cats })
  },

  add: async (cat) => {
    await db.categories.add(cat)
    const userId = await getUserId()
    supabase.from('categories').insert({ ...cat, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:categories:insert]', error)
    })
    set(s => ({ categories: [...s.categories, cat].sort((a, b) => a.sortOrder - b.sortOrder) }))
  },

  update: async (id, patch) => {
    await db.categories.update(id, patch)
    supabase.from('categories').update(patch).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:categories:update]', error)
    })
    set(s => ({
      categories: s.categories.map(c => c.id === id ? { ...c, ...patch } : c),
    }))
  },

  remove: async (id) => {
    const cat = get().categories.find(c => c.id === id)
    if (cat?.isSystem) return

    await db.categories.delete(id)
    supabase.from('categories').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:categories:delete]', error)
    })
    set(s => ({ categories: s.categories.filter(c => c.id !== id) }))
  },

  getByScope: (scope) => {
    return get().categories.filter(c =>
      c.scope === scope || c.scope === 'both',
    )
  },

  getById: (id) => get().categories.find(c => c.id === id),
}))
