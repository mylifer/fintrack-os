import { describe, it, expect, beforeAll } from 'vitest'
import type { Account, Budget, Category, Debt, PriceData, Transaction } from '@/types'
import { calcPeriodFlow, computeTransactionEffect, enrichBudget, enrichDebt, excludeFuture, expandCategoryIds, isInvestmentPrincipalTx, isRealizedInvestmentPnlTx, isPosted, sumByType, sumExpenseByKey, sumIncomeByKey } from './calculations'
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

describe('yatırım anaparası akıştan hariç, gerçekleşen K/Z dahil', () => {
  it('isInvestmentPrincipalTx: yalnız icon\'lu "… Alımı"/"… Satışı" satırları', () => {
    expect(isInvestmentPrincipalTx(tx({ icon: 'F', description: '10 AKB Alımı' }))).toBe(true)
    expect(isInvestmentPrincipalTx(tx({ icon: 'F', description: '10 AKB Satışı' }))).toBe(true)
    // gerçekleşen kâr/zarar anapara DEĞİL — akışta kalmalı
    expect(isInvestmentPrincipalTx(tx({ icon: 'F', description: 'AKB Satış Kârı' }))).toBe(false)
    expect(isInvestmentPrincipalTx(tx({ icon: 'F', description: 'AKB Satış Zararı' }))).toBe(false)
    // icon yoksa (normal işlem) hiç eşleşmez, açıklaması ne olursa olsun
    expect(isInvestmentPrincipalTx(tx({ description: 'Manuel Alımı' }))).toBe(false)
  })

  it('isRealizedInvestmentPnlTx: yalnız icon\'lu "… Satış Kârı/Zararı" satırları', () => {
    expect(isRealizedInvestmentPnlTx(tx({ icon: 'F', description: 'AKB Satış Kârı' }))).toBe(true)
    expect(isRealizedInvestmentPnlTx(tx({ icon: 'F', description: 'AKB Satış Zararı' }))).toBe(true)
    // anapara hareketi P&L değil
    expect(isRealizedInvestmentPnlTx(tx({ icon: 'F', description: '10 AKB Satışı' }))).toBe(false)
    expect(isRealizedInvestmentPnlTx(tx({ icon: 'F', description: '10 AKB Alımı' }))).toBe(false)
    // icon yoksa eşleşmez (kullanıcının elle yazdığı benzer açıklama)
    expect(isRealizedInvestmentPnlTx(tx({ description: 'Dükkan Satış Kârı' }))).toBe(false)
  })

  it('dashboard fon-sız akış: P&L satırları çıkarılınca gelir/net fon-sız olur', () => {
    // Dashboard "Fon getirileri dahil" KAPALIYKEN uygulanan ön-filtre ile aynı:
    // gerçekleşen "… Satış Kârı/Zararı" satırları akış dışı bırakılır.
    const txs = [
      tx({ type: 'income',  amount: 800,  amountTry: 800,  icon: 'F', description: 'AKB Satış Kârı' }),
      tx({ type: 'expense', amount: 200,  amountTry: 200,  icon: 'F', description: 'THY Satış Zararı' }),
      tx({ type: 'income',  amount: 1000, amountTry: 1000, description: 'Maaş' }),
      tx({ type: 'expense', amount: 300,  amountTry: 300,  description: 'Market' }),
    ]
    const fundFree = txs.filter(t => !isRealizedInvestmentPnlTx(t))
    const r = calcPeriodFlow(fundFree, '2026-01-01', '2026-01-31')
    expect(r.income).toBe(1000)   // yalnız maaş — satış kârı düştü
    expect(r.expense).toBe(300)   // yalnız market — satış zararı düştü
    expect(r.net).toBe(700)
  })

  it('calcPeriodFlow: satış anaparasını atar, satış kârını gelir sayar', () => {
    const txs = [
      tx({ type: 'income',  amount: 5000, amountTry: 5000, icon: 'F', description: '10 AKB Satışı' }),   // anapara → hariç
      tx({ type: 'income',  amount: 800,  amountTry: 800,  icon: 'F', description: 'AKB Satış Kârı' }),  // realize kâr → dahil
      tx({ type: 'expense', amount: 3000, amountTry: 3000, icon: 'F', description: '5 THY Alımı' }),      // alış maliyeti → hariç
      tx({ type: 'expense', amount: 200,  amountTry: 200,  icon: 'F', description: 'THY Satış Zararı' }), // realize zarar → dahil
      tx({ type: 'income',  amount: 1000, amountTry: 1000, description: 'Maaş' }),                        // normal gelir
    ]
    const r = calcPeriodFlow(txs, '2026-01-01', '2026-01-31')
    expect(r.income).toBe(1800)  // 1000 maaş + 800 satış kârı (5000 anapara hariç)
    expect(r.expense).toBe(200)  // sadece satış zararı (3000 alış maliyeti hariç)
    expect(r.net).toBe(1600)
  })
})

