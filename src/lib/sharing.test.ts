import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { friendly, memberWorkspaceIdsOf, safeInviteNext, type Membership } from './sharing'

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
