import type { Transaction } from '@/types'
import { tagKey } from './tags'

/* ────────────────────────────────────────────────────────────────────────
   Balance Reconciliation ("Bakiye Eşitleme") — ghost transactions

   A reconciliation entry is a real ledger transaction (so it DOES move the
   account's raw balance) that exists purely to close the gap between the
   app-calculated balance and the user's actual bank balance. It is stamped
   with a canonical tag so every income/expense *analytic* can exclude it —
   these entries must never inflate totals, averages, top categories, or tag
   volumes. This module is the single source of truth for that marker.
──────────────────────────────────────────────────────────────────────── */

/** Canonical tag stamped on every reconciliation transaction. */
export const RECONCILE_TAG = '#BakiyeEşitleme'

/** Description stamped on every reconciliation transaction. */
export const RECONCILE_DESCRIPTION = 'Sistem: Bakiye Eşitleme'

// Case-insensitive key so the predicate survives any casing drift.
const RECONCILE_KEY = tagKey(RECONCILE_TAG)

/** True if a transaction is a system balance-reconciliation ("ghost") entry.
 *  Analytics builders call this to exclude reconciliation from every
 *  income/expense aggregate while leaving raw balance math untouched.
 *
 *  Authoritative source is the `systemKind` field (S7). The tag check is kept
 *  only as a fallback for legacy rows created before the field existed. */
export function isReconciliation(tx: Pick<Transaction, 'tags' | 'systemKind'>): boolean {
  if (tx.systemKind === 'reconciliation') return true
  return !!tx.tags?.some(t => tagKey(t) === RECONCILE_KEY)
}
