import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Category } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   categories.store — tek seferlik otomatik ikon/renk geçişi

   load() sonunda kullanıcı kategorilerine adlarına göre ikon + renk yazılır;
   çalışma alanı başına bir kez, yalnız yetkili çekişten sonra. Sistem
   kategorileri atlanır (initDefaults onları DEFAULT_CATEGORIES'e geri çeker).
──────────────────────────────────────────────────────────────────────── */

let pulled: Category[] = []
let authoritative = true
const patches: Array<{ id: string; patch: Record<string, unknown> }> = []

vi.mock('@/lib/sync/engine', () => ({
  reconcilingPull: async () => pulled.map(c => ({ ...c })),
  lastPullWasAuthoritative: () => authoritative,
  localUpsert: async () => {},
  localBulkUpsert: async () => {},
  localPatch: async (_t: string, id: string, patch: Record<string, unknown>) => { patches.push({ id, patch }) },
}))
vi.mock('@/lib/db', () => ({ db: { categories: { toArray: async () => [] } } }))

// Test ortamı "node": geçiş bayrağı localStorage'da tutulduğu için bellek içi
// bir localStorage + window taklidi gerekir.
const storage = new Map<string, string>()
vi.stubGlobal('window', {})
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v) },
  removeItem: (k: string) => { storage.delete(k) },
})

const { useCategoryStore } = await import('./categories.store')
const { useUndoStore } = await import('./undo.store')
const { setActiveWorkspaceId } = await import('@/lib/workspace-context')

const cat = (o: Partial<Category>): Category => ({
  id: 'c1', name: 'Market', icon: 'package', color: '#6366F1', scope: 'expense',
  isSystem: false, sortOrder: 0, isArchived: false, ...o,
})

beforeEach(() => {
  pulled = []
  authoritative = true
  patches.length = 0
  storage.clear()
  setActiveWorkspaceId('ws-1')
  useCategoryStore.setState({ categories: [], loading: false, ready: false })
  useUndoStore.setState({ toasts: [] })
})

describe('categories.store otomatik ikon geçişi', () => {
  it('kullanıcı kategorilerine adına göre ikon + renk yazar, elle seçilmiş olanlara da', async () => {
    pulled = [
      cat({ id: 'a', name: 'Market' }),                                     // yer tutucu
      cat({ id: 'b', name: 'Netflix', icon: 'star', color: '#FF0000' }),   // elle seçilmiş
    ]

    await useCategoryStore.getState().load()

    const byId = Object.fromEntries(useCategoryStore.getState().categories.map(c => [c.id, c]))
    expect(byId.a).toMatchObject({ icon: 'shopping-cart', color: '#10B981' })
    expect(byId.b).toMatchObject({ icon: 'movie', color: '#A855F7' })
    // Kalıcı yazıldı (outbox yolu)
    expect(patches.map(p => p.id).sort()).toEqual(['a', 'b'])
  })

  it('sistem kategorilerine dokunmaz', async () => {
    pulled = [cat({ id: 's', name: 'Eğlence', icon: 'movie', color: '#A855F7', isSystem: true })]

    await useCategoryStore.getState().load()

    expect(patches).toHaveLength(0)
    expect(useCategoryStore.getState().categories[0].icon).toBe('movie')
  })

  it('çalışma alanı başına yalnız bir kez çalışır', async () => {
    pulled = [cat({ id: 'a', name: 'Market' })]
    await useCategoryStore.getState().load()
    expect(patches).toHaveLength(1)

    // Kullanıcı sonradan elle değiştirdi → ikinci yükleme ezmemeli
    patches.length = 0
    pulled = [cat({ id: 'a', name: 'Market', icon: 'basket', color: '#FF0000' })]
    await useCategoryStore.getState().load()
    expect(patches).toHaveLength(0)

    // Başka bir çalışma alanında ayrıca çalışır
    setActiveWorkspaceId('ws-2')
    await useCategoryStore.getState().load()
    expect(patches).toHaveLength(1)
  })

  it('YETKİSİZ çekişte çalışmaz ve kendini bitti saymaz', async () => {
    authoritative = false
    pulled = [cat({ id: 'a', name: 'Market' })]
    await useCategoryStore.getState().load()
    expect(patches).toHaveLength(0)

    // Bulut gelince (yetkili çekiş) çalışır
    authoritative = true
    await useCategoryStore.getState().load()
    expect(patches).toHaveLength(1)
  })

  it('değişiklik sayısını "Geri al" bildirimiyle gösterir; geri al eski ikon/rengi döndürür', async () => {
    pulled = [cat({ id: 'b', name: 'Netflix', icon: 'star', color: '#FF0000' })]
    await useCategoryStore.getState().load()

    const toasts = useUndoStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].label).toContain('1 kategori')

    await useUndoStore.getState().runUndo(toasts[0].id)

    expect(useCategoryStore.getState().categories[0]).toMatchObject({ icon: 'star', color: '#FF0000' })
    expect(patches.at(-1)).toEqual({ id: 'b', patch: { icon: 'star', color: '#FF0000' } })
  })

  it('değişecek bir şey yoksa bildirim göstermez', async () => {
    pulled = [cat({ id: 'a', name: 'Market', icon: 'shopping-cart', color: '#10B981' })]
    await useCategoryStore.getState().load()
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })
})
