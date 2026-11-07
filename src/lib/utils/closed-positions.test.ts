import { describe, it, expect } from 'vitest'
import { closedPositions } from './closed-positions'
import type { InvestmentTransaction } from '@/types'

let n = 0
function tx(p: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'type' | 'quantity' | 'pricePerUnit' | 'date'>): InvestmentTransaction {
  n++
  return { id: `t${n}`, asset: 'TEFAS:TP2', createdAt: `${p.date}T10:00:${String(n).padStart(2, '0')}Z`, ...p }
}

describe('closedPositions', () => {
  it('tamamı satılmış varlığı gerçekleşen K/Z ile listeler', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 100, pricePerUnit: 10, date: '2025-01-01' }),
      tx({ type: 'buy',  quantity: 100, pricePerUnit: 20, date: '2025-03-01' }),
      tx({ type: 'sell', quantity: 200, pricePerUnit: 18, date: '2025-07-01' }),
    ]
    const [c] = closedPositions(txs)
    expect(c.asset).toBe('TEFAS:TP2')
    expect(c.firstBuy).toBe('2025-01-01')
    expect(c.lastSell).toBe('2025-07-01')
    expect(c.daysHeld).toBe(181)
    expect(c.bought).toBe(3000)
    expect(c.sold).toBe(3600)
    expect(c.soldCost).toBeCloseTo(3000, 6)
    expect(c.realized).toBeCloseTo(600, 6)
    expect(c.realizedPct).toBeCloseTo(20, 6)
    expect(c.lastSellPrice).toBe(18)
    expect(c.xirr).not.toBeNull()
    expect(c.xirr!).toBeGreaterThan(0)
  })

  it('elde hâlâ miktar olan varlığı dışarıda bırakır', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 10, date: '2025-01-01' }),
      tx({ type: 'sell', quantity: 4,  pricePerUnit: 12, date: '2025-02-01' }),
    ]
    expect(closedPositions(txs)).toEqual([])
  })

  it('kapanıp yeniden açılan varlık kapanmış sayılmaz', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 10, date: '2025-01-01' }),
      tx({ type: 'sell', quantity: 10, pricePerUnit: 12, date: '2025-02-01' }),
      tx({ type: 'buy',  quantity: 5,  pricePerUnit: 11, date: '2025-03-01' }),
    ]
    expect(closedPositions(txs)).toEqual([])
  })

  it('birden çok kapanmış varlığı en son kapanan önce sıralar', () => {
    const txs = [
      tx({ asset: 'USD', type: 'buy',  quantity: 100, pricePerUnit: 30, date: '2024-01-01' }),
      tx({ asset: 'USD', type: 'sell', quantity: 100, pricePerUnit: 35, date: '2024-06-01' }),
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 10, date: '2025-01-01' }),
      tx({ type: 'sell', quantity: 10, pricePerUnit: 9,  date: '2025-09-01' }),
    ]
    const out = closedPositions(txs)
    expect(out.map(c => c.asset)).toEqual(['TEFAS:TP2', 'USD'])
    expect(out[0].realized).toBeCloseTo(-10, 6)
    expect(out[1].realized).toBeCloseTo(500, 6)
  })

  it('kısa süreli pozisyonda XIRR null', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 10, date: '2025-01-01' }),
      tx({ type: 'sell', quantity: 10, pricePerUnit: 11, date: '2025-01-10' }),
    ]
    expect(closedPositions(txs)[0].xirr).toBeNull()
  })
})
