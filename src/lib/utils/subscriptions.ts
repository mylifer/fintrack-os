/* ────────────────────────────────────────────────────────────────────────
   Subscriptions — derived view over TAGGED EXPENSE TRANSACTIONS

   A "subscription" is any expense the user explicitly marked with the reserved
   `abonelik` tag (SUBSCRIPTION_TAG). We no longer infer subscriptions from
   recurring transactions — the source of truth is the tag on the transaction.

   Transactions are grouped by detected brand (Netflix, Spotify, …) so repeated
   charges to the same service collapse into a single row. This module is PURE
   and testable: no store imports, no DB. Amounts normalize to base TRY via the
   fx helpers, and money is summed with the kuruş-exact `sumBy` (never bare +).
──────────────────────────────────────────────────────────────────────── */

import type { Transaction, CurrencyCode } from '@/types'
import { baseAmount, toBaseTry } from './fx'
import { sumBy } from './money'
import { today } from './date'
import {
  detectBrand, hasSubscriptionTag, normalize, type Brand,
} from '@/lib/subscriptions/brands'

/** A tagged expense is a subscription charge. */
export function isSubscriptionTx(tx: Transaction): boolean {
  return tx.type === 'expense' && hasSubscriptionTag(tx.tags)
}

export interface SubscriptionGroup {
  key: string
  brand: Brand | null
  name: string
  currency: CurrencyCode
  latestAmount: number       // raw amount of the most recent charge (in `currency`)
  lastDate: string           // ISO date of the most recent charge
  count: number              // number of charges in the group
  totalTry: number           // sum of all charges, normalized to TRY
  monthlyEstimateTry: number // latest charge treated as the monthly price, in TRY
  txs: Transaction[]
}

/** Detect the brand + grouping key for a single subscription charge. Charges
 *  that resolve to the same brand collapse together; unrecognized ones group
 *  by their normalized description. */
function resolve(tx: Transaction): { key: string; brand: Brand | null } {
  const brand = detectBrand(tx.description, tx.notes, tx.merchant)
  if (brand) return { key: `brand:${brand.key}`, brand }
  const norm = normalize(tx.description) || 'diger'
  return { key: `desc:${norm}`, brand: null }
}

/** Most-recent-first: by date, then by createdAt as a tie-breaker. */
function newerFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
}

/** Group subscription charges by brand (or description), sorted by monthly
 *  estimate descending. */
export function groupSubscriptions(transactions: readonly Transaction[]): SubscriptionGroup[] {
  const buckets = new Map<string, { brand: Brand | null; txs: Transaction[] }>()

  for (const tx of transactions) {
    if (!isSubscriptionTx(tx)) continue
    const { key, brand } = resolve(tx)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.txs.push(tx)
      if (brand && !bucket.brand) bucket.brand = brand
    } else {
      buckets.set(key, { brand, txs: [tx] })
    }
  }

  const groups: SubscriptionGroup[] = []
  for (const [key, { brand, txs }] of buckets) {
    const ordered = [...txs].sort(newerFirst)
    const latest = ordered[0]
    groups.push({
      key,
      brand,
      name: brand?.name ?? (latest.description.trim() || 'Abonelik'),
      currency: latest.currency,
      latestAmount: latest.amount,
      lastDate: latest.date,
      count: ordered.length,
      totalTry: sumBy(ordered, baseAmount),
      monthlyEstimateTry: toBaseTry(latest.amount, latest.currency),
      txs: ordered,
    })
  }

  return groups.sort((a, b) => b.monthlyEstimateTry - a.monthlyEstimateTry)
}

/** Recompute the subscription groups and return the one matching `key`
 *  (see `groupSubscriptions` for the key format), or null when none match.
 *  Pure — used by the detail route to resolve a group from a URL segment. */
export function findSubscriptionGroup(
  transactions: readonly Transaction[],
  key: string,
): SubscriptionGroup | null {
  return groupSubscriptions(transactions).find(g => g.key === key) ?? null
}

