import { describe, it, expect, beforeAll } from 'vitest'
import type { PriceData, Transaction } from '@/types'
import { setBaseRates } from './fx'
import { aggregateTags } from './tags'
import { RECONCILE_TAG } from './reconciliation'

const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 0, currency: 'TRY', date: '2026-01-15',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 0, updatedAt: 0 } as PriceData)
})

describe('aggregateTags — currency normalization & ghost exclusion', () => {
  it('sums income/expense/volume in TRY (baseAmount), never ₺+$ raw', () => {
    const [t] = aggregateTags([
      tx({ type: 'expense', amount: 100, amountTry: 100, tags: ['Tatil'] }),
      tx({ type: 'expense', amount: 10, currency: 'USD', amountTry: 345, tags: ['Tatil'] }), // 10*34.5
      tx({ type: 'income',  amount: 50, currency: 'USD', amountTry: 1725, tags: ['Tatil'] }), // 50*34.5
    ])
    expect(t.tag).toBe('Tatil')
    expect(t.expense).toBe(445)
    expect(t.income).toBe(1725)
    expect(t.volume).toBe(2170)
    expect(t.count).toBe(3)
  })

  it('is kuruş-exact across many rows', () => {
    const [t] = aggregateTags([
      tx({ type: 'expense', amount: 0.1, amountTry: 0.1, tags: ['x'] }),
      tx({ type: 'expense', amount: 0.2, amountTry: 0.2, tags: ['x'] }),
    ])
    expect(t.expense).toBe(0.3)
  })

  it('excludes balance-reconciliation ghosts entirely (tag never surfaces, totals not inflated)', () => {
    const result = aggregateTags([
      tx({ type: 'expense', amount: 100, amountTry: 100, tags: ['Market'] }),
      // ghost via systemKind, carrying the reconcile tag + a shared tag
      tx({ type: 'expense', amount: 9999, amountTry: 9999, systemKind: 'reconciliation', tags: [RECONCILE_TAG, 'Market'] }),
    ])
    const market = result.find(t => t.tag === 'Market')
    expect(market?.expense).toBe(100)          // ghost's 9999 not added
    expect(market?.count).toBe(1)
    expect(result.some(t => t.key === '#bakiyeeşitleme')).toBe(false) // reconcile tag absent
  })
})
