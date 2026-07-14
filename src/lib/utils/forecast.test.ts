import { describe, it, expect, beforeEach } from 'vitest'
import { buildForecast } from './forecast'
import { setBaseRates } from './fx'
import type { Account, RecurringTransaction } from '@/types'

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

const TODAY = '2026-01-01'

describe('buildForecast — pure cash-flow projection', () => {
  beforeEach(() => {
    // TRY is always exact; a rate is only needed by the currency-path test.
    setBaseRates({ usdTry: 30, eurTry: 35, gbpTry: 40, goldGramTry: 0, updatedAt: 0 })
  })

  it('no recurring → flat line at the current balance', () => {
    const f = buildForecast({ accounts: [account({ balance: 5000 })], recurring: [], horizonMonths: 6, todayStr: TODAY })
    expect(f.points).toEqual([{ date: TODAY, balance: 5000 }])
    expect(f.shortfallDate).toBeNull()
    expect(f.totalIncome).toBe(0)
    expect(f.totalExpense).toBe(0)
    expect(f.net).toBe(0)
    expect(f.drivers).toEqual([])
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
