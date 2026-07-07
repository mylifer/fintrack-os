'use client'

import { useMemo } from 'react'
import { useTransactionStore } from '@/store'
import { aggregateTags, type TagAggregate } from '@/lib/utils/tags'

/**
 * Derived selector: aggregates every unique tag currently used across all
 * transactions. Recomputes automatically whenever the transaction list changes,
 * so deleting the last transaction of a tag drops it from the result with no
 * extra bookkeeping.
 */
export function useTags(): TagAggregate[] {
  const transactions = useTransactionStore(s => s.transactions)
  return useMemo(() => aggregateTags(transactions), [transactions])
}

export type { TagAggregate }
