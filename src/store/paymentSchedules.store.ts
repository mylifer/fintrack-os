'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { PaymentSchedule } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { rowInActiveWorkspace } from '@/lib/workspace-context'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { defaultDueDateForMonth, isPaymentDue, resolvePeriod, validateOverride } from '@/lib/utils/paymentSchedule'

interface PaymentSchedulesState {
  schedules: PaymentSchedule[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (s: PaymentSchedule) => Promise<void>
  update: (id: string, patch: Partial<PaymentSchedule>) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
  toggleActive: (id: string) => Promise<void>
  /** Belirli bir ay ("YYYY-MM") için son ödeme tarihini değiştirir (hafta sonu/tatil kayması vb).
   *  Tarih komşu dönemleri geçemez (validateOverride); geçerse hata fırlatır. */
  setOverride: (id: string, monthKey: string, date: string) => Promise<void>
  /** O ay için girilmiş istisnayı kaldırır — dueDay'e göre varsayılana döner. */
  clearOverride: (id: string, monthKey: string) => Promise<void>
  /** Dönemi ödendi olarak işaretler (geri alınabilir) — hatırlatma sonraki döneme geçer. */
  markPaid: (id: string, monthKey: string, paidOn: string) => Promise<void>
  /** Ödendi işaretini kaldırır. */
  unmarkPaid: (id: string, monthKey: string) => Promise<void>
  /** Aktif olup ödenmemiş dönemi asOf'a gelmiş/geçmiş takvimler (bildirim/rozet). */
  getDueToday: (asOf: string) => PaymentSchedule[]
  /** Aktif olup ödenmemiş dönemi önümüzdeki 7 gün içinde olan takvimler. */
  getUpcoming: (asOf: string) => PaymentSchedule[]
}

const byName = (rows: PaymentSchedule[]) => rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'))

export const usePaymentSchedulesStore = create<PaymentSchedulesState>()((set, get) => ({
  schedules: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const schedules = await loadEntities<PaymentSchedule>(
      'payment_schedules', 'paymentSchedules',
      async () => byName((await db.paymentSchedules.toArray()).filter(isLive).filter(rowInActiveWorkspace)),
      byName,
    )
    set({ schedules, loading: false, ready: true })
  },

  add: async (s) => {
    await localUpsert('payment_schedules', s)
    set(st => ({ schedules: byName([...st.schedules, s]) }))
  },

  update: async (id, patch) => {
    await localPatch('payment_schedules', id, patch as Record<string, unknown>)
    set(st => ({
      schedules: byName(st.schedules.map(s => s.id === id ? { ...s, ...patch } : s)),
    }))
  },

  remove: async (id, opts) => {
    const s = get().schedules.find(x => x.id === id)
    await softDelete('payment_schedules', id) // C3 — soft delete via durable outbox
    set(st => ({ schedules: st.schedules.filter(x => x.id !== id) }))
    if (s && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Ödeme takvimi silindi', async () => {
        await localPatch('payment_schedules', id, { deleted_at: null })
        set(st => ({ schedules: byName([...st.schedules, s]) }))
      })
    }
  },

  toggleActive: async (id) => {
    const s = get().schedules.find(x => x.id === id)
    if (!s) return
    const isActive = !s.isActive
    await localPatch('payment_schedules', id, { isActive })
    set(st => ({ schedules: st.schedules.map(x => x.id === id ? { ...x, isActive } : x) }))
  },

  setOverride: async (id, monthKey, date) => {
    const s = get().schedules.find(x => x.id === id)
    if (!s) return
    const invalid = validateOverride(s, monthKey, date)
    if (invalid) throw new Error(invalid)
    // Varsayılanla aynı tarih bir istisna değildir — "Özel" rozeti boşuna çıkmasın.
    if (date === defaultDueDateForMonth(s.dueDay, monthKey)) return get().clearOverride(id, monthKey)
    const overrides = { ...s.overrides, [monthKey]: date }
    await localPatch('payment_schedules', id, { overrides })
    set(st => ({ schedules: st.schedules.map(x => x.id === id ? { ...x, overrides } : x) }))
  },

  clearOverride: async (id, monthKey) => {
    const s = get().schedules.find(x => x.id === id)
    if (!s?.overrides || !(monthKey in s.overrides)) return
    const overrides = { ...s.overrides }
    delete overrides[monthKey]
    await localPatch('payment_schedules', id, { overrides })
    set(st => ({ schedules: st.schedules.map(x => x.id === id ? { ...x, overrides } : x) }))
  },

  markPaid: async (id, monthKey, paidOn) => {
    const s = get().schedules.find(x => x.id === id)
    if (!s) return
    const paidMonths = { ...s.paidMonths, [monthKey]: paidOn }
    await localPatch('payment_schedules', id, { paidMonths })
    set(st => ({ schedules: st.schedules.map(x => x.id === id ? { ...x, paidMonths } : x) }))
    useUndoStore.getState().pushUndo(`${s.name} ödendi olarak işaretlendi`, () => get().unmarkPaid(id, monthKey))
  },

  unmarkPaid: async (id, monthKey) => {
    const s = get().schedules.find(x => x.id === id)
    if (!s?.paidMonths || !(monthKey in s.paidMonths)) return
    const paidMonths = { ...s.paidMonths }
    delete paidMonths[monthKey]
    await localPatch('payment_schedules', id, { paidMonths })
    set(st => ({ schedules: st.schedules.map(x => x.id === id ? { ...x, paidMonths } : x) }))
  },

  getDueToday: (asOf) => get().schedules.filter(s => isPaymentDue(s, asOf)),

  getUpcoming: (asOf) =>
    get().schedules.filter(s => s.isActive && resolvePeriod(s, asOf).status === 'upcoming'),
}))
