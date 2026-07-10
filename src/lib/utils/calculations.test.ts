import { describe, it, expect, beforeAll } from 'vitest'
import type { Account, Budget, Debt, PriceData, Transaction } from '@/types'
import { calcPeriodFlow, computeTransactionEffect, enrichBudget, enrichDebt } from './calculations'
import { setBaseRates } from './fx'

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 0, currency: 'TRY', date: '2026-01-15',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 0, updatedAt: 0 } as PriceData)
})

describe('calcPeriodFlow (S2/S3)', () => {
  it('sums amountTry, nets refunds, excludes reconciliation ghosts', () => {
    const txs = [
      tx({ type: 'income',  amount: 1000, amountTry: 1000 }),
      tx({ type: 'expense', amount: 300,  amountTry: 300 }),
      tx({ type: 'expense', amount: -100, amountTry: -100 }),                 // refund nets down
      tx({ type: 'income',  amount: 50, currency: 'USD', amountTry: 1725 }),  // 50 * 34.5
      tx({ type: 'expense', amount: 9999, amountTry: 9999, systemKind: 'reconciliation' }), // ghost
    ]
    const r = calcPeriodFlow(txs, '2026-01-01', '2026-01-31')
    expect(r.income).toBe(2725)
    expect(r.expense).toBe(200)
    expect(r.net).toBe(2525)
  })
})

describe('computeTransactionEffect (S2 balances)', () => {
  const acc = (id: string, currency: Account['currency']) => ({ id, currency }) as Account

  it('income adds, expense subtracts in the account currency', () => {
    const txs = [tx({ type: 'income', amount: 1000, accountId: 'a' }), tx({ type: 'expense', amount: 250, accountId: 'a' })]
    expect(computeTransactionEffect(acc('a', 'TRY'), txs)).toBe(750)
  })

  it('same-currency transfer moves the raw amount both legs', () => {
    const txs = [tx({ type: 'transfer', amount: 500, accountId: 'a', toAccountId: 'b', currency: 'TRY' })]
    expect(computeTransactionEffect(acc('a', 'TRY'), txs)).toBe(-500)
    expect(computeTransactionEffect(acc('b', 'TRY'), txs)).toBe(500)
  })

  it('cross-currency transfer: source loses native, target gains converted', () => {
    const txs = [tx({ type: 'transfer', amount: 100, currency: 'USD', accountId: 'usd', toAccountId: 'try', amountTry: 3450 })]
    expect(computeTransactionEffect(acc('usd', 'USD'), txs)).toBe(-100)   // native USD out
    expect(computeTransactionEffect(acc('try', 'TRY'), txs)).toBe(3450)   // TRY in
  })
})

describe('enrich helpers', () => {
  it('budget spent/remaining/status', () => {
    const b = enrichBudget(
      { id: 'b', categoryId: 'c', amount: 1000, period: 'monthly', rollover: false, alertThreshold: 80 } as Budget,
      [tx({ type: 'expense', amount: 600, amountTry: 600, categoryId: 'c' })],
      { month: 1, year: 2026 },
    )
    expect(b.spent).toBe(600)
    expect(b.remaining).toBe(400)
    expect(b.status).toBe('ok')
  })

  it('debt remaining floors at 0 and progress caps at 100', () => {
    const d = enrichDebt({ totalAmount: 1000, paidAmount: 1200 } as Debt)
    expect(d.remainingAmount).toBe(0)
    expect(d.progressPercent).toBe(100)
  })
})
