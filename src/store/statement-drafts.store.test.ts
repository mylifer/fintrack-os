import { describe, it, expect, vi } from 'vitest'
import { draftIdFor } from './statement-drafts.store'
import type { ParsedStatement } from '@/lib/statement-import/statement'

const st = (over: Partial<ParsedStatement> = {}): ParsedStatement => ({
  bank: 'garanti', bankLabel: 'Garanti BBVA', type: 'credit_card', currency: 'TRY', cards: ['9010'],
  statementDate: '2026-10-30', dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null,
  summary: { previous: 0, spending: 0, fees: 0, payments: 0, debt: 76650.35, minPayment: null },
  lines: [], check: { ok: true, computed: 76650.35, expected: 76650.35, diff: 0, issues: [] }, ...over,
})

describe('draftIdFor', () => {
  it('aynı ekstre (yeniden yükleme) aynı taslağa düşer', () => {
    expect(draftIdFor(st())).toBe(draftIdFor(st({ lines: [] })))
  })
  it('farklı kesim ya da dönem borcu ayrı taslaktır', () => {
    expect(draftIdFor(st())).not.toBe(draftIdFor(st({ statementDate: '2026-09-28' })))
    expect(draftIdFor(st())).not.toBe(draftIdFor(st({ summary: { previous: 0, spending: 0, fees: 0, payments: 0, debt: 1, minPayment: null } })))
  })
})

describe('taslak sürümü', () => {
  it('v1 taslağı (indeksli kararlar) açılır ama kararları yeniden sorulur', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } })
    const d = { id: 'd1', workspaceId: null, fileName: 'a.pdf', statement: st(), accountId: 'acc', choices: { l0: 1 }, edits: { l0: { description: 'x' } }, progress: { review: 1, pending: 0, create: 1 }, createdAt: '', updatedAt: '' }
    mem.set('fintrack:stmt-drafts', JSON.stringify({ v: 1, drafts: [d] }))
    const { useStatementDraftsStore } = await import('./statement-drafts.store')
    const got = useStatementDraftsStore.getState().get('d1')!
    expect(got.choices).toEqual({})
    expect(got.edits).toEqual({ l0: { description: 'x' } })
    vi.unstubAllGlobals()
  })
})