export interface SubscriptionsSummary {
  groups: SubscriptionGroup[]
  serviceCount: number
  monthTotalTry: number
  monthlyEstimateTry: number
}

/** Aggregate the subscription view. `monthStr` (YYYY-MM) is injectable so
 *  callers/tests aren't clock-dependent; it defaults to the current month. */
export function summarize(
  transactions: readonly Transaction[],
  opts?: { monthStr?: string },
): SubscriptionsSummary {
  const groups = groupSubscriptions(transactions)
  const monthStr = opts?.monthStr ?? today().slice(0, 7)

  const monthCharges = transactions.filter(
    tx => isSubscriptionTx(tx) && tx.date.slice(0, 7) === monthStr,
  )

  return {
    groups,
    serviceCount: groups.length,
    monthTotalTry: sumBy(monthCharges, baseAmount),
    monthlyEstimateTry: sumBy(groups, g => g.monthlyEstimateTry),
  }
}

/* ── Monthly history ─────────────────────────────────────────────────── */

export interface SubscriptionMonthService {
  key: string                // same key as the SubscriptionGroup (detail link)
  brand: Brand | null
  name: string
  count: number              // charges to this service in the month
  totalTry: number
}

export interface SubscriptionMonth {
  month: string                        // YYYY-MM
  totalTry: number
  count: number
  services: SubscriptionMonthService[] // highest spend first
}

/** Shift a YYYY-MM month string by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Subscription spend per calendar month, oldest first, ending at `endMonth`
 *  (YYYY-MM, defaults to the current month). `months` is the window length
 *  (zero-filled) or 'all' to start at the earliest charge. Charges dated after
 *  `endMonth` are left out. Month buckets use the same `date.slice(0, 7)` rule
 *  as `summarize`, so the current month's total equals `monthTotalTry`; services
 *  carry the group key/name from `groupSubscriptions` so they link to details. */
export function subscriptionMonthlyHistory(
  transactions: readonly Transaction[],
  opts?: { months?: number | 'all'; endMonth?: string },
): SubscriptionMonth[] {
  const endMonth = opts?.endMonth ?? today().slice(0, 7)
  const range = opts?.months ?? 12
  const groups = groupSubscriptions(transactions)

  // month → group key → charges
  const buckets = new Map<string, Map<string, Transaction[]>>()
  let earliest: string | null = null
  for (const g of groups) {
    for (const tx of g.txs) {
      const month = tx.date.slice(0, 7)
      if (month > endMonth) continue
      if (!earliest || month < earliest) earliest = month
      let byGroup = buckets.get(month)
      if (!byGroup) buckets.set(month, byGroup = new Map())
      const list = byGroup.get(g.key)
      if (list) list.push(tx)
      else byGroup.set(g.key, [tx])
    }
  }

  let startMonth: string
  if (range === 'all') {
    if (!earliest) return []
    startMonth = earliest
  } else {
    startMonth = shiftMonth(endMonth, -(Math.max(1, range) - 1))
  }

  const groupByKey = new Map(groups.map(g => [g.key, g]))
  const history: SubscriptionMonth[] = []
  for (let month = startMonth; month <= endMonth; month = shiftMonth(month, 1)) {
    const services: SubscriptionMonthService[] = []
    for (const [key, txs] of buckets.get(month) ?? []) {
      const g = groupByKey.get(key)!
      services.push({ key, brand: g.brand, name: g.name, count: txs.length, totalTry: sumBy(txs, baseAmount) })
    }
    services.sort((a, b) => b.totalTry - a.totalTry || a.name.localeCompare(b.name, 'tr'))
    history.push({
      month,
      totalTry: sumBy(services, s => s.totalTry),
      count: services.reduce((n, s) => n + s.count, 0),
      services,
    })
  }
  return history
}
