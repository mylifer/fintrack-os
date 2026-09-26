'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, reconcilingPull, lastPullWasAuthoritative, purgeWorkspacesLocal } from '@/lib/sync/engine'
import {
  getPersistedActiveWorkspaceId, setActiveWorkspaceId, setDefaultWorkspaceId,
  getMemberWorkspaceIds, setMemberWorkspaceIds,
} from '@/lib/workspace-context'
import { fetchMyMemberships, memberWorkspaceIdsOf, removeMember } from '@/lib/sharing'
import { useSyncStatusStore } from '@/store/sync-status.store'
import { supabase } from '@/lib/supabase'
import { reloadAllStores } from '@/lib/reload-stores'
import type { Workspace } from '@/types'

/** Paylaşım durumu (0021). owned: paylaştığım alanlar; member: üyesi olduklarım. */
export interface SharingState {
  available: boolean
  owned: string[]
  member: string[]
}

interface WorkspaceState {
  workspaces: Workspace[]
  activeId: string | null
  ready: boolean
  sharing: SharingState
  /** Üyelikleri buluttan tazeler; erişimi kalkan alanların yerel verisini siler. */
  syncSharing: () => Promise<void>
  /** Üyesi olduğum alandan ayrılır. */
  leave: (id: string) => Promise<void>
  load: () => Promise<void>
  add: (name: string) => Promise<Workspace>
  rename: (id: string, name: string) => Promise<void>
  setActive: (id: string) => Promise<void>
}

function sortWorkspaces(list: Workspace[]): Workspace[] {
  return [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeId: null,
  ready: false,
  sharing: { available: false, owned: [], member: getMemberWorkspaceIds() },

  syncSharing: async () => {
    const m = await fetchMyMemberships()
    if (!m.complete) {
      // Çevrimdışı / hata: bilinen üyeliklerle devam — hiçbir şey silinmez
      set(s => ({ sharing: { ...s.sharing, available: m.available, member: getMemberWorkspaceIds() } }))
      return
    }
    const next = memberWorkspaceIdsOf(m.mine)
    const revoked = getMemberWorkspaceIds().filter(id => !next.includes(id))
    if (revoked.length) {
      const names = get().workspaces.filter(w => revoked.includes(w.id)).map(w => w.name)
      await purgeWorkspacesLocal(revoked)
      useSyncStatusStore.getState().notify(
        `${names.length ? names.join(', ') : 'Paylaşılan bir alan'} artık sizinle paylaşılmıyor; bu cihazdaki kopyası kaldırıldı.`,
      )
    }
    setMemberWorkspaceIds(next)
    set({
      sharing: {
        available: true,
        owned: m.mine.filter(x => x.role === 'owner').map(x => x.workspace_id),
        member: next,
      },
    })
  },

  leave: async (id) => {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user.id
    if (!uid) throw new Error('Oturum yok.')
    await removeMember(id, uid)
    await get().syncSharing()
    await get().load()
    await reloadAllStores()
  },

  load: async () => {
    // Üyelikler ÖNCE: çekiş filtresi (engine) paylaşılan alanları bunlardan bilir
    await get().syncSharing()

    let rows: Workspace[]
    try {
      rows = await reconcilingPull<Workspace>('workspaces')
    } catch (err) {
      console.error('[workspace:load]', err)
      rows = (await db.workspaces.toArray()).filter(isLive)
    }

    // Boş sonuç yalnız çekiş YETKİLİYSE "hiç alan yok" demektir. Eksik bir
    // çekişte (ağ hatası + çıkış sonrası boş Dexie) varsayılan oluşturmak,
    // buluttaki "Genel"in yanına ikinci bir isDefault alan ekliyordu. Bu durumda
    // alan çözülmeden devam edilir: aktif/varsayılan null kalır, yeni kayıtlar
    // workspaceId'siz (= varsayılan alana ait) yazılır; sonraki açılışta düzelir.
    if (rows.length === 0 && !lastPullWasAuthoritative('workspaces')) {
      set({ workspaces: [], activeId: null, ready: true })
      return
    }

    // İlk çalıştırma: hiç çalışma alanı yoksa bir varsayılan oluştur
    // (categories.store.ts'teki initDefaults() ile aynı desen).
    if (rows.length === 0) {
      const def: Workspace = {
        id: crypto.randomUUID(),
        name: 'Genel',
        isDefault: true,
        createdAt: new Date().toISOString(),
      }
      await localUpsert('workspaces', def)
      rows = [def]
    }

    const defaultWs = rows.find(w => w.isDefault) ?? rows[0]
    setDefaultWorkspaceId(defaultWs.id)

    const persisted = getPersistedActiveWorkspaceId()
    const activeId = rows.some(w => w.id === persisted) ? persisted! : defaultWs.id
    setActiveWorkspaceId(activeId)

    set({ workspaces: sortWorkspaces(rows), activeId, ready: true })
  },

  add: async (name) => {
    const ws: Workspace = {
      id: crypto.randomUUID(),
      name,
      isDefault: false,
      createdAt: new Date().toISOString(),
    }
    await localUpsert('workspaces', ws)
    set(s => ({ workspaces: sortWorkspaces([...s.workspaces, ws]) }))
    return ws
  },

  rename: async (id, name) => {
    await localPatch('workspaces', id, { name })
    set(s => ({
      workspaces: s.workspaces.map(w => w.id === id ? { ...w, name } : w),
    }))
  },

  setActive: async (id) => {
    if (id === get().activeId) return
    setActiveWorkspaceId(id)
    set({ activeId: id })
    await reloadAllStores()
  },
}))
