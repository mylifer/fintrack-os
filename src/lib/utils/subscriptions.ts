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
