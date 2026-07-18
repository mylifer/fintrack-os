import { describe, it, expect, beforeEach } from 'vitest'
import { buildBalanceHistory } from './balance-history'
import { setBaseRates } from './fx'
import type { Account, Transaction } from '@/types'

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
function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${++seq}`, type: 'expense', amount: 0, currency: 'TRY', date: '2026-01-01',
    accountId: 'acc-1', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...over,
  }
}

const TODAY = '2026-07-18'

describe('buildBalanceHistory — backward daily walk', () => {
  beforeEach(() => {
    setBaseRates({ usdTry: 30, eurTry: 35, gbpTry: 40, goldGramTry: 0, updatedAt: 0 })
  })

  it('no transactions → single point at today', () => {
    const h = buildBalanceHistory({ accounts: [account()], transactions: [], todayStr: TODAY, endBalance: 5000 })
    expect(h).toEqual([{ date: TODAY, balance: 5000 }])
  })

  it('undoes income/expense per day, oldest point first, today last', () => {
    const h = buildBalanceHistory({
      accounts: [account()],
      transactions: [
        tx({ type: 'income',  amount: 4000, date: '2026-03-01' }),
        tx({ type: 'expense', amount: 1500, date: '2026-05-10' }),
      ],
      todayStr: TODAY,
      endBalance: 3500,  // bugünkü bakiye: 1000 başlangıç + 4000 − 1500
    })
    expect(h).toEqual([
      { date: '2026-03-01', balance: 5000 },  // gün sonu: 1000 + 4000
      { date: '2026-05-10', balance: 3500 },  // gün sonu: 5000 − 1500
      { date: TODAY,        balance: 3500 },
    ])
  })

  it('same-day movements fold into one point; start date = first transaction date', () => {
    const h = buildBalanceHistory({
      accounts: [account()],
      transactions: [
        tx({ type: 'income',  amount: 300, date: '2026-02-01' }),
        tx({ type: 'expense', amount: 100, date: '2026-02-01' }),
      ],
      todayStr: TODAY,
      endBalance: 1200,
    })
    expect(h[0]).toEqual({ date: '2026-02-01', balance: 1200 })
    expect(h).toHaveLength(2)
  })

  it('pending and future-dated rows never enter the walk', () => {
    const h = buildBalanceHistory({
      accounts: [account()],
      transactions: [
        tx({ type: 'expense', amount: 500, date: '2026-04-01', approvalStatus: 'pending' }),
        tx({ type: 'expense', amount: 500, date: '2026-09-01' }),  // gelecek
      ],
      todayStr: TODAY,
      endBalance: 1000,
    })
    expect(h).toEqual([{ date: TODAY, balance: 1000 }])
  })

  it('total mode: transfers ignored, reconciliation included, investments enter on buy day', () => {
    const h = buildBalanceHistory({
      accounts: [account()],
      transactions: [
        tx({ type: 'transfer', amount: 900, date: '2026-03-05', toAccountId: 'acc-2' }),
        tx({ type: 'expense',  amount: 250, date: '2026-04-02', systemKind: 'reconciliation' }),
      ],
      investEvents: [{ date: '2026-05-01', type: 'buy', valueTry: 2000, isTefas: false }],
      todayStr: TODAY,
      endBalance: 2750,  // 1000 − 250 mutabakat + 2000 varlık
    })
    expect(h).toEqual([
      { date: '2026-04-02', balance: 750 },   // mutabakat ham bakiyeyi düşürdü
      { date: '2026-05-01', balance: 2750 },  // alım günü portföy değeri girer
      { date: TODAY,        balance: 2750 },
    ])
  })

  it('cash mode: boundary transfer counts, card expense and non-TEFAS buys stay out', () => {
    const accounts = [account(), account({ id: 'cc-1', type: 'credit_card', balance: -3000 })]
    const h = buildBalanceHistory({
      accounts,
      transactions: [
        tx({ type: 'transfer', amount: 3000, date: '2026-06-01', accountId: 'acc-1', toAccountId: 'cc-1' }),  // kart ödemesi
        tx({ type: 'expense',  amount: 400,  date: '2026-06-10', accountId: 'cc-1' }),                        // karta harcama
      ],
      investEvents: [
        { date: '2026-06-05', type: 'buy', valueTry: 999,  isTefas: false },  // altın vb. — nakit görünümü dışı
        { date: '2026-06-15', type: 'buy', valueTry: 1500, isTefas: true },   // TEFAS — near-cash havuza girer
      ],
      mode: 'cash',
      todayStr: TODAY,
      endBalance: 3500,  // 5000 − 3000 ödeme + 1500 TEFAS
    })
    expect(h).toEqual([
      { date: '2026-06-01', balance: 2000 },
      { date: '2026-06-15', balance: 3500 },
      { date: TODAY,        balance: 3500 },
    ])
  })
})
