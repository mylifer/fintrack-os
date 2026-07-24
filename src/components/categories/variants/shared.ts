'use client'

import { useMemo } from 'react'
import { useCategoryStore, useTransactionStore } from '@/store'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { isFlowTx, sumByType } from '@/lib/utils/calculations'
import { subMoney } from '@/lib/utils/money'
import type { Category, CategoryScope } from '@/types'

/* ── Per-category aggregate stats ──────────────────────────────────── */
export interface CatStat {
  /** tx count over the category + all descendants (flow-only) */
  txCount: number
  /** net (income − expense) over descendants, TRY-normalized (matches detail page) */
  net: number
  /** absolute expense magnitude over descendants — used for share bars */
  expense: number
  /** direct active-child count */
  childCount: number
  /** nesting level 0 | 1 | 2 */
  level: 0 | 1 | 2
}

export interface CategoryData {
  scope: CategoryScope
  /** active root categories of the scope, name-sorted */
  roots: Category[]
  /** active direct children of a category, name-sorted */
  childrenOf: (id: string) => Category[]
  /** aggregate stats keyed by category id */
  stats: Map<string, CatStat>
  /** largest sibling expense at each parent — for relative share bars */
  maxExpenseAtRoot: number
  /** total categories in scope (active roots count for the tab badge) */
  rootCount: (scope: CategoryScope) => number
}

/**
 * Shared read-model for the category views. Pure display data — no mutation.
 * Totals follow the same flow convention as the category detail page
 * (isFlowTx + sumByType over the full descendant subtree).
 */
export function useCategoryData(scope: CategoryScope): CategoryData {
  const categories   = useCategoryStore(s => s.categories)
  const transactions = useTransactionStore(s => s.transactions)

  return useMemo(() => {
    const active = categories.filter(c => c.scope === scope && !c.isArchived)

    // parent → children (active), name-sorted
    const childMap = new Map<string, Category[]>()
    for (const c of active) {
      const key = c.parentId ?? '__root__'
      if (!childMap.has(key)) childMap.set(key, [])
      childMap.get(key)!.push(c)
    }
    for (const list of childMap.values()) list.sort(compareCategoriesByName)

    const childrenOf = (id: string) => childMap.get(id) ?? []
    const roots = (childMap.get('__root__') ?? [])

    // descendant id sets (includes self), memoized bottom-up
    const descCache = new Map<string, Set<string>>()
    const descendants = (id: string): Set<string> => {
      const hit = descCache.get(id)
      if (hit) return hit
      const set = new Set<string>([id])
      for (const ch of childrenOf(id)) for (const d of descendants(ch.id)) set.add(d)
      descCache.set(id, set)
      return set
    }

    // level lookup within scope
    const byId = new Map(categories.map(c => [c.id, c]))
    const levelOf = (id: string): 0 | 1 | 2 => {
      const c = byId.get(id)
      if (!c?.parentId) return 0
      const p = byId.get(c.parentId)
      return p?.parentId ? 2 : 1
    }

    // flow transactions bucketed by category id
    const flow = transactions.filter(t => t.categoryId && isFlowTx(t))
    const byCat = new Map<string, typeof flow>()
    for (const t of flow) {
      const arr = byCat.get(t.categoryId!) ?? []
      arr.push(t)
      byCat.set(t.categoryId!, arr)
    }

    const stats = new Map<string, CatStat>()
    for (const c of active) {
      const ids = descendants(c.id)
      const txs = flow.filter(t => ids.has(t.categoryId!))
      const { income, expense } = sumByType(txs)
      stats.set(c.id, {
        txCount:    txs.length,
        net:        subMoney(income, expense),
        expense,
        childCount: childrenOf(c.id).length,
        level:      levelOf(c.id),
      })
    }

    const maxExpenseAtRoot = roots.reduce((m, r) => Math.max(m, stats.get(r.id)?.expense ?? 0), 0)

    const rootCount = (s: CategoryScope) =>
      categories.filter(c => c.scope === s && !c.parentId && !c.isArchived).length

    return { scope, roots, childrenOf, stats, maxExpenseAtRoot, rootCount }
  }, [categories, transactions, scope])
}

/* ── Shared formatting ─────────────────────────────────────────────── */
export const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }
