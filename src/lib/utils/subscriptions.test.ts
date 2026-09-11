import { describe, it, expect, beforeAll } from 'vitest'
import type { PriceData, Transaction } from '@/types'
import { setBaseRates } from './fx'
import {
  isSubscriptionTx, groupSubscriptions, summarize, findSubscriptionGroup, subscriptionMonthlyHistory,
} from './subscriptions'
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

describe('subscriptions — subscriptionMonthlyHistory', () => {
  const data = [
    tx({ id: '1', description: 'Netflix', amount: 199.99, date: '2026-07-05' }),
    tx({ id: '2', description: 'Spotify', amount: 59.99,  date: '2026-07-10' }),
    tx({ id: '3', description: 'Netflix', amount: 149.99, date: '2026-05-05' }),
    tx({ id: '4', description: 'OpenAI',  amount: 20, currency: 'USD', date: '2026-05-20' }),
    tx({ id: '5', description: 'Migros',  amount: 500,    date: '2026-07-08', tags: [] }), // not a subscription
    tx({ id: '6', description: 'Netflix', amount: 199.99, date: '2026-08-05' }),           // after endMonth
    tx({ id: '7', description: 'Netflix', amount: 99,     date: '2025-12-05' }),           // before a short window
  ]

  it('zero-fills a fixed window, oldest first', () => {
    const h = subscriptionMonthlyHistory(data, { months: 3, endMonth: '2026-07' })
    expect(h.map(m => m.month)).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(h[1]).toEqual({ month: '2026-06', totalTry: 0, count: 0, services: [] })
  })

  it('sums each month in TRY and sorts services by spend', () => {
    const [may, , jul] = subscriptionMonthlyHistory(data, { months: 3, endMonth: '2026-07' })
    expect(may.totalTry).toBe(839.99) // 149.99 + 20 USD × 34.5
    expect(may.count).toBe(2)
    expect(may.services.map(s => s.key)).toEqual(['brand:openai', 'brand:netflix'])
    expect(jul.totalTry).toBe(259.98) // Migros excluded
    expect(jul.services.map(s => s.name)).toEqual(['Netflix', 'Spotify'])
  })

  it('current month matches summarize().monthTotalTry', () => {
    const h = subscriptionMonthlyHistory(data, { months: 12, endMonth: '2026-07' })
    expect(h.at(-1)!.totalTry).toBe(summarize(data, { monthStr: '2026-07' }).monthTotalTry)
  })

  it('service keys link to the subscription groups', () => {
    const keys = new Set(groupSubscriptions(data).map(g => g.key))
    for (const m of subscriptionMonthlyHistory(data, { months: 'all', endMonth: '2026-07' })) {
      for (const s of m.services) expect(keys.has(s.key)).toBe(true)
    }
  })

  it('crosses the year boundary', () => {
    const h = subscriptionMonthlyHistory(data, { months: 3, endMonth: '2026-01' })
    expect(h.map(m => m.month)).toEqual(['2025-11', '2025-12', '2026-01'])
    expect(h[1].totalTry).toBe(99)
  })

  it("'all' starts at the earliest charge and excludes later months", () => {
    const h = subscriptionMonthlyHistory(data, { months: 'all', endMonth: '2026-07' })
    expect(h[0].month).toBe('2025-12')
    expect(h.at(-1)!.month).toBe('2026-07')
    expect(h).toHaveLength(8)
    expect(h.some(m => m.month === '2026-08')).toBe(false)
  })

  it('buckets legacy full ISO datetimes by their month', () => {
    const [m] = subscriptionMonthlyHistory(
      [tx({ date: '2026-07-31T23:30:00.000Z', amount: 50 })],
      { months: 1, endMonth: '2026-07' },
    )
    expect(m.totalTry).toBe(50)
  })

  it("'all' with no charges → empty", () => {
    expect(subscriptionMonthlyHistory([], { months: 'all', endMonth: '2026-07' })).toEqual([])
  })
})
