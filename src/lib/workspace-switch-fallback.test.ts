import { describe, it, expect } from 'vitest'
import { workspaceSwitchFallback } from './workspace-switch-fallback'

type Acc = { id: string; name: string; type: string; workspaceId: string }
const acc = (id: string, name: string, type = 'checking', workspaceId = 'ws-damla'): Acc =>
  ({ id, name, type, workspaceId })

const base = {
  activeWorkspaceId: 'ws-damla',
  listHref: '/accounts',
  hrefFor: (a: Acc) => `/accounts/${a.id}`,
}

describe('workspaceSwitchFallback', () => {
  it('sayfa kaydı hiç görmediyse null (eski "bulunamadı" davranışı)', () => {
    expect(workspaceSwitchFallback({ ...base, lastSeen: null, candidates: [acc('a1', 'Banka')] })).toBeNull()
  })

  it('kayıt aynı alanda kaybolduysa (silindi) listeye döner', () => {
    const gone = acc('x', 'Nakit', 'cash', 'ws-damla')
    expect(workspaceSwitchFallback({ ...base, lastSeen: gone, candidates: [acc('a1', 'Banka')], pickFirst: true }))
      .toBe('/accounts')
  })

  it('yeni alanda aynı adlı kayıt varsa ona gider (büyük/küçük harf ve Türkçe karakter duyarsız)', () => {
    const prev = acc('x', 'Nakit', 'cash', 'ws-genel')
    const r = workspaceSwitchFallback({
      ...base, lastSeen: prev, pickFirst: true,
      candidates: [acc('a1', 'Banka'), acc('a2', 'NAKİT', 'cash')],
    })
    expect(r).toBe('/accounts/a2')
  })

  it('ad eşleşmesi yoksa tercih edilen (aynı türdeki) ilk adaya, o da yoksa ilk adaya gider', () => {
    const prev = acc('x', 'Nakit', 'cash', 'ws-genel')
    expect(workspaceSwitchFallback({
      ...base, lastSeen: prev, pickFirst: true, prefer: (c, p) => c.type === p.type,
      candidates: [acc('a1', 'Banka'), acc('a2', 'Cüzdan', 'cash')],
    })).toBe('/accounts/a2')
    expect(workspaceSwitchFallback({
      ...base, lastSeen: prev, pickFirst: true, prefer: (c, p) => c.type === p.type,
      candidates: [acc('a1', 'Banka')],
    })).toBe('/accounts/a1')
  })

  it('aday yoksa ya da pickFirst kapalıysa listeye gider', () => {
    const prev = acc('x', 'Nakit', 'cash', 'ws-genel')
    expect(workspaceSwitchFallback({ ...base, lastSeen: prev, pickFirst: true, candidates: [] })).toBe('/accounts')
    expect(workspaceSwitchFallback({ ...base, lastSeen: prev, candidates: [acc('a1', 'Banka')] })).toBe('/accounts')
  })
})
