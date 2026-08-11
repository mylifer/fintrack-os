import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { PriceData } from '@/types'
import { setBaseRates, rateFor, toBaseTry, fromBaseTry, baseAmount, baseSnapshot } from './fx'

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

/* amountTry KALICI bir snapshot'tır: bir kez yazıldığında baseAmount() onu
   döndürür, kurlar sonradan gelse bile düzelmez. Bu yüzden kur henüz yokken
   toBaseTry'ın ham-tutar fallback'i ASLA snapshot olarak damgalanmamalı —
   yoksa düzenlenen $100 sonsuza dek 100₺ olarak kaydolur (42 kat hata).
   baseSnapshot bu kararın tek kaynağıdır (withBase + update ortak kullanır). */
describe('baseSnapshot — kur yokken damgalamaz', () => {
  it('returns null before any rate is published', async () => {
    vi.resetModules()
    const fresh = await import('./fx')
    expect(fresh.rateFor('USD')).toBe(null)
    // toBaseTry ham tutara düşer (degraded OKUMA için kasıtlı)...
    expect(fresh.toBaseTry(100, 'USD')).toBe(100)
    // ...ama snapshot olarak YAZILMAZ.
    expect(fresh.baseSnapshot(100, 'USD')).toBe(null)
    // TRY'nin kuru her zaman vardır (1).
    expect(fresh.baseSnapshot(100, 'TRY')).toBe(100)
  })

  it('returns the converted value once rates are published', () => {
    expect(baseSnapshot(100, 'USD')).toBe(3450)
    expect(baseSnapshot(-100, 'USD')).toBe(-3450)   // iade işareti korunur
    expect(baseSnapshot(100, 'TRY')).toBe(100)
  })

  it('a null snapshot lets baseAmount convert live once rates arrive', () => {
    // update() kur yokken amountTry'ı null'a çeker → baseAmount canlı çevirir
    expect(baseAmount({ amount: 100, currency: 'USD', amountTry: null })).toBe(3450)
  })
})
