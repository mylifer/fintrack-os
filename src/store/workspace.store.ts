'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, reconcilingPull } from '@/lib/sync/engine'
import {
  getPersistedActiveWorkspaceId, setActiveWorkspaceId, setDefaultWorkspaceId,
} from '@/lib/workspace-context'
import { reloadAllStores } from '@/lib/reload-stores'
import type { Workspace } from '@/types'

interface WorkspaceState {
  workspaces: Workspace[]
  activeId: string | null
  ready: boolean
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

  load: async () => {
    let rows: Workspace[]
    try {
      rows = await reconcilingPull<Workspace>('workspaces')
    } catch (err) {
      console.error('[workspace:load]', err)
      rows = (await db.workspaces.toArray()).filter(isLive)
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
