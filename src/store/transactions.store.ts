'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Transaction, TransactionFilters } from '@/types'
import { isInRange, today } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { usePeopleStore } from './people.store'
import { useCategoryStore } from './categories.store'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localBulkUpsert, localPatch, softDelete, reconcilingPull, localBatch, type BatchOp } from '@/lib/sync/engine'
import { toBaseTry, baseAmount, rateFor } from '@/lib/utils/fx'
import { splitMoney } from '@/lib/utils/money'

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

// Onay kapısı (bildirim merkezi): gelecek tarihli YENİ işlemler 'pending' doğar —
// tarihi gelince otomatik post olmaz, bildirim merkezinde onay bekler. Çağıran
// approvalStatus'u açıkça verdiyse (örn. tekrarlayan üretimi 'approved' yazar)
// dokunulmaz. Mevcut satırlar bu yoldan geçmez; null/undefined = legacy davranış.
function withApproval(tx: Transaction): Transaction {
  if (tx.approvalStatus !== undefined) return tx
  if (tx.date.slice(0, 10) > today()) return { ...tx, approvalStatus: 'pending' }
  return tx
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
    amounts?: number[],
  ) => Promise<void>
  update: (id: string, patch: Partial<Transaction>) => Promise<void>
  updateMany: (
    ids: string[],
    patch: Partial<Transaction>,
    opts?: { addTags?: string[] },
  ) => Promise<void>
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
    // Base-currency snapshot (S2/S3) + onay kapısı + durable write (C1).
    const stamped = withApproval(withBase(tx))
    await localUpsert('transactions', stamped)
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = [stamped, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  addInstallmentGroup: async (base, count, amounts) => {
    const groupId = crypto.randomUUID()
    const now = new Date().toISOString()
    const txs: Transaction[] = []
    // base.amount toplam satın alma tutarı; her işlem AYLIK taksit tutarını
    // taşır. Kullanıcı elle tutar girdiyse (amounts) onlar kullanılır; yoksa
    // splitMoney kuruş kalanını ilk taksitlere dağıtır, toplam korunur.
    const perInstallment = amounts?.length === count ? amounts : splitMoney(base.amount, count)
    for (let i = 0; i < count; i++) {
      const date = format(addMonths(parseISO(base.date), i), 'yyyy-MM-dd')
      // Gelecek aylara düşen taksitler de onay kapısından geçer (pending doğar).
      txs.push(withApproval(withBase({ ...base, amount: perInstallment[i], id: crypto.randomUUID(), isInstallment: true, installTotal: count, installIndex: i + 1, installGroupId: groupId, date, createdAt: now, updatedAt: now })))
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

  // Toplu düzenleme (batch edit). Yalnızca mutabakat GEREKTİRMEYEN alanlar için
  // kullanılır — kategori, tarih, aile üyesi, alıcı, etiket. `amount`/`type`/
  // `debtId` GİBİ borç-taksit mutabakatını tetikleyen alanlar burada DÜZENLENMEZ;
  // o akışın tek sahibi TransactionFormModal'dır (bkz. update yorumu). addTags
  // verilirse etiketler satır-satır BİRLEŞTİRİLİR (mevcut etiketler korunur).
  // Tüm satırlar tek bir atomik localBatch içinde yazılır ve değişiklik geri
  // alınabilir (her satırın eski değerleri snapshot'lanır).
  updateMany: async (ids, patch, opts) => {
    const now = new Date().toISOString()
    const before = get().transactions
    const txById = new Map(before.map(t => [t.id, t]))
    const affected = ids.filter(id => txById.has(id))
    if (affected.length === 0) return

    const addTags = (opts?.addTags ?? []).map(t => t.trim()).filter(Boolean)
    const keys = Object.keys(patch) as (keyof Transaction)[]

    type PatchOp = Extract<BatchOp, { kind: 'patch' }>
    const forward: PatchOp[] = []
    const undoOps: PatchOp[] = []
    for (const id of affected) {
      const t = txById.get(id)!
      const fwd: Record<string, unknown> = { ...patch, updatedAt: now }
      const rev: Record<string, unknown> = { updatedAt: t.updatedAt }
      for (const k of keys) rev[k] = (t as unknown as Record<string, unknown>)[k] ?? null
      if (addTags.length) {
        fwd.tags = [...new Set([...(t.tags ?? []), ...addTags])]
        rev.tags = t.tags ? [...t.tags] : null
      }
      forward.push({ kind: 'patch', table: 'transactions', id, patch: fwd })
      undoOps.push({ kind: 'patch', table: 'transactions', id, patch: rev })
    }

    await localBatch(forward)

    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const fwdById = new Map(forward.map(o => [o.id, o.patch]))
    const next = get().transactions.map(t => fwdById.has(t.id) ? { ...t, ...fwdById.get(t.id) } : t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    const label = affected.length > 1 ? `${affected.length} işlem düzenlendi` : 'İşlem düzenlendi'
    useUndoStore.getState().pushUndo(label, async () => {
      await localBatch(undoOps)
      const revById = new Map(undoOps.map(o => [o.id, o.patch]))
      const reverted = get().transactions.map(t => revById.has(t.id) ? { ...t, ...revById.get(t.id) } : t)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
  },

  remove: async (id, opts) => {
    const all = get().transactions
    const tx = all.find(t => t.id === id)
    // Taksitli işlem: tek taksit yalnız silinmez — satın almanın TÜM taksitleri
    // (aynı installGroupId) birlikte silinir ve undo hepsini birlikte geri getirir.
    const group = tx?.installGroupId
      ? all.filter(t => t.installGroupId === tx.installGroupId)
      : tx ? [tx] : []
    // Soft delete (C3) via the durable outbox: syncs as an UPDATE and cannot
    // resurrect on the next reconciling pull.
    for (const t of group) {
      await softDelete('transactions', t.id)
      // Revert this transaction's contribution to the linked debt: use the TRY
      // base value (debts are TRY) and revertPayment so paidInstallments is
      // decremented too (M3, M4).
      if (t.debtId) {
        await useDebtStore.getState().revertPayment(t.debtId, baseAmount(t))
      }
    }
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const removedIds = new Set(group.map(t => t.id))
    const remaining = get().transactions.filter(t => !removedIds.has(t.id))
    set({ transactions: remaining })
    useAccountStore.getState().recomputeBalances(remaining)

    // Undo: un-tombstone, re-insert (sorted), recompute, and re-apply the debt
    // payment — symmetric with the revertPayment above (recordPayment +amount,
    // +1 installment ↔ revertPayment -amount, -1 installment).
    if (group.length && opts?.undoable !== false) {
      const label = group.length > 1 ? `Taksitli işlem silindi (${group.length} taksit)` : 'İşlem silindi'
      useUndoStore.getState().pushUndo(label, async () => {
        for (const t of group) {
          await localPatch('transactions', t.id, { deleted_at: null })
          if (t.debtId) {
            await useDebtStore.getState().recordPayment(t.debtId, baseAmount(t))
          }
        }
        const next = [...group, ...get().transactions]
        next.sort(txSortComparator)
        set({ transactions: next })
        useAccountStore.getState().recomputeBalances(next)
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
      // Tüm alanlarda arama — kişi/kategori/hesap adları dahil (bkz. txSearch.ts)
      txs = txs.filter(makeTxSearchMatcher(filters.search, {
        people:     usePeopleStore.getState().people,
        categories: useCategoryStore.getState().categories,
        accounts:   useAccountStore.getState().accounts,
      }))
    }
    return txs
  },
}))
