import { describe, it, expect } from 'vitest'
import { withDiffHint, type ParsedStatement, type StatementLine } from './statement'

const line = (index: number, description: string, amount: number, kind: StatementLine['kind'] = 'purchase'): StatementLine =>
  ({ index, date: '2026-11-05', description, amount, bonus: null, installment: null, foreign: null, kind })

const st = (lines: StatementLine[], diff: number): ParsedStatement => ({
  bank: 'garanti', bankLabel: 'Garanti BBVA', type: 'credit_card', currency: 'TRY', cards: [], statementDate: '2026-11-12',
  dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null, lines,
  check: { ok: diff === 0, computed: 0, expected: 0, diff, issues: diff ? ['tutmuyor'] : [] },
})

describe('toplam farkı ipucu', () => {
  it('fark kart ödemelerinin toplamıysa söyler', () => {
    const r = withDiffHint(st([line(0, 'A', 100), line(1, 'BonusFlaş Ödeme', -76650.35, 'payment')], -76650.35))
    expect(r.check.issues[1]).toContain('kart ödemelerinin toplamına (76.650,35 TL)')
  })
  it('fark tek bir satırın tutarıysa o satırı gösterir', () => {
    const r = withDiffHint(st([line(0, 'MASAL KOKOREC', 2700), line(1, 'B', 50)], 2700))
    expect(r.check.issues[1]).toContain('"MASAL KOKOREC" (05.11)')
  })
  it('okunan toplam azsa eksik satır ihtimalini söyler', () => {
    const r = withDiffHint(st([line(0, 'A', 100)], -11304.77))
    expect(r.check.issues[1]).toContain('okunamamış olabilir')
  })
  it('toplam tutuyorsa dokunmaz', () => {
    const s = st([line(0, 'A', 100)], 0)
    expect(withDiffHint(s)).toBe(s)
  })
})
