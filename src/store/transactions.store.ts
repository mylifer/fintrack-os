'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Transaction, TransactionFilters } from '@/types'
import { isInRange } from '@/lib/utils/date'
import { addMonths, format } from 'date-fns'
import { parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'

function investRank(tx: Transaction): number {
  if (!tx.icon) return 10
  if (tx.description.includes('Alım')) return 0
  if (tx.description.includes('Kâr') || tx.description.includes('Zarar')) return 6
  return 5
}

function txSortComparator(a: Transaction, b: Transaction): number {
  // Primary: date DESC
  const d = b.date.localeCompare(a.date)
  if (d !== 0) return d
  // Secondary: createdAt DESC — newer additions float to top regardless of type
  const ca = b.createdAt.localeCompare(a.createdAt)
  if (ca !== 0) return ca
  // Tie-break (same timestamp, e.g. sell + P&L created together): investRank ASC
  return investRank(a) - investRank(b)
}

interface TransactionState {
  transactions: Transaction[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (tx: Transaction) => Promise<void>
  addInstallmentGroup: (
    base: Omit<Transaction, 'id' | 'installIndex' | 'installGroupId' | 'createdAt' | 'updatedAt'>,
    count: number,
  ) => Promise<void>
  update: (id: string, patch: Partial<Transaction>) => Promise<void>
  remove: (id: string) => Promise<void>
  getFiltered: (filters: TransactionFilters) => Transaction[]
}

export const useTransactionStore = create<TransactionState>()((set, get) => ({
  transactions: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const txs = await db.transactions.toArray()
    txs.sort(txSortComparator)
    set({ transactions: txs, loading: false, ready: true })
  },

  add: async (tx) => {
    await db.transactions.add(tx)
    set(s => {
      const updated = [tx, ...s.transactions]
      updated.sort(txSortComparator)
      useAccountStore.getState().recomputeBalances(updated)
      return { transactions: updated }
    })
  },

  addInstallmentGroup: async (base, count) => {
    const groupId = crypto.randomUUID()
    const now = new Date().toISOString()
    const txs: Transaction[] = []

    for (let i = 0; i < count; i++) {
      const date = format(addMonths(parseISO(base.date), i), 'yyyy-MM-dd')
      txs.push({
        ...base,
        id: crypto.randomUUID(),
        isInstallment: true,
        installTotal: count,
        installIndex: i + 1,
        installGroupId: groupId,
        date,
        createdAt: now,
        updatedAt: now,
      })
    }

    await db.transactions.bulkAdd(txs)
    set(s => {
      const updated = [...txs, ...s.transactions]
      updated.sort(txSortComparator)
      useAccountStore.getState().recomputeBalances(updated)
      return { transactions: updated }
    })
  },

  update: async (id, patch) => {
    const now = new Date().toISOString()
    const updated = { ...patch, updatedAt: now }
    await db.transactions.update(id, updated)
    set(s => {
      const newTxs = s.transactions.map(t => t.id === id ? { ...t, ...updated } : t)
      useAccountStore.getState().recomputeBalances(newTxs)
      return { transactions: newTxs }
    })
  },

  remove: async (id) => {
    await db.transactions.delete(id)
    set(s => {
      const remaining = s.transactions.filter(t => t.id !== id)
      useAccountStore.getState().recomputeBalances(remaining)
      return { transactions: remaining }
    })
  },

  getFiltered: (filters) => {
    let txs = get().transactions

    if (filters.accountIds?.length)
      txs = txs.filter(t => filters.accountIds!.includes(t.accountId))
    if (filters.categoryIds?.length)
      txs = txs.filter(t => t.categoryId && filters.categoryIds!.includes(t.categoryId))
    if (filters.types?.length)
      txs = txs.filter(t => filters.types!.includes(t.type))
    if (filters.dateFrom && filters.dateTo)
      txs = txs.filter(t => isInRange(t.date, filters.dateFrom!, filters.dateTo!))
    if (filters.search) {
      const q = filters.search.toLowerCase()
      txs = txs.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.merchant?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q),
      )
    }
    if (filters.familyMemberIds?.length)
      txs = txs.filter(t => t.familyMemberId && filters.familyMemberIds!.includes(t.familyMemberId))
    if (filters.recipientIds?.length)
      txs = txs.filter(t => t.recipientId && filters.recipientIds!.includes(t.recipientId))

    return txs
  },
}))
