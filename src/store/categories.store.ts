'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import type { Category, CategoryScope, DefaultCategoryDef } from '@/types'
import { DEFAULT_CATEGORIES } from '@/types'

// ── One-time icon migration map ────────────────────────────────────────────
// Converts legacy noto:/Iconify AND Lucide PascalCase names → Tabler kebab.
// Run every load() so Supabase is always corrected on fetch, regardless of
// whether prior async Supabase writes succeeded.
const NOTO_TO_TABLER: Record<string, { icon: string; color: string }> = {
  // ── Lucide PascalCase → Tabler (era: commit 1b769c8) ──────────────────
  'UtensilsCrossed': { icon: 'tools-kitchen-2',   color: '#F97316' },
  'ShoppingCart':    { icon: 'shopping-cart',      color: '#10B981' },
  'Coffee':          { icon: 'coffee',             color: '#F59E0B' },
  'Train':           { icon: 'train',              color: '#3B82F6' },
  'Home':            { icon: 'home',               color: '#EAB308' },
  'ShoppingBag':     { icon: 'shopping-bag',       color: '#EC4899' },
  'Receipt':         { icon: 'receipt',            color: '#F97316' },
  'RefreshCw':       { icon: 'refresh',            color: '#8B5CF6' },
  'Heart':           { icon: 'heart',              color: '#EF4444' },
  'Shield':          { icon: 'shield',             color: '#64748B' },
  'TrendingUp':      { icon: 'trending-up',        color: '#6366F1' },
  'Briefcase':       { icon: 'briefcase',          color: '#10B981' },
  'Landmark':        { icon: 'building-bank',      color: '#1D4ED8' },
  'Zap':             { icon: 'bolt',               color: '#EAB308' },
  'Scale':           { icon: 'scale',              color: '#6B7280' },
  'Wrench':          { icon: 'tool',               color: '#6B7280' },
  'Cigarette':       { icon: 'smoking',            color: '#78716C' },
  'Plane':           { icon: 'plane',              color: '#0EA5E9' },
  'Sparkles':        { icon: 'sparkles',           color: '#EC4899' },
  'Car':             { icon: 'car',                color: '#3B82F6' },
  'Wine':            { icon: 'bottle',             color: '#F97316' },
  'Pencil':          { icon: 'pencil',             color: '#6366F1' },
  'Monitor':         { icon: 'device-desktop',     color: '#3B82F6' },
  'Package':         { icon: 'package',            color: '#6B7280' },
  'MapPin':          { icon: 'map-pin',            color: '#6B7280' },
  'ParkingCircle':   { icon: 'parking',            color: '#3B82F6' },
  'Fuel':            { icon: 'gas-station',        color: '#3B82F6' },
  'Sofa':            { icon: 'sofa',               color: '#EAB308' },
  'Hammer':          { icon: 'hammer',             color: '#EAB308' },
  'Key':             { icon: 'key',                color: '#EAB308' },
  'Utensils':        { icon: 'tools-kitchen-2',    color: '#EAB308' },
  'Tv':              { icon: 'device-tv',          color: '#EAB308' },
  'Shirt':           { icon: 'hanger',             color: '#EC4899' },
  'Building':        { icon: 'building',           color: '#F97316' },
  'Flame':           { icon: 'flame',              color: '#F97316' },
  'Phone':           { icon: 'phone',              color: '#F97316' },
  'Droplets':        { icon: 'droplet',            color: '#06B6D4' },
  'Lightbulb':       { icon: 'bulb',               color: '#EAB308' },
  'Wifi':            { icon: 'wifi',               color: '#F97316' },
  'Banknote':        { icon: 'cash',               color: '#10B981' },
  'HandCoins':       { icon: 'coins',              color: '#10B981' },
  'Gift':            { icon: 'gift',               color: '#10B981' },
  'Stethoscope':     { icon: 'stethoscope',        color: '#EF4444' },
  'Pill':            { icon: 'pill',               color: '#EF4444' },
  'Dumbbell':        { icon: 'barbell',            color: '#EF4444' },
  'Music':           { icon: 'music',              color: '#A855F7' },
  'Gamepad2':        { icon: 'device-gamepad-2',   color: '#A855F7' },
  'Film':            { icon: 'movie',              color: '#A855F7' },
  'BookOpen':        { icon: 'book',               color: '#A855F7' },
  'Ticket':          { icon: 'ticket',             color: '#A855F7' },
  'Headphones':      { icon: 'headphones',         color: '#A855F7' },
  'Camera':          { icon: 'camera',             color: '#A855F7' },
  'Sun':             { icon: 'sun',                color: '#A855F7' },
  'GraduationCap':   { icon: 'school',             color: '#6B7280' },
  'Star':            { icon: 'star',               color: '#6B7280' },
  'Leaf':            { icon: 'leaf',               color: '#6B7280' },
  'Baby':            { icon: 'baby-carriage',      color: '#EF4444' },
  'Brain':           { icon: 'brain',              color: '#EF4444' },
  'Coins':           { icon: 'coin',               color: '#6366F1' },
  'PiggyBank':       { icon: 'pig-money',          color: '#6366F1' },
  'CreditCard':      { icon: 'credit-card',        color: '#6366F1' },
  'Wallet':          { icon: 'wallet',             color: '#6366F1' },
  'BadgeDollarSign': { icon: 'moneybag',           color: '#6366F1' },

  // ── noto:/Iconify → Tabler (era: commit 77f2cde) ─────────────────────
  'noto:money-bag':                      { icon: 'moneybag',          color: '#6366F1' },
  'noto:credit-card':                    { icon: 'credit-card',       color: '#6366F1' },
  'noto:dollar-banknote':                { icon: 'cash',              color: '#6366F1' },
  'noto:chart-increasing':               { icon: 'trending-up',       color: '#6366F1' },
  'noto:bank':                           { icon: 'building-bank',     color: '#1D4ED8' },
  'noto:briefcase':                      { icon: 'briefcase',         color: '#10B981' },
  'noto:wrapped-gift':                   { icon: 'gift',              color: '#10B981' },
  'noto:red-heart':                      { icon: 'heart-handshake',   color: '#10B981' },
  'noto:receipt':                        { icon: 'receipt',           color: '#F97316' },
  'noto:money-with-wings':               { icon: 'arrow-up-right',    color: '#10B981' },
  'noto:balance-scale':                  { icon: 'scale',             color: '#78716C' },
  'noto:scales':                         { icon: 'scale',             color: '#6B7280' },
  'noto:package':                        { icon: 'package',           color: '#6B7280' },
  'noto:fork-and-knife-with-plate':      { icon: 'tools-kitchen-2',   color: '#F97316' },
  'noto:shopping-cart':                  { icon: 'shopping-cart',     color: '#10B981' },
  'noto:hot-beverage':                   { icon: 'coffee',            color: '#F59E0B' },
  'noto:beer-mug':                       { icon: 'beer',              color: '#F59E0B' },
  'noto:fork-and-knife':                 { icon: 'tools-kitchen-2',   color: '#EAB308' },
  'noto:pizza':                          { icon: 'pizza',             color: '#F97316' },
  'noto:birthday-cake':                  { icon: 'cake',              color: '#F97316' },
  'noto:tropical-drink':                 { icon: 'bottle',            color: '#F97316' },
  'noto:automobile':                     { icon: 'car',               color: '#3B82F6' },
  'noto:bus':                            { icon: 'bus',               color: '#3B82F6' },
  'noto:taxi':                           { icon: 'car',               color: '#3B82F6' },
  'noto:train':                          { icon: 'train',             color: '#3B82F6' },
  'noto:airplane':                       { icon: 'plane',             color: '#0EA5E9' },
  'noto:fuel-pump':                      { icon: 'gas-station',       color: '#3B82F6' },
  'noto:p-button':                       { icon: 'parking',           color: '#3B82F6' },
  'noto:motorway':                       { icon: 'road',              color: '#3B82F6' },
  'noto:bicycle':                        { icon: 'bike',              color: '#3B82F6' },
  'noto:ferry':                          { icon: 'sailboat',          color: '#3B82F6' },
  'noto:house':                          { icon: 'home',              color: '#EAB308' },
  'noto:key':                            { icon: 'key',               color: '#EAB308' },
  'noto:hammer':                         { icon: 'hammer',            color: '#EAB308' },
  'noto:wrench':                         { icon: 'tool',              color: '#6B7280' },
  'noto:high-voltage':                   { icon: 'bolt',              color: '#EAB308' },
  'noto:droplet':                        { icon: 'droplet',           color: '#06B6D4' },
  'noto:fire':                           { icon: 'flame',             color: '#F97316' },
  'noto:globe-with-meridians':           { icon: 'wifi',              color: '#F97316' },
  'noto:mobile-phone':                   { icon: 'phone',             color: '#F97316' },
  'noto:telephone-receiver':             { icon: 'phone-call',        color: '#F97316' },
  'noto:television':                     { icon: 'device-tv',         color: '#EAB308' },
  'noto:couch-and-lamp':                 { icon: 'sofa',              color: '#EAB308' },
  'noto:office-building':                { icon: 'building',          color: '#F97316' },
  'noto:sparkles':                       { icon: 'sparkles',          color: '#EC4899' },
  'noto:shield':                         { icon: 'shield',            color: '#64748B' },
  'noto:hospital':                       { icon: 'building-hospital', color: '#EF4444' },
  'noto:stethoscope':                    { icon: 'stethoscope',       color: '#EF4444' },
  'noto:pill':                           { icon: 'pill',              color: '#EF4444' },
  'noto:brain':                          { icon: 'brain',             color: '#EF4444' },
  'noto:tooth':                          { icon: 'dental',            color: '#EF4444' },
  'noto:baby':                           { icon: 'baby-carriage',     color: '#EF4444' },
  'noto:person-running':                 { icon: 'run',               color: '#EF4444' },
  'noto:dumbbell':                       { icon: 'barbell',           color: '#EF4444' },
  'noto:video-game':                     { icon: 'device-gamepad-2',  color: '#A855F7' },
  'noto:musical-notes':                  { icon: 'music',             color: '#A855F7' },
  'noto:clapper-board':                  { icon: 'movie',             color: '#A855F7' },
  'noto:books':                          { icon: 'book',              color: '#A855F7' },
  'noto:ticket':                         { icon: 'ticket',            color: '#A855F7' },
  'noto:headphone':                      { icon: 'headphones',        color: '#A855F7' },
  'noto:camera':                         { icon: 'camera',            color: '#A855F7' },
  'noto:party-popper':                   { icon: 'confetti',          color: '#A855F7' },
  'noto:sun':                            { icon: 'sun',               color: '#A855F7' },
  'noto:shopping-bags':                  { icon: 'shopping-bag',      color: '#EC4899' },
  'noto:t-shirt':                        { icon: 'hanger',            color: '#EC4899' },
  'noto:laptop-computer':                { icon: 'device-laptop',     color: '#EC4899' },
  'noto:desktop-computer':               { icon: 'device-desktop',    color: '#3B82F6' },
  'noto:pencil':                         { icon: 'pencil',            color: '#6366F1' },
  'noto:lipstick':                       { icon: 'sparkles',          color: '#EC4899' },
  'noto:cigarette':                      { icon: 'smoking',           color: '#78716C' },
  'noto:ring':                           { icon: 'diamond',           color: '#EC4899' },
  'noto:graduation-cap':                 { icon: 'school',            color: '#6B7280' },
  'noto:star':                           { icon: 'star',              color: '#6B7280' },
  'noto:leaf-fluttering-in-wind':        { icon: 'leaf',              color: '#6B7280' },
  'noto:counterclockwise-arrows-button': { icon: 'refresh',           color: '#8B5CF6' },
}
const LEGACY_COLOR = '#6B8F80'

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
      const { categories, dirty } = applyIconMigration(
        (data ?? [] as Category[]).sort((a, b) => a.sortOrder - b.sortOrder)
      )
      await db.transaction('rw', db.categories, async () => {
        await db.categories.clear()
        await db.categories.bulkAdd(categories)
      })
      set({ categories, loading: false })
      // Persist migrated icons back to Supabase asynchronously
      if (dirty.length > 0) {
        dirty.forEach(cat => {
          supabase.from('categories')
            .update({ icon: cat.icon, color: cat.color })
            .eq('id', cat.id)
            .then(({ error: e }) => {
              if (e) console.error('[supabase:categories:migrate-icons]', e)
            })
        })
      }
    } else {
      console.error('[supabase:categories:load]', error)
      const raw = await db.categories.toArray()
      set({ categories: raw.sort((a, b) => a.sortOrder - b.sortOrder), loading: false })
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
      toInsert.push({ ...cat, id })
    }

    // Phase 2: alt kategoriler — _parentName olanlar
    for (const def of DEFAULT_CATEGORIES.filter((d: DefaultCategoryDef) => !!d._parentName)) {
      if (byName.has(def.name)) continue
      const parentId = nameToId.get(def._parentName!)
      const id = crypto.randomUUID()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _parentName, ...cat } = def
      toInsert.push({ ...cat, id, ...(parentId && { parentId }) })
    }

    if (toInsert.length > 0) {
      await db.categories.bulkAdd(toInsert)
      const userId = await getUserId()
      const forDb = userId ? toInsert.map(c => ({ ...c, user_id: userId })) : toInsert
      supabase.from('categories').insert(forDb).then(({ error }) => {
        if (error) console.error('[supabase:categories:insert-defaults]', error)
      })
      set(s => ({
        categories: [...s.categories, ...toInsert].sort((a, b) => a.sortOrder - b.sortOrder),
      }))
    }

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
      c.scope === scope,
    )
  },

  getById: (id) => get().categories.find(c => c.id === id),
}))
