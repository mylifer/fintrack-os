'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { PaymentOccurrence, PaymentPlan, PaymentTargetKind } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localBatch, localPatch, localUpsert, softDelete, type BatchOp } from '@/lib/sync/engine'
import { rowInActiveWorkspace } from '@/lib/workspace-context'
import { occurrenceIdFor, planIdFor } from '@/lib/payments/ids'
import { loadEntities } from './entity-helpers'

/* Ödeme takibi store'u — yalnızca kullanıcının DEĞİŞTİRDİĞİ şeyleri tutar:
   hedef başına plan ve ay başına kayıt. Satırların kendisi her render'da
   lib/payments/schedule.ts ile türetilir. Kimlikler deterministik olduğundan
   "var mı? yoksa oluştur" akışı iki sekmede yarışsa bile tek satıra düşer. */

export type PlanPatch = Partial<Omit<PaymentPlan, 'id' | 'targetKind' | 'targetId' | 'createdAt' | 'updatedAt'>>
export type OccurrencePatch = Partial<Omit<PaymentOccurrence, 'id' | 'targetKind' | 'targetId' | 'month' | 'createdAt' | 'updatedAt'>>

export interface OccurrenceWrite {
  kind: PaymentTargetKind
  targetId: string
  month: string
  patch: OccurrencePatch
}

// Engine yama anahtarlarındaki undefined'ı null yazar (nullifyPatch); bellekteki
// kopya da aynı değeri taşısın ki bir sonraki yükleme ekranda sıçrama yapmasın.
function nullify<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v
  return out as T
}

interface PaymentsState {
  plans: PaymentPlan[]
  occurrences: PaymentOccurrence[]
  ready: boolean
  load: () => Promise<void>
  /** Hedefin planını oluşturur ya da yamalar. Yalnız verilen anahtarlar yazılır. */
  savePlan: (kind: PaymentTargetKind, targetId: string, patch: PlanPatch) => Promise<void>
  /** Bir ayın kaydını oluşturur ya da yamalar. */
  saveOccurrence: (kind: PaymentTargetKind, targetId: string, month: string, patch: OccurrencePatch) => Promise<void>
  /** Çok aylık yazma — tek IndexedDB işleminde, ya hep ya hiç. */
  saveOccurrences: (writes: OccurrenceWrite[]) => Promise<void>
  /** Ayın kaydını siler (tombstone) — ay yeniden plandan türetilir. */
  resetOccurrence: (kind: PaymentTargetKind, targetId: string, month: string) => Promise<void>
}

export const usePaymentsStore = create<PaymentsState>()((set, get) => ({
  plans: [],
  occurrences: [],
  ready: false,

  load: async () => {
    const [plans, occurrences] = await Promise.all([
      loadEntities<PaymentPlan>(
        'payment_plans', 'payment-plans',
        async () => (await db.paymentPlans.toArray()).filter(isLive).filter(rowInActiveWorkspace),
      ),
      loadEntities<PaymentOccurrence>(
        'payment_occurrences', 'payment-occurrences',
        async () => (await db.paymentOccurrences.toArray()).filter(isLive).filter(rowInActiveWorkspace),
      ),
    ])
    set({ plans, occurrences, ready: true })
  },

  savePlan: async (kind, targetId, patch) => {
    const id = planIdFor(kind, targetId)
    const now = new Date().toISOString()
    const existing = get().plans.find(p => p.id === id)
    if (existing) {
      const full = nullify({ ...patch, updatedAt: now })
      await localPatch('payment_plans', id, full as Record<string, unknown>)
      set(s => ({ plans: s.plans.map(p => (p.id === id ? { ...p, ...full } : p)) }))
      return
    }
    // Daha önce tombstone'lanmış aynı kimlik varsa upsert onu canlandırır
    // (snapshot deleted_at: null taşır — bkz. engine toSnapshot).
    const plan: PaymentPlan = {
      id, targetKind: kind, targetId, isActive: true, createdAt: now, updatedAt: now,
      ...nullify(patch),
    }
    await localUpsert('payment_plans', plan)
    set(s => ({ plans: [...s.plans, plan] }))
  },

  saveOccurrence: async (kind, targetId, month, patch) => {
    await get().saveOccurrences([{ kind, targetId, month, patch }])
  },

  saveOccurrences: async (writes) => {
    if (writes.length === 0) return
    const now = new Date().toISOString()
    const working = new Map(get().occurrences.map(o => [o.id, o]))
    const changed = new Map<string, PaymentOccurrence>()
    const ops: BatchOp[] = []

    for (const w of writes) {
      const id = occurrenceIdFor(w.kind, w.targetId, w.month)
      const patch = nullify({ ...w.patch, updatedAt: now })
      const cur = working.get(id)
      const next: PaymentOccurrence = cur
        ? { ...cur, ...patch }
        : { id, targetKind: w.kind, targetId: w.targetId, month: w.month, createdAt: now, ...patch, updatedAt: now }
      ops.push(cur
        ? { kind: 'patch', table: 'payment_occurrences', id, patch: patch as Record<string, unknown> }
        : { kind: 'upsert', table: 'payment_occurrences', entity: next })
      working.set(id, next)
      changed.set(id, next)
    }

    await localBatch(ops)
    set(s => {
      const merged = new Map(s.occurrences.map(o => [o.id, o]))
      for (const [id, o] of changed) merged.set(id, o)
      return { occurrences: [...merged.values()] }
    })
  },

  resetOccurrence: async (kind, targetId, month) => {
    const id = occurrenceIdFor(kind, targetId, month)
    if (!get().occurrences.some(o => o.id === id)) return
    await softDelete('payment_occurrences', id)
    set(s => ({ occurrences: s.occurrences.filter(o => o.id !== id) }))
  },
}))
