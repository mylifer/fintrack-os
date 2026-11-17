import { describe, it, expect } from 'vitest'
import {
  buildCategoryData, buildIncomeCategoryData, buildTagExpenseData, buildPeriodComparison, FUND_GAIN_SLICE_ID,
} from './report-data'
import type { Transaction } from '@/types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: Math.random().toString(36), type: 'expense', amount: 100, currency: 'TRY', date: '2026-07-10',
  accountId: 'a1', description: 'x', isInstallment: false,
  createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
  ...over,
})
const cats = [{ id: 'c1', name: 'Market', color: '#111' }, { id: 'c2', name: 'Kira', color: '#222' }]

describe('buildCategoryData', () => {
  it('kategori başına toplar, net ≤ 0 kategoriyi atar, büyükten küçüğe sıralar', () => {
    const d = buildCategoryData([
      tx({ categoryId: 'c1', amount: 100 }), tx({ categoryId: 'c2', amount: 300 }),
      tx({ amount: 50 }), tx({ categoryId: 'c3', amount: -20 }),
    ], cats)
    expect(d.map(s => [s.categoryId, s.name, s.amount])).toEqual([['c2', 'Kira', 300], ['c1', 'Market', 100], [null, 'Kategorisiz', 50]])
    expect(d.reduce((s, x) => s + x.percent, 0)).toBeCloseTo(100)
  })
  it('alt kategori harcamalarını en üst kategorinin dilimine toplar (bütçe kuralı)', () => {
    const tree = [
      { id: 'yemek', name: 'Yemek', color: '#f00' },
      { id: 'restoran', name: 'Restoran', color: '#0f0', parentId: 'yemek' },
      { id: 'kafe', name: 'Kafe', color: '#00f', parentId: 'restoran' },
      { id: 'yetim', name: 'Yetim', color: '#000', parentId: 'silinmis' },
    ]
    const d = buildCategoryData([
      tx({ categoryId: 'yemek', amount: 100 }), tx({ categoryId: 'restoran', amount: 50 }),
      tx({ categoryId: 'kafe', amount: 25 }), tx({ categoryId: 'yetim', amount: 10 }),
    ], tree)
    expect(d.map(s => [s.categoryId, s.name, s.amount])).toEqual([['yemek', 'Yemek', 175], ['yetim', 'Yetim', 10]])
  })
})

describe('buildIncomeCategoryData', () => {
  it('pozitif fon getirisi ayrı dilim olur, yüzdeler yeniden hesaplanır', () => {
    const d = buildIncomeCategoryData([tx({ type: 'income', categoryId: 'c1', amount: 300 })], cats, 100)
    expect(d.map(s => [s.categoryId, s.amount, s.percent])).toEqual([['c1', 300, 75], [FUND_GAIN_SLICE_ID, 100, 25]])
  })
  it('fon getirisi yoksa yalnız kategorili gelir', () => {
    expect(buildIncomeCategoryData([tx({ type: 'income', categoryId: 'c1' })], cats, 0)).toHaveLength(1)
  })
})

describe('buildTagExpenseData', () => {
  it('her etikete tam tutar yazılır, büyük/küçük harf birleştirilir', () => {
    const d = buildTagExpenseData([
      tx({ amount: 100, tags: ['Tatil', 'yemek'] }), tx({ amount: 50, tags: ['tatil'] }), tx({ amount: 70 }),
    ])
    expect(d.map(s => [s.name, s.amount])).toEqual([['Tatil', 150], ['yemek', 100]])
  })
})

describe('buildPeriodComparison', () => {
  it('cari ve önceki dönemi kategori başına karşılaştırır', () => {
    const rows = buildPeriodComparison([
      tx({ categoryId: 'c1', amount: 150, date: '2026-07-05' }),
      tx({ categoryId: 'c1', amount: 100, date: '2026-06-05' }),
      tx({ categoryId: 'c2', amount: 80, date: '2026-06-07' }),
    ], cats, { from: '2026-07-01', to: '2026-07-31' }, 'all', { from: '2026-06-01', to: '2026-06-30' })
    expect(rows.map(r => [r.categoryId, r.current, r.prev, r.pct])).toEqual([['c1', 150, 100, 50], ['c2', 0, 80, -100]])
  })
})
