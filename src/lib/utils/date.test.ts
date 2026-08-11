import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Account } from '@/types'
import { isInRange, getStatementPeriod, daysUntil, isDueSoon, isOverdue } from './date'

describe('isInRange', () => {
  it('matches a date inside the range', () => {
    expect(isInRange('2026-01-15', '2026-01-01', '2026-01-31')).toBe(true)
  })
  it('tolerates a reversed range without throwing', () => {
    expect(isInRange('2026-01-15', '2026-01-31', '2026-01-01')).toBe(true)
  })
  it('rejects a date outside the range', () => {
    expect(isInRange('2026-02-01', '2026-01-01', '2026-01-31')).toBe(false)
  })
})

describe('getStatementPeriod', () => {
  const cc = (statementDay: number) => ({ id: 'c', type: 'credit_card', statementDay }) as Account

  it('clamps statementDay 31 to a short month (Feb 2026 → 28)', () => {
    expect(getStatementPeriod(cc(31), { month: 2, year: 2026 }).to).toBe('2026-02-28')
  })
  it('uses the exact day for a normal month', () => {
    expect(getStatementPeriod(cc(15), { month: 6, year: 2026 }).to).toBe('2026-06-15')
  })
})

/* daysUntil/isDueSoon TAKVİM GÜNÜ sayar — duvar saatinden bağımsız. Eskiden
   differenceInDays hedefin gece yarısını şimdiki SAATLE kıyaslayıp kesirli günü
   kırpıyordu: "yarın" 0 (abonelikte "bugün" yazıyordu), 7 gün sonrası 6g. */
describe('daysUntil — calendar days, independent of wall clock', () => {
  afterEach(() => vi.useRealTimers())
  const at = (h: number) => vi.setSystemTime(new Date(2026, 7, 10, h, 0, 0)) // 2026-08-10

  for (const hour of [0, 8, 22]) {
    it(`counts calendar days at ${hour}:00`, () => {
      vi.useFakeTimers(); at(hour)
      expect(daysUntil('2026-08-10')).toBe(0)   // bugün
      expect(daysUntil('2026-08-11')).toBe(1)   // yarın
      expect(daysUntil('2026-08-12')).toBe(2)
      expect(daysUntil('2026-08-17')).toBe(7)
      expect(daysUntil('2026-08-09')).toBe(-1)  // dün
    })
  }

  it('crosses a month boundary', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 30, 23, 30, 0)) // 30 Ağu 23:30
    expect(daysUntil('2026-09-01')).toBe(2)
  })
})

describe('isDueSoon / isOverdue — no gap on the due date', () => {
  afterEach(() => vi.useRealTimers())

  it('a debt due TODAY is due-soon and not overdue', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 10, 22, 47, 0))
    // Bugün vadesi gelen borç eskiden iki kovanın ARASINA düşüyordu
    // (dueSoon=false, overdue=false) → hiçbir uyarıda görünmüyordu.
    expect(isDueSoon('2026-08-10')).toBe(true)
    expect(isOverdue('2026-08-10')).toBe(false)
  })

  it('covers [today, today+days] and nothing outside it', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 10, 9, 0, 0))
    expect(isDueSoon('2026-08-09')).toBe(false) // geçmiş → overdue'nun işi
    expect(isDueSoon('2026-08-11')).toBe(true)
    expect(isDueSoon('2026-08-17')).toBe(true)  // tam sınır (+7)
    expect(isDueSoon('2026-08-18')).toBe(false) // sınır dışı
    expect(isDueSoon('2026-08-13', 3)).toBe(true)
    expect(isDueSoon('2026-08-14', 3)).toBe(false)
  })
})
