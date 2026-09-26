import { describe, it, expect } from 'vitest'
import { comparisonRange, pctChange } from './period-compare'

describe('comparisonRange', () => {
  it('önceki dönem: tam aylar → önceki tam aylar', () => {
    expect(comparisonRange({ from: '2026-09-01', to: '2026-09-30' }, 'previous')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(comparisonRange({ from: '2026-03-01', to: '2026-03-31' }, 'previous')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(comparisonRange({ from: '2026-07-01', to: '2026-09-30' }, 'previous')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(comparisonRange({ from: '2026-01-01', to: '2026-12-31' }, 'previous')).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('önceki dönem: diğer aralıklarda aynı uzunlukta önceki günler', () => {
    expect(comparisonRange({ from: '2026-09-05', to: '2026-09-30' }, 'previous')).toEqual({ from: '2026-08-10', to: '2026-09-04' })
    expect(comparisonRange({ from: '2026-09-21', to: '2026-09-27' }, 'previous')).toEqual({ from: '2026-09-14', to: '2026-09-20' })
  })

  it('geçen yıl: aynı tarihlerin bir yıl öncesi; 29 Şubat → 28 Şubat', () => {
    expect(comparisonRange({ from: '2026-09-01', to: '2026-09-30' }, 'year')).toEqual({ from: '2025-09-01', to: '2025-09-30' })
    expect(comparisonRange({ from: '2028-02-01', to: '2028-02-29' }, 'year')).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })
})

describe('pctChange', () => {
  it('yüzde değişim; önceki sıfırsa yeni (null) ya da 0', () => {
    expect(pctChange(150, 100)).toBe(50)
    expect(pctChange(50, 100)).toBe(-50)
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(0, 0)).toBe(0)
  })
})
