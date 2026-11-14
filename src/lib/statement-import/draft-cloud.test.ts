import { describe, it, expect } from 'vitest'

import { mergeDrafts, type CloudDraftRow } from './draft-cloud'
import type { StatementDraft } from '@/store/statement-drafts.store'

const draft = (id: string, updatedAt: string, fileName = `${id}.pdf`): StatementDraft => ({
  id, workspaceId: 'ws', fileName, accountId: 'a', choices: {}, edits: {},
  progress: { review: 1, pending: 1, create: 0 }, createdAt: updatedAt, updatedAt,
  statement: { lines: [] } as unknown as StatementDraft['statement'],
})
const row = (d: StatementDraft | null, id: string, updatedAt: string, deleted_at: string | null = null): CloudDraftRow =>
  ({ id, workspaceId: 'ws', data: d, updatedAt, deleted_at })

const T1 = '2026-11-14T10:00:00.000Z', T2 = '2026-11-14T11:00:00.000Z', T3 = '2026-11-14T12:00:00.000Z'

describe('yarım kalan ekstre: cihaz ↔ bulut birleştirme', () => {
  it('yalnız bulutta olan taslak bu cihaza gelir (başka bilgisayarda başlanan)', () => {
    const r = mergeDrafts([], [], [row(draft('d1', T1), 'd1', T1)])
    expect(r.drafts.map(d => d.id)).toEqual(['d1'])
    expect(r.push).toEqual([])
  })

  it('yalnız cihazda olan taslak buluta gönderilir', () => {
    const r = mergeDrafts([draft('d1', T1)], [], [])
    expect(r.push.map(p => p.kind)).toEqual(['draft'])
  })

  it('iki tarafta da varsa yeni olan kazanır; cihazdaki yeniyse buluta da gider', () => {
    const cloudNewer = mergeDrafts([draft('d1', T1, 'eski')], [], [row(draft('d1', T2, 'yeni'), 'd1', T2)])
    expect([cloudNewer.drafts[0].fileName, cloudNewer.push.length]).toEqual(['yeni', 0])
    const localNewer = mergeDrafts([draft('d1', T2, 'yeni')], [], [row(draft('d1', T1, 'eski'), 'd1', T1)])
    expect([localNewer.drafts[0].fileName, localNewer.push.length]).toEqual(['yeni', 1])
  })

  it('başka cihazda onaylanan/silinen taslak bu cihazdan da kalkar; ondan sonra burada düzenlendiyse kalır', () => {
    expect(mergeDrafts([draft('d1', T1)], [], [row(null, 'd1', T2, T2)]).drafts).toEqual([])
    const edited = mergeDrafts([draft('d1', T3)], [], [row(null, 'd1', T2, T2)])
    expect([edited.drafts.length, edited.push[0]?.kind]).toEqual([1, 'draft'])
  })

  it('bu cihazda çevrimdışı silinen taslak geri gelmez, silme buluta gönderilir', () => {
    const r = mergeDrafts([], [{ id: 'd1', at: T2 }], [row(draft('d1', T1), 'd1', T1)])
    expect(r.drafts).toEqual([])
    expect(r.push).toEqual([{ kind: 'delete', id: 'd1', at: T2 }])
  })

  it('silindikten SONRA başka cihazda düzenlenen taslak korunur; silme kaydı kapanır', () => {
    const r = mergeDrafts([], [{ id: 'd1', at: T1 }], [row(draft('d1', T2), 'd1', T2)])
    expect([r.drafts.length, r.push.length, r.settledTombstones]).toEqual([1, 0, ['d1']])
  })

  it('silme buluta zaten ulaşmışsa yerel silme kaydı kapanır', () => {
    const r = mergeDrafts([], [{ id: 'd1', at: T1 }], [row(null, 'd1', T1, T1)])
    expect([r.drafts.length, r.push.length, r.settledTombstones]).toEqual([0, 0, ['d1']])
  })
})
