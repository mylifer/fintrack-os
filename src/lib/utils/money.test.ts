import { describe, it, expect } from 'vitest'
import { toMinor, toMajor, sumBy, sumMoney, addMoney, subMoney, mulMoney, roundMoney, splitMoney, splitInstallments } from './money'

describe('money — integer minor-unit math (S8)', () => {
  it('summation has no float drift', () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6)
    expect(sumMoney(Array(10_000).fill(0.01))).toBe(100)
  })

  it('sumBy selects and stays exact', () => {
    expect(sumBy([{ a: 1.11 }, { a: 2.22 }], x => x.a)).toBe(3.33)
  })

  it('nets negatives (refunds)', () => {
    expect(sumMoney([500, -120])).toBe(380)
    expect(sumMoney([100, -100])).toBe(0)
  })

  it('add / sub / mul are kuruş-exact', () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3)
    expect(subMoney(5000, 4999.99)).toBe(0.01)
    expect(mulMoney(100, 34.5)).toBe(3450)   // FX conversion
    expect(mulMoney(12.34, 2)).toBe(24.68)
  })

  it('toMinor / toMajor / roundMoney', () => {
    expect(toMinor(12.34)).toBe(1234)
    expect(toMajor(1234)).toBe(12.34)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(19.990000000000002)).toBe(19.99)
  })

  it('splitMoney divides evenly and preserves the exact total', () => {
    expect(splitMoney(1000, 2)).toEqual([500, 500])
    expect(splitMoney(1000, 3)).toEqual([333.34, 333.33, 333.33])
    expect(splitMoney(0.05, 3)).toEqual([0.02, 0.02, 0.01])
    expect(sumMoney(splitMoney(4999.99, 12))).toBe(4999.99)
    expect(splitMoney(100, 1)).toEqual([100])
  })
})

describe('splitInstallments (banka kuralı)', () => {
  // Garanti BBVA ekstresindeki gerçek taksitler: diğerleri aşağı yuvarlanır,
  // artan kuruşun tamamı 1. taksite gider.
  it.each([
    [15413.00, 9, 1712.60, 1712.55],
    [8769.99, 6, 1461.69, 1461.66],
    [11357.85, 6, 1893.00, 1892.97],
    [5425.54, 4, 1356.40, 1356.38],
    [4423.39, 4, 1105.87, 1105.84],
    [18268.60, 6, 3044.80, 3044.76],
    [11500.00, 3, 3833.34, 3833.33],
    [2624.35, 3, 874.79, 874.78],
  ])('%s / %s → ilk %s, kalanlar %s', (total, count, first, rest) => {
    const parts = splitInstallments(total, count)
    expect(parts[0]).toBe(first)
    expect(parts.slice(1).every(p => p === rest)).toBe(true)
    expect(sumMoney(parts)).toBe(total)
  })

  it('tek taksit ve tam bölünen tutar', () => {
    expect(splitInstallments(100, 1)).toEqual([100])
    expect(splitInstallments(1000, 2)).toEqual([500, 500])
  })
})
