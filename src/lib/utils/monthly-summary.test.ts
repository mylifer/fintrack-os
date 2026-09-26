import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { buildMonthlySummary } from './monthly-summary'

const tx = (o: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', amount: 0, currency: 'TRY', date: '2025-09-01',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

const cats = [
  { id: 'food', name: 'Market', color: '#0a0' },
  { id: 'rent', name: 'Kira', color: '#a00' },
  { id: 'fun',  name: 'Eğlence', color: '#00a' },
]
// Tarihler geçmişte: akış toplamı (isFlowTx) gerçek bugünden sonrasını saymaz.
const opts = { includeRealizedPnl: true, asOf: '2025-10-15' }

describe('buildMonthlySummary', () => {
  const ledger = [
    tx({ type: 'income',  amount: 50000, date: '2025-09-01', categoryId: 'salary' }),
    tx({ amount: 20000, date: '2025-09-02', categoryId: 'rent' }),
    tx({ amount: 6000,  date: '2025-09-10', categoryId: 'food' }),
    tx({ amount: 4000,  date: '2025-09-20', categoryId: 'food' }),
    tx({ amount: 1500,  date: '2025-09-30', categoryId: 'fun' }),
    tx({ type: 'transfer', amount: 9999, date: '2025-09-05', toAccountId: 'b' }),
    // Ağustos
    tx({ type: 'income',  amount: 40000, date: '2025-08-01' }),
    tx({ amount: 20000, date: '2025-08-02', categoryId: 'rent' }),
    tx({ amount: 5000,  date: '2025-08-31', categoryId: 'food' }),
    // Geçen yıl Eylül
    tx({ amount: 15000, date: '2024-09-02', categoryId: 'rent' }),
  ]

  it('tam ay: gelir, gider, net, tasarruf oranı ve tam önceki ay', () => {
    const s = buildMonthlySummary(ledger, { year: 2025, month: 9 }, cats, opts)
    expect(s.partial).toBe(false)
    expect(s.current).toMatchObject({ from: '2025-09-01', to: '2025-09-30', income: 50000, expense: 31500, net: 18500 })
    expect(s.current.savingsRate).toBeCloseTo(37)
    // 31 Ağustos da sayılır: kıyas ayı tam ay
    expect(s.previous).toMatchObject({ from: '2025-08-01', to: '2025-08-31', income: 40000, expense: 25000 })
    expect(s.lastYear).toMatchObject({ from: '2024-09-01', to: '2024-09-30', expense: 15000, income: 0, savingsRate: null })
    expect(s.txCount).toBe(5) // virman sayılmaz
    expect(s.dailyAvgExpense).toBeCloseTo(1050)
  })

  it('kategoriler tutara göre; önceki ay ve geçen yıl tutarı, % değişim', () => {
    const s = buildMonthlySummary(ledger, { year: 2025, month: 9 }, cats, opts)
    expect(s.categories.map(c => c.name)).toEqual(['Kira', 'Market', 'Eğlence'])
    expect(s.categories[0]).toMatchObject({ amount: 20000, prevAmount: 20000, yearAmount: 15000, change: 0 })
    expect(s.categories[1]).toMatchObject({ amount: 10000, prevAmount: 5000, change: 100 })
    expect(s.categories[2]).toMatchObject({ amount: 1500, prevAmount: 0, change: null })
    // artış listesi yalnız önceki ayda da harcanan kategoriler
    expect(s.increases.map(c => c.name)).toEqual(['Market'])
    expect(s.largestExpenses.map(t => t.amount)).toEqual([20000, 6000, 4000, 1500])
  })

  it('devam eden ay: kıyaslar aynı gün sayısına kırpılır, gelecek tarihli işlem sayılmaz', () => {
    const withFuture = [...ledger, tx({ amount: 999, date: '2025-09-25', categoryId: 'fun' })]
    const s = buildMonthlySummary(withFuture, { year: 2025, month: 9 }, cats, { includeRealizedPnl: true, asOf: '2025-09-15' })
    expect(s.partial).toBe(true)
    expect(s.daysCounted).toBe(15)
    expect(s.current).toMatchObject({ to: '2025-09-15', expense: 26000 })
    expect(s.previous).toMatchObject({ from: '2025-08-01', to: '2025-08-15', expense: 20000 })
    expect(s.lastYear).toMatchObject({ to: '2024-09-15', expense: 15000 })
  })

  it('31 günlük aydan sonra kısa ay: Mart kırpması Şubat sonunda durur', () => {
    const s = buildMonthlySummary([], { year: 2025, month: 3 }, cats, { includeRealizedPnl: true, asOf: '2025-03-31' })
    expect(s.partial).toBe(false)
    expect(s.previous).toMatchObject({ from: '2025-02-01', to: '2025-02-28' })
    const p = buildMonthlySummary([], { year: 2025, month: 3 }, cats, { includeRealizedPnl: true, asOf: '2025-03-30' })
    expect(p.previous).toMatchObject({ from: '2025-02-01', to: '2025-02-28' })
  })

  it('taksitler satın alma ayına toplu; realize yatırım K/Z anahtar kapalıyken hariç', () => {
    const txs = [
      tx({ amount: 1000, date: '2025-09-05', isInstallment: true, installGroupId: 'g', installIndex: 1, installTotal: 3, categoryId: 'fun' }),
      tx({ amount: 1000, date: '2025-10-05', isInstallment: true, installGroupId: 'g', installIndex: 2, installTotal: 3, categoryId: 'fun' }),
      tx({ amount: 1000, date: '2025-11-05', isInstallment: true, installGroupId: 'g', installIndex: 3, installTotal: 3, categoryId: 'fun' }),
      tx({ type: 'income', amount: 700, date: '2025-09-12', icon: '📈', description: 'ABC Satış Kârı' }),
    ]
    const on  = buildMonthlySummary(txs, { year: 2025, month: 9 }, cats, { includeRealizedPnl: true,  asOf: '2025-09-30' })
    const off = buildMonthlySummary(txs, { year: 2025, month: 9 }, cats, { includeRealizedPnl: false, asOf: '2025-09-30' })
    expect(on.current.expense).toBe(3000)
    expect(on.current.income).toBe(700)
    expect(off.current.income).toBe(0)
  })
})
