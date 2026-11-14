import { describe, it, expect, beforeAll } from 'vitest'
import type { Budget, PriceData, Transaction } from '@/types'
import {
  calcMonthlyFlow, enrichTotalBudget, isTotalBudget, isTotalBudgetId, resolveBudgetCategories,
  summarizeTotalBudget, totalBudgetId, TOTAL_BUDGET_CATEGORY,
} from './calculations'
import { collapseInstallments } from './installments'
import { setBaseRates } from './fx'

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 0, currency: 'TRY', date: '2026-01-15',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

const total = (amount: number, alertThreshold = 80): Budget => ({
  id: totalBudgetId('ws1'), categoryId: TOTAL_BUDGET_CATEGORY, amount, period: 'total',
  rollover: false, alertThreshold, workspaceId: 'ws1',
})

const catBudget = (id: string, amount: number, period: Budget['period'] = 'monthly'): Budget => ({
  id, categoryId: `cat-${id}`, amount, period, rollover: false, alertThreshold: 80,
})

const JAN = { month: 1, year: 2026 }

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 0, updatedAt: 0 } as PriceData)
})

describe('toplam bütçe satırı', () => {
  it('kimlik alandan türetilir; satır ve kimlik tanınır', () => {
    expect(totalBudgetId('ws1')).toBe('total-budget-ws1')
    expect(isTotalBudgetId('total-budget-ws1')).toBe(true)
    expect(isTotalBudgetId('b1')).toBe(false)
    expect(isTotalBudget(total(1000))).toBe(true)
    expect(isTotalBudget(catBudget('b', 1))).toBe(false)
  })

  it('bildirim paneli etiketi kategori aramaz, "(arşiv)" demez', () => {
    expect(resolveBudgetCategories(total(1000), [])).toEqual({ cats: [], label: 'Toplam aylık bütçe', archived: false })
  })
})

describe('harcama tanımı — raporlarla AYNI (calcMonthlyFlow.expense)', () => {
  const ledger = collapseInstallments([
    tx({ id: 'market', amount: 400, amountTry: 400 }),
    tx({ id: 'usd', amount: 10, currency: 'USD', amountTry: 345 }),
    tx({ id: 'iade', amount: -50, amountTry: -50 }),                               // iade gideri azaltır (raporlarla aynı)
    tx({ id: 'maas', type: 'income', amount: 9000, amountTry: 9000 }),             // gelir sayılmaz
    tx({ id: 'trf', type: 'transfer', amount: 700, amountTry: 700, toAccountId: 'b' }), // transfer sayılmaz
    tx({ id: 'yat', amount: 1000, amountTry: 1000, icon: '📈', description: 'Altın Alımı' }),  // yatırım anaparası
    tx({ id: 'borc', amount: 2000, amountTry: 2000, icon: '💸', description: 'Ali verilen borç' }), // borç anaparası
    tx({ id: 'alan', amount: 300, amountTry: 300, workspaceTransferId: 'w' }),     // alanlar arası transfer
    tx({ id: 'mutabakat', amount: 80, amountTry: 80, description: 'Bakiye düzeltme', systemKind: 'reconciliation' } as Partial<Transaction>),
    tx({ id: 'onay', amount: 90, amountTry: 90, approvalStatus: 'pending' }),      // onay bekliyor
    tx({ id: 'subat', amount: 999, amountTry: 999, date: '2026-02-01' }),          // başka ay
    // Taksit: satın alma ayına toplu (3 × 100 → Ocak'ta 300)
    tx({ id: 'i1', amount: 100, amountTry: 100, date: '2026-01-20', isInstallment: true, installGroupId: 'G', installIndex: 1, installTotal: 3 }),
    tx({ id: 'i2', amount: 100, amountTry: 100, date: '2026-02-20', isInstallment: true, installGroupId: 'G', installIndex: 2, installTotal: 3 }),
    tx({ id: 'i3', amount: 100, amountTry: 100, date: '2026-03-20', isInstallment: true, installGroupId: 'G', installIndex: 3, installTotal: 3 }),
  ])

  it('harcanan = calcMonthlyFlow(...).expense (yeni bir toplam tanımı yok)', () => {
    const e = enrichTotalBudget(total(2000), ledger, JAN)
    expect(e.spent).toBe(calcMonthlyFlow(ledger, JAN).expense)
  })

  it('kapsam: gerçek giderler + taksit satın alma ayında; iade düşer; anapara/transfer/mutabakat/onay bekleyen hariç', () => {
    // 400 + 345 − 50 + 300 (taksit grubu toplu) = 995
    expect(enrichTotalBudget(total(2000), ledger, JAN).spent).toBe(995)
  })
})

describe('summarizeTotalBudget', () => {
  const ledger = [tx({ id: 'a', amount: 600, amountTry: 600, date: '2026-01-05' })]

  it('harcanan / limit / kalan / yüzde / durum', () => {
    const s = summarizeTotalBudget(total(1000), ledger, JAN, [], '2026-01-10')
    expect(s).toMatchObject({ spent: 600, limit: 1000, remaining: 400, overBy: 0, percentUsed: 60, status: 'ok' })
  })

  it('uyarı eşiği ve aşım kategori bütçeleriyle aynı kuralla', () => {
    expect(summarizeTotalBudget(total(700, 80), ledger, JAN, [], '2026-01-10').status).toBe('warning')
    const over = summarizeTotalBudget(total(500), ledger, JAN, [], '2026-01-10')
    expect(over).toMatchObject({ status: 'exceeded', remaining: 0, overBy: 100 })
    expect(over.dailyRemaining).toBe(0)
  })

  it('günlük kalan ortalama: kalan / ayın kalan günü (bugün dahil), kuruşa aşağı yuvarlanır', () => {
    // 10 Ocak → 31 Ocak: 22 gün; 400 / 22 = 18,1818… → 18,18
    const s = summarizeTotalBudget(total(1000), ledger, JAN, [], '2026-01-10')
    expect(s.daysLeft).toBe(22)
    expect(s.dailyRemaining).toBe(18.18)
    expect(summarizeTotalBudget(total(1000), ledger, JAN, [], '2026-01-31').daysLeft).toBe(1)
  })

  it('geçmiş ayda kalan gün 0, gelecek ayda ayın tamamı', () => {
    expect(summarizeTotalBudget(total(1000), ledger, JAN, [], '2026-03-01').daysLeft).toBe(0)
    const future = summarizeTotalBudget(total(1000), [], { month: 2, year: 2026 }, [], '2026-01-10')
    expect(future.daysLeft).toBe(28)
    expect(future.dailyRemaining).toBe(35.71)
  })

  it('kategori bütçeleri toplamı limiti aşıyorsa işaretlenir (yalnız aylık kategori bütçeleri)', () => {
    const budgets = [catBudget('b1', 600), catBudget('b2', 500), catBudget('y', 9999, 'yearly'), total(1000)]
    const s = summarizeTotalBudget(total(1000), ledger, JAN, budgets, '2026-01-10')
    expect(s.categoryBudgetsTotal).toBe(1100)
    expect(s.categoryBudgetsExceedLimit).toBe(true)
    expect(summarizeTotalBudget(total(1100), ledger, JAN, budgets, '2026-01-10').categoryBudgetsExceedLimit).toBe(false)
  })
})
