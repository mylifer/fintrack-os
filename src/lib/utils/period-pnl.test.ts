import { describe, expect, it } from 'vitest'
import { cashFlowsOf, periodPnl } from './period-pnl'
import type { InvestmentTransaction } from '@/types'

const tx = (p: Partial<InvestmentTransaction>): InvestmentTransaction => ({
  id: 'x', type: 'buy', asset: 'USD', quantity: 1, pricePerUnit: 1,
  date: '2026-01-01', createdAt: '2026-01-01T00:00:00Z', ...p,
})

describe('periodPnl', () => {
  it('satış K/Z\'yi değiştirmez, yalnızca değeri küçültür', () => {
    // ₺10.000 → ₺1.000 kazanç, ₺500 satış → bitiş ₺10.500
    const r = periodPnl({
      startDate: '2026-01-01', startValue: 10_000,
      endDate: '2026-01-31', endValue: 10_500,
      flows: [{ date: '2026-01-20', amount: -500 }],
    })
    expect(r.pnl).toBeCloseTo(1_000)
    expect(r.netFlow).toBe(-500)
    expect(r.pct).toBeGreaterThan(10)   // satışla küçülen taban → %10'un biraz üstü
  })

  it('alım K/Z sayılmaz', () => {
    const r = periodPnl({
      startDate: '2026-01-01', startValue: 1_000,
      endDate: '2026-01-31', endValue: 6_000,
      flows: [{ date: '2026-01-31', amount: 5_000 }],
    })
    expect(r.pnl).toBeCloseTo(0)
    expect(r.pct).toBeCloseTo(0)
  })

  it('başlangıç günündeki ve dönem dışındaki akışlar sayılmaz', () => {
    const r = periodPnl({
      startDate: '2026-01-01', startValue: 2_000,
      endDate: '2026-01-31', endValue: 2_200,
      flows: [
        { date: '2025-12-01', amount: 1_000 },
        { date: '2026-01-01', amount: 1_000 },
        { date: '2026-02-05', amount: 1_000 },
      ],
    })
    expect(r.pnl).toBeCloseTo(200)
    expect(r.pct).toBeCloseTo(10)
  })

  it('dönem içinde açılan pozisyon: taban ağırlıklı alım', () => {
    // Dönemin ortasında ₺1.000 alındı, sonda ₺1.100
    const r = periodPnl({
      startDate: '2026-01-01', startValue: 0,
      endDate: '2026-01-31', endValue: 1_100,
      flows: [{ date: '2026-01-16', amount: 1_000 }],
    })
    expect(r.pnl).toBeCloseTo(100)
    expect(r.pct).toBeCloseTo(20)   // yarım dönemlik sermaye
  })

  it('sermaye tabanı yoksa yüzde null', () => {
    const r = periodPnl({
      startDate: '2026-01-01', startValue: 0,
      endDate: '2026-01-01', endValue: 0, flows: [],
    })
    expect(r.pnl).toBe(0)
    expect(r.pct).toBeNull()
  })
})

describe('cashFlowsOf', () => {
  it('alım +, satış −', () => {
    expect(cashFlowsOf([
      tx({ type: 'buy', quantity: 2, pricePerUnit: 30 }),
      tx({ type: 'sell', quantity: 1, pricePerUnit: 40, date: '2026-02-01' }),
    ])).toEqual([
      { date: '2026-01-01', amount: 60 },
      { date: '2026-02-01', amount: -40 },
    ])
  })
})
