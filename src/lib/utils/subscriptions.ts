/* ────────────────────────────────────────────────────────────────────────
   Subscriptions — derived view over ACTIVE RECURRING EXPENSES

   A "subscription" is defined broadly as any active recurring transaction
   whose type is 'expense' (Netflix, kira, faturalar — all recurring
   commitments). This module is PURE and testable: no store imports, no DB.
   Amounts are normalized to base TRY via toBaseTry, and every frequency is
   projected onto a common monthly-equivalent scale so mixed cadences can be
   summed and compared.
──────────────────────────────────────────────────────────────────────── */

import type { RecurringTransaction, RecurringFrequency } from '@/types'
import { toBaseTry } from './fx'
import { sumBy, mulMoney } from './money'

/** Multiply factor to turn one period's cost into a monthly-equivalent cost.
 *  - daily:   average days per month  (365.25 / 12)
 *  - weekly:  average weeks per month (52.1429 / 12)
 *  - monthly: 1
 *  - yearly:  1/12
 */
export const MONTHLY_FACTOR: Record<RecurringFrequency, number> = {
  daily:   30.4375,
  weekly:  4.34524,
  monthly: 1,
  yearly:  1 / 12,
}

/** Monthly-equivalent cost of a recurring transaction, normalized to TRY. */
export function monthlyEquivalentTry(r: RecurringTransaction): number {
  const baseTry = toBaseTry(r.amount, r.currency)
  return mulMoney(baseTry, MONTHLY_FACTOR[r.frequency])
}

/** Sum of monthly-equivalent TRY across the given subscriptions. */
export function monthlyTotalTry(subs: readonly RecurringTransaction[]): number {
  return sumBy(subs, monthlyEquivalentTry)
}

/** Annualized total: 12 × the monthly-equivalent of each subscription. */
export function annualTotalTry(subs: readonly RecurringTransaction[]): number {
  return sumBy(subs, (r) => mulMoney(monthlyEquivalentTry(r), 12))
}

export interface SubscriptionsSummary {
  subs: RecurringTransaction[]
  monthlyTotal: number
  annualTotal: number
  count: number
}

/** Filter a recurring list down to active expenses and aggregate totals. */
export function summarize(recurring: readonly RecurringTransaction[]): SubscriptionsSummary {
  const subs = recurring.filter((r) => r.isActive && r.type === 'expense')
  return {
    subs,
    monthlyTotal: monthlyTotalTry(subs),
    annualTotal:  annualTotalTry(subs),
    count:        subs.length,
  }
}