describe('isPosted / excludeFuture (pending transactions)', () => {
  it('a transaction dated after asOf is pending; on/before asOf is posted', () => {
    expect(isPosted(tx({ date: '2026-01-16' }), '2026-01-15')).toBe(false)
    expect(isPosted(tx({ date: '2026-01-15' }), '2026-01-15')).toBe(true)
    expect(isPosted(tx({ date: '2026-01-14' }), '2026-01-15')).toBe(true)
  })

  it('tolerates full ISO datetime dates via slice(0,10)', () => {
    expect(isPosted(tx({ date: '2026-02-01T09:30:00.000Z' }), '2026-01-15')).toBe(false)
    expect(isPosted(tx({ date: '2026-01-15T23:59:00.000Z' }), '2026-01-15')).toBe(true)
  })

  it("approval gate: a 'pending' row is NOT posted even when its date has arrived", () => {
    expect(isPosted(tx({ date: '2026-01-10', approvalStatus: 'pending' }), '2026-01-15')).toBe(false)
    expect(isPosted(tx({ date: '2026-01-15', approvalStatus: 'pending' }), '2026-01-15')).toBe(false)
    // approved / legacy (undefined) rows keep the normal date rule
    expect(isPosted(tx({ date: '2026-01-10', approvalStatus: 'approved' }), '2026-01-15')).toBe(true)
    expect(isPosted(tx({ date: '2026-01-10', approvalStatus: null }), '2026-01-15')).toBe(true)
    expect(isPosted(tx({ date: '2026-01-16', approvalStatus: 'approved' }), '2026-01-15')).toBe(false)
  })

  it('excludeFuture drops pending rows regardless of date, legacy rows only when future', () => {
    const txs = [
      tx({ id: 'legacy-past',  date: '2026-01-01' }),
      tx({ id: 'pending-past', date: '2026-01-02', approvalStatus: 'pending' }),
      tx({ id: 'approved',     date: '2026-01-03', approvalStatus: 'approved' }),
    ]
    expect(excludeFuture(txs, '2026-01-15').map(t => t.id)).toEqual(['legacy-past', 'approved'])
  })

  it('excludeFuture drops only future-dated transactions', () => {
    const txs = [
      tx({ id: 'past',   date: '2026-01-01' }),
      tx({ id: 'today',  date: '2026-01-15' }),
      tx({ id: 'future', date: '2026-03-01' }),
    ]
    expect(excludeFuture(txs, '2026-01-15').map(t => t.id)).toEqual(['past', 'today'])
  })

  it('balance effect ignores future transactions once filtered', () => {
    const acc = { id: 'a', currency: 'TRY' } as Account
    const txs = [
      tx({ type: 'income',  amount: 1000, accountId: 'a', date: '2026-01-10' }),
      tx({ type: 'expense', amount: 400,  accountId: 'a', date: '2026-02-20' }), // gelecek
    ]
    expect(computeTransactionEffect(acc, excludeFuture(txs, '2026-01-15'))).toBe(1000)
    expect(computeTransactionEffect(acc, excludeFuture(txs, '2026-02-20'))).toBe(600)
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

describe('sumByType (currency-safe per-type totals)', () => {
  it('TRY-normalizes each type via baseAmount (never adds ₺+$ raw)', () => {
    const r = sumByType([
      tx({ type: 'income',  amount: 1000, amountTry: 1000 }),
      tx({ type: 'income',  amount: 50, currency: 'USD', amountTry: 1725 }),   // 50 * 34.5
      tx({ type: 'expense', amount: 300,  amountTry: 300 }),
      tx({ type: 'expense', amount: 10, currency: 'USD', amountTry: 345 }),    // 10 * 34.5
      tx({ type: 'transfer', amount: 200, amountTry: 200 }),
    ])
    expect(r.income).toBe(2725)
    expect(r.expense).toBe(645)
    expect(r.transfer).toBe(200)
  })

  it('is kuruş-exact (no float drift accumulating many rows)', () => {
    const r = sumByType([
      tx({ type: 'expense', amount: 0.1, amountTry: 0.1 }),
      tx({ type: 'expense', amount: 0.2, amountTry: 0.2 }),
    ])
    expect(r.expense).toBe(0.3)
  })

  it('legacy foreign row (no amountTry) uses the live rate', () => {
    const r = sumByType([tx({ type: 'income', amount: 100, currency: 'USD' })])
    expect(r.income).toBe(3450)
  })
})

describe('sumExpenseByKey (category/tag donut grouping)', () => {
  it('groups expenses by key in TRY, skipping investment-linked & reconciliation', () => {
    const m = sumExpenseByKey([
      tx({ type: 'expense', amount: 100, amountTry: 100, categoryId: 'food' }),
      tx({ type: 'expense', amount: 5, currency: 'USD', amountTry: 172.5, categoryId: 'food' }), // 5*34.5
      tx({ type: 'expense', amount: 40, amountTry: 40, categoryId: 'transport' }),
      tx({ type: 'income',  amount: 999, amountTry: 999, categoryId: 'food' }),                  // not expense
      tx({ type: 'expense', amount: 500, amountTry: 500, categoryId: 'food', icon: 'Au' }),      // investment-linked
      tx({ type: 'expense', amount: 700, amountTry: 700, categoryId: 'food', systemKind: 'reconciliation' }), // ghost
    ], t => t.categoryId ?? '__none__')
    expect(m.get('food')).toBe(272.5)
    expect(m.get('transport')).toBe(40)
    expect(m.size).toBe(2)
  })
})

describe('sumIncomeByKey (income category donut grouping)', () => {
  it('groups income by key in TRY, skipping expense/investment-linked & reconciliation', () => {
    const m = sumIncomeByKey([
      tx({ type: 'income',  amount: 1000, amountTry: 1000, categoryId: 'salary' }),
      tx({ type: 'income',  amount: 5, currency: 'USD', amountTry: 172.5, categoryId: 'salary' }), // 5*34.5
      tx({ type: 'income',  amount: 250, amountTry: 250 }),                                        // uncategorized
      tx({ type: 'expense', amount: 999, amountTry: 999, categoryId: 'salary' }),                  // not income
      tx({ type: 'income',  amount: 500, amountTry: 500, categoryId: 'salary', icon: 'Au' }),       // investment-linked
      tx({ type: 'income',  amount: 700, amountTry: 700, categoryId: 'salary', systemKind: 'reconciliation' }), // ghost
    ], t => t.categoryId ?? '__none__')
    expect(m.get('salary')).toBe(1172.5)
    expect(m.get('__none__')).toBe(250)
    expect(m.size).toBe(2)
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

  it('budget on a parent category includes subcategory spending (transitively)', () => {
    const cat = (o: Partial<Category>): Category => ({
      id: '', name: '', icon: '', color: '', scope: 'expense', isSystem: false, sortOrder: 0, ...o,
    })
    const categories = [
      cat({ id: 'shopping' }),
      cat({ id: 'clothing', parentId: 'shopping' }),
      cat({ id: 'shoes', parentId: 'clothing' }), // level 2
      cat({ id: 'unrelated' }),
    ]
    expect([...expandCategoryIds(['shopping'], categories)].sort())
      .toEqual(['clothing', 'shoes', 'shopping'])

    const b = enrichBudget(
      { id: 'b', categoryId: 'shopping', amount: 1000, period: 'monthly', rollover: false, alertThreshold: 80 } as Budget,
      [
        tx({ type: 'expense', amount: 100, amountTry: 100, categoryId: 'shopping' }),
        tx({ type: 'expense', amount: 200, amountTry: 200, categoryId: 'clothing' }),
        tx({ type: 'expense', amount: 50,  amountTry: 50,  categoryId: 'shoes' }),
        tx({ type: 'expense', amount: 999, amountTry: 999, categoryId: 'unrelated' }),
      ],
      { month: 1, year: 2026 },
      categories,
    )
    expect(b.spent).toBe(350)
  })

  it('debt remaining floors at 0 and progress caps at 100', () => {
    const d = enrichDebt({ totalAmount: 1000, paidAmount: 1200 } as Debt)
    expect(d.remainingAmount).toBe(0)
    expect(d.progressPercent).toBe(100)
  })
})
