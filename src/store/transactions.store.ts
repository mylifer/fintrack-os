'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Transaction, TransactionFilters } from '@/types'
import { isInRange } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localBulkUpsert, localPatch, softDelete, reconcilingPull } from '@/lib/sync/engine'
import { toBaseTry, baseAmount, rateFor } from '@/lib/utils/fx'

// Snapshot the base-currency (TRY) value at write time (S2/S3). Every creation
// path funnels through the store, so stamping here covers the form, refunds,
// reconciliation ghosts, investment-linked txs and recurring generation.
// If the FX rate isn't available yet (foreign tx created before prices load),
// leave amountTry UNSET rather than stamping a wrong raw value — baseAmount()
// then converts it live once rates arrive (L3). TRY always has a rate (1).
function withBase(tx: Transaction): Transaction {
  if (rateFor(tx.currency) == null) return tx
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
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
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
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = [stamped, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
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
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = [...txs, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
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
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = get().transactions.map(t => t.id === id ? { ...t, ...updated } : t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  remove: async (id, opts) => {
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
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const remaining = get().transactions.filter(t => t.id !== id)
    set({ transactions: remaining })
    useAccountStore.getState().recomputeBalances(remaining)

    // Undo: un-tombstone, re-insert (sorted), recompute, and re-apply the debt
    // payment — symmetric with the revertPayment above (recordPayment +amount,
    // +1 installment ↔ revertPayment -amount, -1 installment).
    if (tx && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('İşlem silindi', async () => {
        await localPatch('transactions', id, { deleted_at: null })
        const next = [tx, ...get().transactions]
        next.sort(txSortComparator)
        set({ transactions: next })
        useAccountStore.getState().recomputeBalances(next)
        if (tx.debtId) {
          await useDebtStore.getState().recordPayment(tx.debtId, baseAmount(tx))
        }
      })
    }
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
