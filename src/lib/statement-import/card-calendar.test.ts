import { describe, it, expect } from 'vitest'
import { cardCalendarUpdate } from './card-calendar'
import type { ParsedStatement } from './statement'
import type { PaymentOccurrence, PaymentPlan } from '@/types'
import type { BatchOp } from '@/lib/sync/engine'

const upserted = (ops: BatchOp[], month: string) => ops
  .flatMap(o => (o.kind === 'upsert' && o.table === 'payment_occurrences' ? [o.entity as PaymentOccurrence] : []))
  .find(e => e.month === month)

const ACC = 'card-1'
const st = (over: Partial<ParsedStatement> = {}): ParsedStatement => ({
  bank: 'garanti', bankLabel: 'Garanti BBVA', type: 'credit_card', currency: 'TRY', cards: [],
  statementDate: '2026-10-30', dueDate: '2026-11-09', prevStatementDate: '2026-09-28', nextStatementDate: '2026-11-29', nextDueDate: '2026-12-09',
  summary: null, lines: [], check: { ok: true, computed: 0, expected: 0, diff: 0, issues: [] }, ...over,
})
const occ = (month: string, statementDate: string | null, dueDate: string | null, extra: Partial<PaymentOccurrence> = {}): PaymentOccurrence => ({
  id: `o-${month}`, targetKind: 'card', targetId: ACC, month, statementDate, dueDate, createdAt: '', updatedAt: '', ...extra,
})
const plan: PaymentPlan = { id: 'p', targetKind: 'card', targetId: ACC, isActive: true, dayOfMonth: 8, createdAt: '', updatedAt: '' }
const run = (o: PaymentOccurrence[], account = { id: ACC, name: 'Garanti Platinum', statementDay: 11 as number | undefined, dueGapDays: null as number | null, holidayRule: null }) =>
  cardCalendarUpdate({ statement: st(), account, plan, occurrences: o, nowIso: '2026-11-01T10:00:00Z' })

describe('cardCalendarUpdate', () => {
  it('kesim günü ve farkı ekstreden alır; takvim varsayılanla tutan tarihler için özel kayıt açmaz', () => {
    const r = run([])
    expect(r.changes.map(c => c.label)).toEqual(expect.arrayContaining(['Kesim günü', 'Kesimden son ödemeye']))
    expect(r.ops).toContainEqual({ kind: 'patch', table: 'accounts', id: ACC, patch: { statementDay: 30, dueGapDays: 10 } })
    expect(r.ops).toContainEqual(expect.objectContaining({ kind: 'patch', table: 'payment_plans', patch: expect.objectContaining({ dayOfMonth: 10 }) }))
    // Kasım: kesim 30 Eki + 10 = 9 Kas → varsayılanla aynı, özel kayıt yok
    const nov = upserted(r.ops, '2026-11')
    expect(nov).toBeUndefined()
    // Aralık: banka 29 Kas diyor, varsayılan 30 Kas → özel kesim yazılır
    const dec = upserted(r.ops, '2026-12')
    expect(dec?.statementDate).toBe('2026-11-29')
    // Ekim: önceki kesim 28 Eyl, son ödeme ekstrede yok → 28 Eyl + 10 = 8 Eki
    const oct = upserted(r.ops, '2026-10')
    expect([oct?.statementDate, oct?.dueDate]).toEqual(['2026-09-28', '2026-10-08'])
  })

  it('yanlış aya girilmiş kopyanın tarihlerini temizler, ödeme durumuna dokunmaz', () => {
    const r = run([occ('2026-09', '2026-09-28', '2026-10-08', { status: 'paid' })])
    expect(r.ops).toContainEqual({ kind: 'patch', table: 'payment_occurrences', id: 'o-2026-09', patch: { statementDate: null, dueDate: null, updatedAt: '2026-11-01T10:00:00Z' } })
    expect(r.undo).toContainEqual({ kind: 'patch', table: 'payment_occurrences', id: 'o-2026-09', patch: { statementDate: '2026-09-28', dueDate: '2026-10-08' } })
  })

  it('takvim zaten ekstreyle aynıysa hiçbir şey yazmaz', () => {
    const first = run([])
    const account = { id: ACC, name: 'Garanti Platinum', statementDay: 30, dueGapDays: 10, holidayRule: null }
    const occs = first.ops.flatMap(o => (o.kind === 'upsert' && o.table === 'payment_occurrences' ? [o.entity as PaymentOccurrence] : []))
    const again = cardCalendarUpdate({ statement: st(), account, plan: { ...plan, dayOfMonth: 10 }, occurrences: occs, nowIso: 'x' })
    expect(again.ops).toEqual([])
    expect(again.changes).toEqual([])
  })
})
