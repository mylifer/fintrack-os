import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import {
  canWrite, readOnlyWorkspaceIdsOf, blockedWorkspace, ReadOnlyWorkspaceError, isReadOnlyWorkspaceError,
} from './workspace-permissions'
import { buildReport } from './error-reporter'

describe('canWrite (0028)', () => {
  it('sahip ve editör yazar, salt okuma yazamaz', () => {
    expect(canWrite('owner')).toBe(true)
    expect(canWrite('editor')).toBe(true)
    expect(canWrite('viewer')).toBe(false)
  })

  it('üyelik yoksa (kendi/paylaşılmamış alan) yazma serbest', () => {
    expect(canWrite(null)).toBe(true)
    expect(canWrite(undefined)).toBe(true)
  })

  it('bilinmeyen rol temkinle salt okuma sayılır', () => {
    expect(canWrite('admin' as never)).toBe(false)
  })
})

describe('readOnlyWorkspaceIdsOf', () => {
  it('yalnız viewer üyelikleri, tekil ve sıralı', () => {
    expect(readOnlyWorkspaceIdsOf([
      { workspace_id: 'b', role: 'viewer' },
      { workspace_id: 'a', role: 'viewer' },
      { workspace_id: 'c', role: 'editor' },
      { workspace_id: 'd', role: 'owner' },
      { workspace_id: 'a', role: 'viewer' },
    ])).toEqual(['a', 'b'])
  })
})

describe('blockedWorkspace', () => {
  it('dokunulan alanlardan ilk salt okuma olanı döner', () => {
    expect(blockedWorkspace(['mine', 'ro'], ['ro'])).toBe('ro')
  })

  it('workspaceId\'siz (eski, varsayılan alan) satır kilitlenmez', () => {
    expect(blockedWorkspace([null, undefined], ['ro'])).toBeNull()
  })

  it('salt okuma kümesi boşsa her yazma serbest', () => {
    expect(blockedWorkspace(['x'], [])).toBeNull()
  })
})

describe('ReadOnlyWorkspaceError', () => {
  it('anlaşılır Türkçe mesaj taşır ve tanınır', () => {
    const e = new ReadOnlyWorkspaceError('ws1')
    expect(e.message).toMatch(/salt okuma/)
    expect(e.workspaceId).toBe('ws1')
    expect(isReadOnlyWorkspaceError(e)).toBe(true)
    expect(isReadOnlyWorkspaceError(new Error('x'))).toBe(false)
  })

  it('hata kaydına (error_logs) düşmez — beklenen ret', () => {
    const env = { path: '/x', userAgent: 'ua', release: 'r' }
    expect(buildReport('unhandledrejection', new ReadOnlyWorkspaceError('ws1'), env)).toBeNull()
  })
})
