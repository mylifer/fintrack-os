import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Workspace } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   workspace.store — varsayılan çalışma alanı yalnız YETKİLİ boş sonuçta doğar

   Çıkış sonrası Dexie temizdir; girişteki çekiş ağ hatasıyla yarıda kalırsa
   reconcilingPull boş yerel kümeyi döndürür. load() bunu "hiç alan yok" sanıp
   yeni bir isDefault "Genel" oluşturuyor, bağlantı gelince kullanıcının iki
   varsayılan alanı oluyordu (eski satırlar yanlış alana düşebiliyordu).
──────────────────────────────────────────────────────────────────────── */

let pulled: Workspace[] = []
let authoritative = true
const upserts: unknown[] = []

// Paylaşım (0021): üyelik sorgusu oturumsuz tamamlanmamış sayılır, hiçbir şey silinmez
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('@/lib/sync/engine', () => ({
  reconcilingPull: async () => pulled,
  lastPullWasAuthoritative: () => authoritative,
  localUpsert: async (_table: string, entity: unknown) => { upserts.push(entity) },
  localPatch: async () => {},
}))
vi.mock('@/lib/db', () => ({ db: { workspaces: { toArray: async () => [] } } }))
vi.mock('@/lib/reload-stores', () => ({ reloadAllStores: async () => {} }))

const { useWorkspaceStore } = await import('./workspace.store')
const { getDefaultWorkspaceId, setActiveWorkspaceId, setDefaultWorkspaceId } = await import('@/lib/workspace-context')

const ws = (id: string, isDefault: boolean): Workspace => ({ id, name: id, isDefault, createdAt: '2026-01-01' })

beforeEach(() => {
  pulled = []
  authoritative = true
  upserts.length = 0
  setActiveWorkspaceId(null)
  setDefaultWorkspaceId(null)
  useWorkspaceStore.setState({ workspaces: [], activeId: null, ready: false })
})

describe('workspace.store load', () => {
  it('yetkili ve boş çekişte varsayılan "Genel" alanını oluşturur', async () => {
    await useWorkspaceStore.getState().load()

    expect(upserts).toHaveLength(1)
    const { workspaces, activeId, ready } = useWorkspaceStore.getState()
    expect(workspaces.map(w => w.name)).toEqual(['Genel'])
    expect(activeId).toBe(workspaces[0].id)
    expect(ready).toBe(true)
  })

  it('YETKİSİZ boş çekişte hiçbir alan oluşturmaz', async () => {
    authoritative = false

    await useWorkspaceStore.getState().load()

    expect(upserts).toHaveLength(0)
    const { workspaces, activeId, ready } = useWorkspaceStore.getState()
    expect(workspaces).toEqual([])
    expect(activeId).toBeNull()
    expect(ready).toBe(true)
    expect(getDefaultWorkspaceId()).toBeNull()
  })

  it('yetkisiz ama yerelde alan varsa onları kullanır', async () => {
    authoritative = false
    pulled = [ws('w-def', true), ws('w-2', false)]

    await useWorkspaceStore.getState().load()

    expect(upserts).toHaveLength(0)
    expect(useWorkspaceStore.getState().activeId).toBe('w-def')
    expect(getDefaultWorkspaceId()).toBe('w-def')
  })
})
