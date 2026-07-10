import { describe, it, expect, beforeAll } from 'vitest'
import type { PriceData } from '@/types'
import { setBaseRates, rateFor, toBaseTry, fromBaseTry, baseAmount } from './fx'

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 2800, updatedAt: 0 } as PriceData)
})

describe('fx — base-currency normalization (S2/S3)', () => {
  it('TRY is identity', () => {
    expect(rateFor('TRY')).toBe(1)
    expect(toBaseTry(100, 'TRY')).toBe(100)
  })

  it('converts foreign to TRY', () => {
    expect(toBaseTry(100, 'USD')).toBe(3450)
    expect(toBaseTry(10, 'EUR')).toBe(370)
  })

  it('fromBaseTry inverts a TRY value into a currency', () => {
    expect(fromBaseTry(3450, 'USD')).toBe(100)
    expect(fromBaseTry(500, 'TRY')).toBe(500)
  })

  it('baseAmount prefers the persisted amountTry snapshot over the live rate', () => {
    // snapshot wins (rate at write time), even if the live rate has since moved
    expect(baseAmount({ amount: 100, currency: 'USD', amountTry: 3400 })).toBe(3400)
    // legacy row without a snapshot → live conversion
    expect(baseAmount({ amount: 100, currency: 'USD' })).toBe(3450)
    // negative (refund) preserves sign
    expect(baseAmount({ amount: -100, currency: 'TRY', amountTry: -100 })).toBe(-100)
  })
})
