import { describe, it, expect, beforeAll } from 'vitest'
import type { PriceData, RecurringTransaction, RecurringFrequency } from '@/types'
import { setBaseRates } from './fx'
import {
  MONTHLY_FACTOR, monthlyEquivalentTry, monthlyTotalTry, annualTotalTry, summarize,
} from './subscriptions'

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 2800, updatedAt: 0 } as PriceData)
})

/** Minimal recurring builder — only fields the aggregators read matter. */
function rec(over: Partial<RecurringTransaction> = {}): RecurringTransaction {
  return {
    id: 'r', name: 'Test', type: 'expense', amount: 100, currency: 'TRY',
    accountId: 'a', description: '', frequency: 'monthly',
    startDate: '2026-01-01', nextDueDate: '2026-08-01', isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('subscriptions — monthly-equivalent projection', () => {
  it('monthly is identity', () => {
    expect(monthlyEquivalentTry(rec({ amount: 200, frequency: 'monthly' }))).toBe(200)
  })

  it('projects each frequency onto a monthly scale', () => {
    // 30 TRY/day ≈ 30 × 30.4375 = 913.13
    expect(monthlyEquivalentTry(rec({ amount: 30, frequency: 'daily' }))).toBeCloseTo(913.13, 2)
    // 100 TRY/week ≈ 100 × 4.34524 = 434.52
    expect(monthlyEquivalentTry(rec({ amount: 100, frequency: 'weekly' }))).toBeCloseTo(434.52, 2)
    // 1200 TRY/year → 100/month
    expect(monthlyEquivalentTry(rec({ amount: 1200, frequency: 'yearly' }))).toBe(100)
  })

  it('normalizes foreign currency to TRY (10 USD/mo @ 34.5)', () => {
    expect(monthlyEquivalentTry(rec({ amount: 10, currency: 'USD', frequency: 'monthly' }))).toBe(345)
  })

  it('sums monthly + annual across mixed frequencies and currencies', () => {
    const subs = [
      rec({ id: '1', amount: 1200, frequency: 'yearly' }),        // 100/mo
      rec({ id: '2', amount: 10, currency: 'USD' }),              // 345/mo
      rec({ id: '3', amount: 55, frequency: 'monthly' }),        // 55/mo
    ]
    expect(monthlyTotalTry(subs)).toBe(500)
    expect(annualTotalTry(subs)).toBe(6000)
  })

  it('summarize filters to active expenses only', () => {
    const s = summarize([
      rec({ id: '1', amount: 100 }),                              // included
      rec({ id: '2', amount: 100, isActive: false }),            // paused → excluded
      rec({ id: '3', amount: 100, type: 'income' }),             // income → excluded
      rec({ id: '4', amount: 100, type: 'transfer' }),           // transfer → excluded
    ])
    expect(s.count).toBe(1)
    expect(s.monthlyTotal).toBe(100)
    expect(s.annualTotal).toBe(1200)
  })

  it('empty list → zeros', () => {
    const s = summarize([])
    expect(s).toEqual({ subs: [], monthlyTotal: 0, annualTotal: 0, count: 0 })
  })

  it('factor table covers every frequency', () => {
    const freqs: RecurringFrequency[] = ['daily', 'weekly', 'monthly', 'yearly']
    for (const f of freqs) expect(MONTHLY_FACTOR[f]).toBeGreaterThan(0)
  })
})
