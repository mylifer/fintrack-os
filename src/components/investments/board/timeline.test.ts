import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import type { InvestmentTransaction } from '@/types'
import { buildPortfolioSeries, histKey } from './timeline'

/* buildPortfolioSeries — dönem değişince doğru seri okunmalı.
 * useHistories önceki dönemlerin serilerini de tutar; önek eşleşmesi ilk
 * ekleneni (3A, daha kısa) döndürüyordu, 1Y'ye geçince grafik 90 günde kalıyordu. */

const tx: InvestmentTransaction = {
  id: 't1', type: 'buy', asset: 'USD', quantity: 10, pricePerUnit: 30,
  date: '2025-01-01', createdAt: '2025-01-01T00:00:00Z',
}

describe('buildPortfolioSeries', () => {
  it('seriyi tam (grup, kod, başlangıç) anahtarıyla seçer', () => {
    const shortFrom = '2026-08-10'
    const longFrom  = '2025-11-08'
    const series = {
      // önce eklenen: kısa dönem
      [histKey({ group: 'USD', from: shortFrom })]: [{ date: '2026-08-10', price: 40 }],
      [histKey({ group: 'USD', from: longFrom })]: [
        { date: '2025-11-08', price: 35 },
        { date: '2026-08-10', price: 40 },
      ],
    }
    const rows = buildPortfolioSeries({
      assets: ['USD'], transactions: [tx], series, from: longFrom,
      todayStr: '2026-11-08', todayValue: 420, todayCost: 300,
    })
    expect(rows[0]).toEqual({ date: '2025-11-08', value: 350, cost: 300 })
    expect(rows.map(r => r.date)).toEqual(['2025-11-08', '2026-08-10', '2026-11-08'])
  })

  it('güncel dönemin serisi yoksa eski dönemin serisine düşmez', () => {
    const series = { [histKey({ group: 'USD', from: '2026-08-10' })]: [{ date: '2026-08-10', price: 40 }] }
    const rows = buildPortfolioSeries({
      assets: ['USD'], transactions: [tx], series, from: '2025-11-08',
      todayStr: '2026-11-08', todayValue: 420, todayCost: 300,
    })
    expect(rows).toEqual([])
  })
})
