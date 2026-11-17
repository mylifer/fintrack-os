import { describe, it, expect } from 'vitest'
import { getPeriodRangeAt, periodOffsetFor } from './date'

describe('periodOffsetFor', () => {
  const now = new Date(2026, 10, 17) // 17 Kasım 2026
  it('satırın dönemini bugüne göre bulur', () => {
    expect(periodOffsetFor('monthly', '2026-09-28', now)).toBe(-2)
    expect(periodOffsetFor('yearly', '2025-12-31', now)).toBe(-1)
    expect(periodOffsetFor('daily', '2026-11-15', now)).toBe(-2)
    expect(periodOffsetFor('all', '2020-01-01', now)).toBe(0)
  })
  it('bugünkü dönem için bulunan ofset tarihi kapsar', () => {
    for (const type of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
      const date = '2026-09-28'
      const { from, to } = getPeriodRangeAt(type, periodOffsetFor(type, date))
      expect(date >= from && date <= to).toBe(true)
    }
  })
})
