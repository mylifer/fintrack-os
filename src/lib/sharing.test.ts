import { beforeEach, describe, it, expect, vi } from 'vitest'

const calls: string[] = []
const rpcArgs: Record<string, unknown>[] = []
let deleteError: { message: string } | null = null
// İki argümanlı RPC (0028) yokken PostgREST PGRST202 döner
let twoArgMissing = false
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
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push(`rpc:${fn}`)
        rpcArgs.push(args)
        if (twoArgMissing && 'p_role' in args) {
          return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
        }
        return Promise.resolve({ data: fn === 'set_workspace_member_role' ? null : 'tok', error: null })
      },
    },
  }
})

import { createInviteLink, friendly, memberWorkspaceIdsOf, revokePendingInvites, safeInviteNext, setMemberRole, type Membership } from './sharing'

describe('davet iptali', () => {
  beforeEach(() => { calls.length = 0; rpcArgs.length = 0; deleteError = null; twoArgMissing = false })

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

describe('davet rolü ve rol değişimi (0028)', () => {
  beforeEach(() => { calls.length = 0; rpcArgs.length = 0; deleteError = null; twoArgMissing = false })

  it('davet seçilen rolü sunucuya iletir (varsayılan editör)', async () => {
    await createInviteLink('ws1', 'https://x', 'viewer')
    await createInviteLink('ws1', 'https://x')
    expect(rpcArgs).toEqual([
      { p_workspace: 'ws1', p_role: 'viewer' },
      { p_workspace: 'ws1', p_role: 'editor' },
    ])
  })

  it('0028 yoksa editör daveti eski tek argümanlı fonksiyona düşer', async () => {
    twoArgMissing = true
    expect(await createInviteLink('ws1', 'https://x', 'editor')).toBe('https://x/davet/tok')
    expect(rpcArgs.at(-1)).toEqual({ p_workspace: 'ws1' })
  })

  it('0028 yoksa salt okuma daveti ÜRETİLMEZ (sessizce editöre dönmesin)', async () => {
    twoArgMissing = true
    await expect(createInviteLink('ws1', 'https://x', 'viewer')).rejects.toThrow(/0028/)
    expect(rpcArgs).toHaveLength(1)
  })

  it('rol değişimi RPC ile yapılır', async () => {
    await setMemberRole('ws1', 'u2', 'viewer')
    expect(calls.at(-1)).toBe('rpc:set_workspace_member_role')
    expect(rpcArgs.at(-1)).toEqual({ p_workspace: 'ws1', p_user: 'u2', p_role: 'viewer' })
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
    expect(memberWorkspaceIdsOf([m('benim', 'owner'), m('aile', 'editor'), m('kardes', 'viewer')])).toEqual(['aile', 'kardes'])
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
