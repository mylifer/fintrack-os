import { describe, it, expect } from 'vitest'
import type { InvestmentTransaction } from '@/types'
import { avgCostAt, investmentXirr, realizedSales, xirr } from './investment-returns'

let n = 0
const tx = (o: Partial<InvestmentTransaction>): InvestmentTransaction => ({
  id: `t${n++}`, type: 'buy', asset: 'GOLD_GRAM', quantity: 1, pricePerUnit: 100,
  date: '2026-01-01', createdAt: `2026-01-01T00:00:0${n % 10}Z`, ...o,
})

describe('realizedSales', () => {
  it('ortalama maliyetle satış kârı; satış ortalamayı değiştirmez', () => {
    const txs = [
      tx({ quantity: 10, pricePerUnit: 100, date: '2026-01-01' }),
      tx({ quantity: 10, pricePerUnit: 200, date: '2026-02-01' }),
      tx({ type: 'sell', quantity: 5, pricePerUnit: 300, date: '2026-03-01' }),
      tx({ type: 'sell', quantity: 5, pricePerUnit: 100, date: '2026-04-01' }),
    ]
    const s = realizedSales(txs)
    expect(s.map(x => x.gain)).toEqual([750, -250])   // ort. 150
    expect(s[0]).toMatchObject({ proceeds: 1500, cost: 750 })
  })

  it('geriye tarihli satış sonraki alımın maliyetini görmez (#7)', () => {
    const txs = [
      tx({ quantity: 10, pricePerUnit: 100, date: '2026-01-01', createdAt: 'a' }),
      tx({ quantity: 10, pricePerUnit: 300, date: '2026-03-01', createdAt: 'b' }),
      // Sonradan girilen ama Şubat tarihli satış
      tx({ type: 'sell', quantity: 5, pricePerUnit: 150, date: '2026-02-01', createdAt: 'c' }),
    ]
    expect(realizedSales(txs)[0]).toMatchObject({ cost: 500, gain: 250 })
    expect(avgCostAt(txs, 'GOLD_GRAM', { date: '2026-02-01', createdAt: 'c' })).toBe(100)
    // Bugünkü ortalama ((5×100 + 10×300) / 15) ile hesaplansaydı zarar çıkardı
    expect(avgCostAt(txs, 'GOLD_GRAM', { date: '2026-12-31', createdAt: 'z' })).toBeCloseTo(3500 / 15)
  })

  it('düzenlenen işlem kendi maliyetine dahil edilmez; eldekinden fazla satış maliyetsiz kalır', () => {
    const buy  = tx({ quantity: 2, pricePerUnit: 100, date: '2026-01-01', createdAt: 'a' })
    const sell = tx({ type: 'sell', quantity: 2, pricePerUnit: 120, date: '2026-01-02', createdAt: 'b' })
    expect(avgCostAt([buy, sell], 'GOLD_GRAM', { date: '2026-01-02', createdAt: 'b' }, sell.id)).toBe(100)
    const over = realizedSales([buy, tx({ type: 'sell', quantity: 3, pricePerUnit: 100, date: '2026-01-03', createdAt: 'c' })])
    expect(over[0]).toMatchObject({ cost: 200, proceeds: 300 })
  })
})

describe('xirr', () => {
  it('bir yılda %10', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])).toBeCloseTo(0.1, 4)
  })

  it('ara akışlı bilinen örnek (Excel XIRR ≈ %37,34)', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ])
    expect(r).toBeCloseTo(0.3734, 3)
  })

  it('zarar ve tek yönlü akış', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 500 }])).toBeCloseTo(-0.5, 4)
    expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull()
  })

  it('investmentXirr: bugünkü değer eklenir; 30 günden kısa süre null', () => {
    const txs = [tx({ quantity: 10, pricePerUnit: 100, date: '2025-01-01' })]
    expect(investmentXirr(txs, 1100, '2026-01-01')).toBeCloseTo(0.1, 4)
    expect(investmentXirr([tx({ date: '2026-09-10' })], 110, '2026-09-26')).toBeNull()
    expect(investmentXirr([], 0, '2026-09-26')).toBeNull()
  })
})
