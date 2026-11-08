import { beforeEach, describe, it, expect, vi } from 'vitest'

const calls: string[] = []
let deleteError: { message: string } | null = null
vi.mock('@/lib/supabase', () => {
  const chain = {
    delete: () => { calls.push('delete'); return chain },
    eq: (col: string, val: string) => { calls.push(`eq:${col}=${val}`); return chain },
    is: (col: string, val: null) => {
      calls.push(`is:${col}=${val}`)
      return Promise.resolve({ error: deleteError })
    },
  }
  return {
    supabase: {
      from: (t: string) => { calls.push(`from:${t}`); return chain },
      rpc: (fn: string) => { calls.push(`rpc:${fn}`); return Promise.resolve({ data: 'tok', error: null }) },
    },
  }
})

import { createInviteLink, friendly, memberWorkspaceIdsOf, revokePendingInvites, safeInviteNext, type Membership } from './sharing'

describe('davet iptali', () => {
  beforeEach(() => { calls.length = 0; deleteError = null })

  it('revokePendingInvites alanın kullanılmamış davetlerini siler', async () => {
    await revokePendingInvites('ws1')
    expect(calls).toEqual(['from:workspace_invites', 'delete', 'eq:workspace_id=ws1', 'is:accepted_at=null'])
  })

  it('silme hatası yutulmaz', async () => {
    deleteError = { message: 'failed to fetch' }
    await expect(revokePendingInvites('ws1')).rejects.toThrow(/Bağlantı yok/)
  })

  it('yeni bağlantı önce eski bekleyen davetleri iptal eder', async () => {
    expect(await createInviteLink('ws1', 'https://x')).toBe('https://x/davet/tok')
    expect(calls.indexOf('delete')).toBeLessThan(calls.indexOf('rpc:create_workspace_invite'))
  })

  it('iptal başarısızsa yeni davet oluşturulmaz', async () => {
    deleteError = { message: 'boom' }
    await expect(createInviteLink('ws1', 'https://x')).rejects.toThrow()
    expect(calls).not.toContain('rpc:create_workspace_invite')
  })
})

const TOKEN = 'a'.repeat(64)

describe('safeInviteNext — girişten sonra dönülecek adres', () => {
  it('yalnız /davet/<64 hex> kabul edilir (açık yönlendirme yok)', () => {
    expect(safeInviteNext(`/davet/${TOKEN}`)).toBe(`/davet/${TOKEN}`)
    expect(safeInviteNext(null)).toBeNull()
    expect(safeInviteNext('/dashboard')).toBeNull()
    expect(safeInviteNext('https://kotu.site/davet/' + TOKEN)).toBeNull()
    expect(safeInviteNext('//kotu.site')).toBeNull()
    expect(safeInviteNext(`/davet/${TOKEN}/../../settings`)).toBeNull()
    expect(safeInviteNext('/davet/abc')).toBeNull()
  })
})

describe('memberWorkspaceIdsOf', () => {
  it('sahibi olduğum paylaşılan alanlar hariç, üyesi olduklarım', () => {
    const m = (workspace_id: string, role: Membership['role']): Membership =>
      ({ workspace_id, role, user_id: 'u', email: null, created_at: '' })
    expect(memberWorkspaceIdsOf([m('benim', 'owner'), m('aile', 'editor')])).toEqual(['aile'])
  })
})

describe('friendly', () => {
  it('sunucu hataları anlaşılır Türkçe iletiye çevrilir', () => {
    expect(friendly({ code: 'PGRST202', message: 'Could not find the function' }).message).toMatch(/0021/)
    expect(friendly({ code: '42P01', message: 'relation does not exist' }).message).toMatch(/0021/)
    expect(friendly({ message: 'davet geçersiz ya da süresi dolmuş' }).message).toMatch(/Yeni bağlantı/)
    expect(friendly({ message: 'varsayılan alan paylaşılamaz' }).message).toMatch(/Genel/)
    expect(friendly({ code: '42501', message: 'yetki yok' }).message).toMatch(/yetkiniz yok/)
    expect(friendly(null).message).toMatch(/tekrar deneyin/)
  })
})
