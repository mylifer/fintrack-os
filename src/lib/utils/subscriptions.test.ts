import { describe, it, expect, beforeAll } from 'vitest'
import type { PriceData, Transaction } from '@/types'
import { setBaseRates } from './fx'
import { isSubscriptionTx, groupSubscriptions, summarize, findSubscriptionGroup } from './subscriptions'
import { detectBrand, SUBSCRIPTION_TAG } from '@/lib/subscriptions/brands'

beforeAll(() => {
  setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43, goldGramTry: 2800, updatedAt: 0 } as PriceData)
})

/** Minimal transaction builder — only fields the aggregators read matter. */
function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't', type: 'expense', amount: 100, currency: 'TRY',
    date: '2026-07-05', accountId: 'a', description: 'Netflix',
    tags: [SUBSCRIPTION_TAG], isInstallment: false,
    createdAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
    ...over,
  }
}

describe('subscriptions — isSubscriptionTx', () => {
  it('a tagged expense is a subscription', () => {
    expect(isSubscriptionTx(tx())).toBe(true)
  })

  it('a tagged income is NOT a subscription', () => {
    expect(isSubscriptionTx(tx({ type: 'income' }))).toBe(false)
  })

  it('an untagged expense is NOT a subscription', () => {
    expect(isSubscriptionTx(tx({ tags: [] }))).toBe(false)
    expect(isSubscriptionTx(tx({ tags: undefined }))).toBe(false)
  })

  it('tag match is case- and diacritic-insensitive', () => {
    expect(isSubscriptionTx(tx({ tags: ['Abonelik'] }))).toBe(true)
    expect(isSubscriptionTx(tx({ tags: ['ABONELİK'] }))).toBe(true)
    expect(isSubscriptionTx(tx({ tags: ['diger', 'abonelik'] }))).toBe(true)
  })
})

describe('subscriptions — detectBrand', () => {
  it('recognizes Netflix and Spotify', () => {
    expect(detectBrand('Netflix Türkiye')?.key).toBe('netflix')
    expect(detectBrand('SPOTIFY Premium')?.key).toBe('spotify')
  })

  it('is diacritic-insensitive', () => {
    expect(detectBrand('NETFLİX')?.key).toBe('netflix')
  })

  it('prefers the more specific (longer) keyword', () => {
    expect(detectBrand('YouTube Music')?.key).toBe('youtubemusic')
    expect(detectBrand('Apple Music')?.key).toBe('apple')
  })

  it('returns null for an unknown merchant', () => {
    expect(detectBrand('Bakkal Ahmet')).toBeNull()
    expect(detectBrand('', null, undefined)).toBeNull()
  })
})

describe('subscriptions — grouping', () => {
  it('collapses two Netflix charges into one group', () => {
    const groups = groupSubscriptions([
      tx({ id: '1', amount: 149.99, date: '2026-06-05' }),
      tx({ id: '2', amount: 199.99, date: '2026-07-05' }),
    ])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.brand?.key).toBe('netflix')
    expect(g.count).toBe(2)
    // latest charge = the most recent date
    expect(g.latestAmount).toBe(199.99)
    expect(g.lastDate).toBe('2026-07-05')
    expect(g.totalTry).toBe(349.98)
  })

  it('separates distinct brands and sorts by monthly estimate desc', () => {
    const groups = groupSubscriptions([
      tx({ id: '1', description: 'Spotify', amount: 59.99 }),
      tx({ id: '2', description: 'Netflix', amount: 199.99 }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].brand?.key).toBe('netflix') // higher monthly estimate first
    expect(groups[1].brand?.key).toBe('spotify')
  })

  it('normalizes foreign-currency monthly estimate to TRY', () => {
    const [g] = groupSubscriptions([
      tx({ description: 'OpenAI ChatGPT', currency: 'USD', amount: 20 }),
    ])
    expect(g.brand?.key).toBe('openai')
    expect(g.monthlyEstimateTry).toBe(690) // 20 USD × 34.5
  })
})

describe('subscriptions — findSubscriptionGroup', () => {
  const data = [
    tx({ id: '1', description: 'Netflix', amount: 199.99, date: '2026-07-05' }),
    tx({ id: '2', description: 'Netflix', amount: 149.99, date: '2026-06-05' }),
    tx({ id: '3', description: 'Spotify', amount: 59.99,  date: '2026-07-10' }),
  ]

  it('returns the group (with its txs) for a known key', () => {
    const g = findSubscriptionGroup(data, 'brand:netflix')
    expect(g).not.toBeNull()
    expect(g!.brand?.key).toBe('netflix')
    expect(g!.count).toBe(2)
    expect(g!.txs.map(t => t.id)).toEqual(['1', '2']) // newest first
  })

  it('returns null for an unknown key', () => {
    expect(findSubscriptionGroup(data, 'brand:disneyplus')).toBeNull()
    expect(findSubscriptionGroup([], 'brand:netflix')).toBeNull()
  })
})

describe('subscriptions — summarize', () => {
  const data = [
    tx({ id: '1', description: 'Netflix', amount: 199.99, date: '2026-07-05' }),
    tx({ id: '2', description: 'Spotify', amount: 59.99,  date: '2026-07-10' }),
    tx({ id: '3', description: 'Netflix', amount: 149.99, date: '2026-06-05' }), // prior month
    tx({ id: '4', description: 'Migros',  amount: 500,    date: '2026-07-08', tags: [] }), // not a subscription
  ]

  it('monthTotalTry counts only current-month subscription charges', () => {
    const s = summarize(data, { monthStr: '2026-07' })
    expect(s.monthTotalTry).toBe(259.98) // 199.99 + 59.99, June excluded, Migros excluded
  })

  it('serviceCount is the number of distinct brands/services', () => {
    const s = summarize(data, { monthStr: '2026-07' })
    expect(s.serviceCount).toBe(2)
  })

  it('monthlyEstimateTry sums each group latest charge', () => {
    const s = summarize(data, { monthStr: '2026-07' })
    expect(s.monthlyEstimateTry).toBe(259.98) // Netflix latest 199.99 + Spotify 59.99
  })

  it('empty ledger → zeros', () => {
    const s = summarize([], { monthStr: '2026-07' })
    expect(s.groups).toEqual([])
    expect(s.serviceCount).toBe(0)
    expect(s.monthTotalTry).toBe(0)
    expect(s.monthlyEstimateTry).toBe(0)
  })
})
