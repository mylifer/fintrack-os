'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase, nullifyUndefined } from '@/lib/supabase'
import type { Transaction, TransactionFilters } from '@/types'
import { isInRange } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { getUserId } from '@/lib/auth'
import { softDelete, isLive } from '@/lib/sync/tombstone'

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
    // Tombstones (C3): never fetch or surface soft-deleted rows.
    const { data, error } = await supabase.from('transactions').select('*').is('deleted_at', null)
    if (!error) {
      const txs = ((data ?? []) as Transaction[]).sort(txSortComparator)
      await db.transaction('rw', db.transactions, async () => {
        await db.transactions.clear()
        await db.transactions.bulkAdd(txs)
      })
      set({ transactions: txs, loading: false, ready: true })
    } else {
      console.error('[supabase:transactions:load]', error)
      const txs = (await db.transactions.toArray()).filter(isLive).sort(txSortComparator)
      set({ transactions: txs, loading: false, ready: true })
    }
  },

  add: async (tx) => {
    await db.transactions.add(tx)
    const userId = await getUserId()
    supabase.from('transactions').insert({ ...tx, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:transactions:insert]', error)
    })
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
      txs.push({ ...base, id: crypto.randomUUID(), isInstallment: true, installTotal: count, installIndex: i + 1, installGroupId: groupId, date, createdAt: now, updatedAt: now })
    }
    await db.transactions.bulkAdd(txs)
    const userId = await getUserId()
    const txsForDb = userId ? txs.map(t => ({ ...t, user_id: userId })) : txs
    supabase.from('transactions').insert(txsForDb).then(({ error }) => {
      if (error) console.error('[supabase:transactions:insert-installments]', error)
    })
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
    supabase.from('transactions').update(nullifyUndefined(updated)).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:transactions:update]', error)
    })
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
    // Soft delete (C3): tombstone instead of physical delete so the removal
    // syncs as an UPDATE and cannot resurrect on the next cloud-authoritative load.
    await softDelete(db.transactions, 'transactions', id)
    // Revert this transaction's contribution to the linked debt's paidAmount
    if (tx?.debtId) {
      await useDebtStore.getState().adjustPaidAmount(tx.debtId, -tx.amount)
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
