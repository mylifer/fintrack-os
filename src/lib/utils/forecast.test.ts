import { describe, it, expect, beforeEach } from 'vitest'
import { buildForecast, futureDebtPayments } from './forecast'
import { setBaseRates } from './fx'
import type { Account, Debt, RecurringTransaction, Transaction } from '@/types'

/* ── Factories ──────────────────────────────────────────────────────── */

function account(over: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Vadesiz',
    type: 'checking',
    currency: 'TRY',
    balance: 1000,
    initialBalance: 1000,
    color: '#1A5CA3',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

let seq = 0
function recurring(over: Partial<RecurringTransaction> = {}): RecurringTransaction {
  seq += 1
  return {
    id: `r-${seq}`,
    name: `Şablon ${seq}`,
    type: 'expense',
    amount: 100,
    currency: 'TRY',
    accountId: 'acc-1',
    description: '',
    frequency: 'monthly',
    startDate: '2026-01-01',
    nextDueDate: '2026-02-01',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

let debtSeq = 0
function debt(over: Partial<Debt> = {}): Debt {
  debtSeq += 1
  return {
    id: `d-${debtSeq}`,
    name: `Borç ${debtSeq}`,
    type: 'bank_loan',
    direction: 'owe',
    totalAmount: 12000,
    paidAmount: 0,
    startDate: '2026-01-01',
    monthlyPayment: 1000,
    totalInstallments: 12,
    accountId: 'acc-1',
    isSettled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const TODAY = '2026-01-01'

describe('buildForecast — pure cash-flow projection', () => {
  beforeEach(() => {
    // TRY is always exact; a rate is only needed by the currency-path test.
    setBaseRates({ usdTry: 30, eurTry: 35, gbpTry: 40, goldGramTry: 0, updatedAt: 0 })
  })

  it('no recurring → flat line at the current balance', () => {
    const f = buildForecast({ accounts: [account({ balance: 5000 })], recurring: [], horizonMonths: 6, todayStr: TODAY })
    expect(f.points).toEqual([{ date: TODAY, balance: 5000 }])
    expect(f.horizonEnd).toBe('2026-07-01')
    expect(f.shortfallDate).toBeNull()
    expect(f.totalIncome).toBe(0)
    expect(f.totalExpense).toBe(0)
    expect(f.net).toBe(0)
    expect(f.drivers).toEqual([])
  })

  it('investmentsTry is added to the starting balance and carries through the projection', () => {
    const f = buildForecast({
      accounts: [account({ balance: 1000 })],
      recurring: [recurring({ amount: 1500, nextDueDate: '2026-02-01' })],
      investmentsTry: 2000,
      horizonMonths: 1,
      todayStr: TODAY,
    })
    expect(f.points[0]).toEqual({ date: TODAY, balance: 3000 })
    expect(f.points.at(-1)!.balance).toBe(1500) // 3000 − 1500
    expect(f.shortfallDate).toBeNull() // investments cover the expense
  })

  it('one monthly expense larger than balance → shortfall on first occurrence', () => {
    const f = buildForecast({
      accounts: [account({ balance: 1000 })],
      recurring: [recurring({ amount: 1500, nextDueDate: '2026-02-01' })],
      horizonMonths: 3,
      todayStr: TODAY,
    })
    // Occurrences 02-01, 03-01, 04-01 (horizonEnd = 2026-04-01, inclusive).
    expect(f.points).toHaveLength(4) // start + 3
    expect(f.shortfallDate).toBe('2026-02-01')
    expect(f.points[1]).toEqual({ date: '2026-02-01', balance: -500 })
    expect(f.points[3].balance).toBe(-3500)
    expect(f.totalExpense).toBe(4500)
  })

  it('income + expense net correctly over the horizon', () => {
    const f = buildForecast({
      accounts: [account({ balance: 0 })],
      recurring: [
        recurring({ type: 'income',  amount: 5000, nextDueDate: '2026-02-01' }),
        recurring({ type: 'expense', amount: 1500, nextDueDate: '2026-02-01' }),
      ],
      horizonMonths: 3,
      todayStr: TODAY,
    })
    expect(f.totalIncome).toBe(15000)  // 5000 × 3
    expect(f.totalExpense).toBe(4500)  // 1500 × 3
    expect(f.net).toBe(10500)
    // Same-date events fold into one point per date: start + 3 dates.
    expect(f.points).toHaveLength(4)
    expect(f.points.at(-1)!.balance).toBe(10500)
    expect(f.shortfallDate).toBeNull()
  })

  it('foreign amounts convert to TRY at the live rate', () => {
    const f = buildForecast({
      accounts: [account({ balance: 0 })],
      recurring: [recurring({ type: 'income', currency: 'USD', amount: 100, nextDueDate: '2026-02-01' })],
      horizonMonths: 1, // horizonEnd 2026-02-01 → exactly one occurrence
      todayStr: TODAY,
    })
    expect(f.totalIncome).toBe(3000) // 100 USD × 30
    expect(f.points.at(-1)!.balance).toBe(3000)
    expect(f.drivers[0].monthlyEquivTry).toBe(3000) // monthly × 1
  })

  it('transfers are excluded (net to zero at aggregate)', () => {
    const f = buildForecast({
      accounts: [account({ balance: 1000 })],
      recurring: [recurring({ type: 'transfer', amount: 900, toAccountId: 'acc-2', nextDueDate: '2026-02-01' })],
      horizonMonths: 3,
      todayStr: TODAY,
    })
    expect(f.points).toEqual([{ date: TODAY, balance: 1000 }])
    expect(f.drivers).toEqual([]) // transfers never appear as drivers
  })

  it('future-dated one-off transactions enter the projection on their date', () => {
    const oneOff = (o: Partial<Transaction>): Transaction => ({
      id: `t-${++seq}`, type: 'expense', amount: 0, currency: 'TRY', date: TODAY,
      accountId: 'acc-1', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
    })
    const f = buildForecast({
      accounts: [account({ balance: 1000 })],
      recurring: [],
      transactions: [
        oneOff({ type: 'expense', amount: 300, date: '2026-02-10' }),                 // gelecek → dahil
        oneOff({ type: 'income',  amount: 500, date: '2026-03-05' }),                 // gelecek → dahil
        oneOff({ type: 'expense', amount: 999, date: '2025-12-20' }),                 // geçmiş → bakiyede zaten var
        oneOff({ type: 'expense', amount: 111, date: '2026-09-01' }),                 // ufuk dışı
        oneOff({ type: 'transfer', amount: 400, date: '2026-02-15', toAccountId: 'acc-2' }), // transfer → net sıfır
        oneOff({ type: 'expense', amount: 50, date: '2026-02-20', systemKind: 'reconciliation' }), // ghost
      ],
      horizonMonths: 6,
      todayStr: TODAY,
    })
    expect(f.points.map(p => [p.date, p.balance])).toEqual([
      [TODAY, 1000],
      ['2026-02-10', 700],
      ['2026-03-05', 1200],
    ])
    expect(f.totalIncome).toBe(500)
    expect(f.totalExpense).toBe(300)
  })

  it('events list every occurrence date-asc with running balanceAfter', () => {
    const oneOff = (o: Partial<Transaction>): Transaction => ({
      id: `t-${++seq}`, type: 'expense', amount: 0, currency: 'TRY', date: TODAY,
      accountId: 'acc-1', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
    })
    const f = buildForecast({
      accounts: [account({ balance: 1000 })],
      recurring: [recurring({ name: 'Kira', type: 'expense', amount: 700, nextDueDate: '2026-02-01' })],
      transactions: [oneOff({ type: 'income', amount: 500, date: '2026-02-15', description: 'Prim' })],
      horizonMonths: 2,
      todayStr: TODAY,
    })
    expect(f.events).toEqual([
      { date: '2026-02-01', name: 'Kira', type: 'expense', amountTry: 700, balanceAfter: 300 },
      { date: '2026-02-15', name: 'Prim', type: 'income',  amountTry: 500, balanceAfter: 800 },
      { date: '2026-03-01', name: 'Kira', type: 'expense', amountTry: 700, balanceAfter: 100 },
    ])
    // Last event of each day agrees with that day's chart point.
    expect(f.points.at(-1)!.balance).toBe(100)
  })

  describe('cash mode — liquidity view', () => {
    const checking = () => account({ id: 'acc-1', type: 'checking', balance: 5000 })
    const card     = () => account({ id: 'cc-1',  type: 'credit_card', balance: -3000, name: 'Kart' })
    const ccPayment = () =>
      recurring({ name: 'Kart Ödemesi', type: 'transfer', amount: 3000, accountId: 'acc-1', toAccountId: 'cc-1', nextDueDate: '2026-02-01' })

    it('credit-card payment: invisible in total mode, cash outflow in cash mode', () => {
      const base = { accounts: [checking(), card()], recurring: [ccPayment()], horizonMonths: 1, todayStr: TODAY }

      const total = buildForecast(base)
      expect(total.points).toEqual([{ date: TODAY, balance: 2000 }])  // 5000 − 3000 borç, transfer net sıfır
      expect(total.events).toEqual([])

      const cash = buildForecast({ ...base, mode: 'cash' })
      expect(cash.points).toEqual([
        { date: TODAY, balance: 5000 },            // kart borcu başlangıca dahil değil
        { date: '2026-02-01', balance: 2000 },     // ödeme günü nakit düşer
      ])
      expect(cash.events).toEqual([
        { date: '2026-02-01', name: 'Kart Ödemesi', type: 'expense', amountTry: 3000, balanceAfter: 2000 },
      ])
      expect(cash.drivers).toEqual([
        { id: expect.any(String), name: 'Kart Ödemesi', type: 'expense', monthlyEquivTry: 3000 },
      ])
    })

    it('expense charged to the card moves total but not cash', () => {
      const exp = recurring({ name: 'Market', type: 'expense', amount: 400, accountId: 'cc-1', nextDueDate: '2026-02-01' })
      const base = { accounts: [checking(), card()], recurring: [exp], horizonMonths: 1, todayStr: TODAY }
      expect(buildForecast(base).points.at(-1)!.balance).toBe(1600)                     // 2000 − 400
      expect(buildForecast({ ...base, mode: 'cash' }).points).toEqual([{ date: TODAY, balance: 5000 }])
    })

    it('liquid→liquid transfers and investmentsTry stay out of the cash view; TEFAS funds join it', () => {
      const savings = account({ id: 'sv-1', type: 'savings', balance: 1000 })
      const move = recurring({ type: 'transfer', amount: 500, accountId: 'acc-1', toAccountId: 'sv-1', nextDueDate: '2026-02-01' })
      const f = buildForecast({
        accounts: [checking(), savings], recurring: [move],
        investmentsTry: 9999, fundsTry: 2500, horizonMonths: 3, todayStr: TODAY, mode: 'cash',
      })
      expect(f.points).toEqual([{ date: TODAY, balance: 8500 }])  // 5000 + 1000 + 2500 TEFAS; altın/döviz (9999) hariç
      expect(f.drivers).toEqual([])
    })

    it('total mode keeps the whole portfolio and ignores fundsTry (no double count)', () => {
      const f = buildForecast({
        accounts: [checking()], recurring: [],
        investmentsTry: 9999, fundsTry: 2500, horizonMonths: 1, todayStr: TODAY,
      })
      expect(f.points).toEqual([{ date: TODAY, balance: 14999 }])  // 5000 + 9999 (fundsTry zaten içinde)
    })

    it('future one-off card payment enters the cash projection on its date', () => {
      const oneOff: Transaction = {
        id: 't-cc', type: 'transfer', amount: 1500, currency: 'TRY', date: '2026-02-10',
        accountId: 'acc-1', toAccountId: 'cc-1', description: 'Şubat ekstresi',
        isInstallment: false, createdAt: '', updatedAt: '',
      }
      const f = buildForecast({
        accounts: [checking(), card()], recurring: [], transactions: [oneOff],
        horizonMonths: 2, todayStr: TODAY, mode: 'cash',
      })
      expect(f.events).toEqual([
        { date: '2026-02-10', name: 'Şubat ekstresi', type: 'expense', amountTry: 1500, balanceAfter: 3500 },
      ])
    })
  })

  it('drivers express each frequency as a monthly-equivalent, sorted desc', () => {
    const f = buildForecast({
      accounts: [account()],
      recurring: [
        recurring({ name: 'Maaş',    type: 'income',  amount: 40000, frequency: 'monthly' }),
        recurring({ name: 'Kahve',   type: 'expense', amount: 50,    frequency: 'daily' }),
        recurring({ name: 'Sigorta', type: 'expense', amount: 12000, frequency: 'yearly' }),
      ],
      horizonMonths: 6,
      todayStr: TODAY,
    })
    expect(f.drivers.map(d => d.name)).toEqual(['Maaş', 'Kahve', 'Sigorta'])
    expect(f.drivers[0].monthlyEquivTry).toBe(40000)      // monthly × 1
    expect(f.drivers[1].monthlyEquivTry).toBe(1521.88)    // 50 × 30.4375
    expect(f.drivers[2].monthlyEquivTry).toBe(1000)       // 12000 ÷ 12
  })
})

describe('buildForecast — tracked debt installments', () => {
  beforeEach(() => {
    setBaseRates({ usdTry: 30, eurTry: 35, gbpTry: 40, goldGramTry: 0, updatedAt: 0 })
  })

  it('projects future unpaid installments as expenses (owe)', () => {
    const f = buildForecast({
      accounts: [account({ balance: 5000 })],
      recurring: [],
      debts: [debt({ id: 'kredi', name: 'Araba Kredisi' })],  // 1000/ay, startDate=today, vade yok
      horizonMonths: 3,
      todayStr: TODAY,
    })
    // horizonEnd = 2026-04-01 → üç taksit projekte edilir.
    expect(f.points).toEqual([
      { date: TODAY,        balance: 5000 },
      { date: '2026-02-01', balance: 4000 },
      { date: '2026-03-01', balance: 3000 },
      { date: '2026-04-01', balance: 2000 },
    ])
    expect(f.totalExpense).toBe(3000)
    expect(f.net).toBe(-3000)
    expect(f.drivers).toEqual([
      { id: 'debt-kredi', name: 'Araba Kredisi', type: 'expense', monthlyEquivTry: 1000 },
    ])
  })

  it('only the unpaid portion of a partially-paid installment carries forward', () => {
    const f = buildForecast({
      accounts: [account({ balance: 5000 })],
      recurring: [],
      debts: [debt({ name: 'Kredi', paidAmount: 1500 })],  // ilk taksit tam, ikincinin 500'ü ödenmiş
      horizonMonths: 3,
      todayStr: TODAY,
    })
    // İlk taksit başlangıç gününde (= today) düşer, projeksiyona girmez.
    expect(f.events).toEqual([
      { date: '2026-02-01', name: 'Kredi', type: 'expense', amountTry: 500,  balanceAfter: 4500 },
      { date: '2026-03-01', name: 'Kredi', type: 'expense', amountTry: 1000, balanceAfter: 3500 },
      { date: '2026-04-01', name: 'Kredi', type: 'expense', amountTry: 1000, balanceAfter: 2500 },
    ])
    expect(f.totalExpense).toBe(2500)
  })

  it('owed debts are projected as incoming money', () => {
    const f = buildForecast({
      accounts: [account({ balance: 0 })],
      recurring: [],
      debts: [debt({ direction: 'owed' })],
      horizonMonths: 2,
      todayStr: TODAY,
    })
    expect(f.totalIncome).toBe(2000)   // 02-01, 03-01
    expect(f.totalExpense).toBe(0)
    expect(f.points.at(-1)!.balance).toBe(2000)
    expect(f.drivers[0].type).toBe('income')
  })

  it('settled debts and those without a monthly payment produce nothing', () => {
    const f = buildForecast({
      accounts: [account({ balance: 5000 })],
      recurring: [],
      debts: [
        debt({ id: 'd-settled', isSettled: true }),
        debt({ id: 'd-nomonthly', monthlyPayment: undefined }),
      ],
      horizonMonths: 6,
      todayStr: TODAY,
    })
    expect(f.points).toEqual([{ date: TODAY, balance: 5000 }])
    expect(f.drivers).toEqual([])
  })

  it('dueDate anchors the final installment (schedule counts backward)', () => {
    const payments = futureDebtPayments(
      debt({ totalAmount: 3000, monthlyPayment: 1000, totalInstallments: 3, dueDate: '2026-03-01' }),
      TODAY, '2026-06-01',
    )
    // Taksitler 01-01, 02-01, 03-01; sadece today'den sonrakiler.
    expect(payments).toEqual([
      { date: '2026-02-01', amount: 1000 },
      { date: '2026-03-01', amount: 1000 },
    ])
  })

  it('cash mode: a payment from a non-liquid account does not drain cash', () => {
    const invest = account({ id: 'inv-1', type: 'investment', balance: 0 })
    const f = buildForecast({
      accounts: [account({ id: 'acc-1', type: 'checking', balance: 5000 }), invest],
      recurring: [],
      debts: [debt({ accountId: 'inv-1' })],  // yatırım hesabından ödeniyor → nakiti etkilemez
      horizonMonths: 3,
      todayStr: TODAY,
      mode: 'cash',
    })
    expect(f.points).toEqual([{ date: TODAY, balance: 5000 }])
    expect(f.totalExpense).toBe(0)
  })
})
