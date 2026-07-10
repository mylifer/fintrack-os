'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Transaction, TransactionFilters } from '@/types'
import { isInRange } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localBulkUpsert, localPatch, softDelete, reconcilingPull } from '@/lib/sync/engine'
import { toBaseTry, baseAmount } from '@/lib/utils/fx'

// Snapshot the base-currency (TRY) value at write time (S2/S3). Every creation
// path funnels through the store, so stamping here covers the form, refunds,
// reconciliation ghosts, investment-linked txs, recurring generation and import.
function withBase(tx: Transaction): Transaction {
  return { ...tx, amountTry: toBaseTry(tx.amount, tx.currency) }
}

function investRank(tx: Transaction): number {
  if (!tx.icon) return 10
  if (tx.description.includes('Alım')) return 0
  if (tx.description.includes('Kâr') || tx.description.includes('Zarar')) return 6
  return 5
}

function txSortComparator(a: Transaction, b: Transaction): number {
  const d = b.date.localeCompare(a.date)
  if (d !== 0) return d
  const ca = b.createdAt.localeCompare(a.createdAt)
  if (ca !== 0) return ca
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
    // Reconciling pull (C2) + pagination (C6): merge the full live cloud set
    // into Dexie without clobbering pending local writes; never truncate.
    try {
      const txs = (await reconcilingPull<Transaction>('transactions')).sort(txSortComparator)
      set({ transactions: txs, loading: false, ready: true })
    } catch (err) {
      console.error('[transactions:load]', err)
      const txs = (await db.transactions.toArray()).filter(isLive).sort(txSortComparator)
      set({ transactions: txs, loading: false, ready: true })
    }
  },

  add: async (tx) => {
    // Base-currency snapshot (S2/S3) + durable write (C1).
    const stamped = withBase(tx)
    await localUpsert('transactions', stamped)
    set(s => {
      const updated = [stamped, ...s.transactions]
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
      txs.push(withBase({ ...base, id: crypto.randomUUID(), isInstallment: true, installTotal: count, installIndex: i + 1, installGroupId: groupId, date, createdAt: now, updatedAt: now }))
    }
    await localBulkUpsert('transactions', txs)
    set(s => {
      const updated = [...txs, ...s.transactions]
      updated.sort(txSortComparator)
      useAccountStore.getState().recomputeBalances(updated)
      return { transactions: updated }
    })
  },

  update: async (id, patch) => {
    const now = new Date().toISOString()
    const updated: Partial<Transaction> = { ...patch, updatedAt: now }
    // Re-snapshot amountTry whenever amount or currency changes (S2/S3).
    if ('amount' in patch || 'currency' in patch) {
      const cur = get().transactions.find(t => t.id === id)
      if (cur) {
        const merged = { ...cur, ...patch }
        updated.amountTry = toBaseTry(merged.amount, merged.currency)
      }
    }
    await localPatch('transactions', id, updated as Record<string, unknown>)
    // NOT: Borç paidAmount mutabakatı burada YAPILMAZ — düzenleme akışının tek
    // sahibi TransactionFormModal'dır (borç değişimi/kaldırma dahil tüm dalları
    // yönetir). Burada da ayarlamak çift sayıma yol açıyordu.
    set(s => {
      const newTxs = s.transactions.map(t => t.id === id ? { ...t, ...updated } : t)
      useAccountStore.getState().recomputeBalances(newTxs)
      return { transactions: newTxs }
    })
  },

  remove: async (id) => {
    const tx = get().transactions.find(t => t.id === id)
    // Soft delete (C3) via the durable outbox: syncs as an UPDATE and cannot
    // resurrect on the next reconciling pull.
    await softDelete('transactions', id)
    // Revert this transaction's contribution to the linked debt: use the TRY
    // base value (debts are TRY) and revertPayment so paidInstallments is
    // decremented too (M3, M4).
    if (tx?.debtId) {
      await useDebtStore.getState().revertPayment(tx.debtId, baseAmount(tx))
    }
    set(s => {
      const remaining = s.transactions.filter(t => t.id !== id)
      useAccountStore.getState().recomputeBalances(remaining)
      return { transactions: remaining }
    })
  },

  getFiltered: (filters) => {
    let txs = get().transactions
    if (filters.accountIds?.length) txs = txs.filter(t => filters.accountIds!.includes(t.accountId))
    if (filters.categoryIds?.length) txs = txs.filter(t => t.categoryId && filters.categoryIds!.includes(t.categoryId))
    if (filters.types?.length) txs = txs.filter(t => filters.types!.includes(t.type))
    if (filters.familyMemberIds?.length) txs = txs.filter(t => t.familyMemberId && filters.familyMemberIds!.includes(t.familyMemberId))
    if (filters.recipientIds?.length) txs = txs.filter(t => t.recipientId && filters.recipientIds!.includes(t.recipientId))
    if (filters.dateFrom && filters.dateTo) txs = txs.filter(t => isInRange(t.date, filters.dateFrom!, filters.dateTo!))
    if (filters.search) {
      const q = filters.search.toLowerCase()
      txs = txs.filter(t => t.description.toLowerCase().includes(q) || t.merchant?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
    }
    return txs
  },
}))
