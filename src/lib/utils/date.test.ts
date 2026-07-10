import { describe, it, expect } from 'vitest'
import type { Account } from '@/types'
import { isInRange, getStatementPeriod } from './date'

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
