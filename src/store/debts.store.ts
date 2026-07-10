'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Debt, DebtWithRemaining } from '@/types'
import { enrichDebt } from '@/lib/utils/calculations'
import { isDueSoon } from '@/lib/utils/date'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete, reconcilingPull } from '@/lib/sync/engine'

interface DebtState {
  debts: Debt[]
  loading: boolean
  load: () => Promise<void>
  add: (debt: Debt) => Promise<void>
  update: (id: string, patch: Partial<Debt>) => Promise<void>
  remove: (id: string) => Promise<void>
  recordPayment: (id: string, amount: number) => Promise<void>
  /** Adjusts paidAmount by delta (negative to revert). Recomputes isSettled. */
  adjustPaidAmount: (id: string, delta: number) => Promise<void>
  settle: (id: string) => Promise<void>
  getActive: () => DebtWithRemaining[]
  getDueSoon: (days?: number) => DebtWithRemaining[]
}

export const useDebtStore = create<DebtState>()((set, get) => ({
  debts: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const debts = await reconcilingPull<Debt>('debts')
      set({ debts, loading: false })
    } catch (err) {
      console.error('[debts:load]', err)
      const debts = (await db.debts.toArray()).filter(isLive)
      set({ debts, loading: false })
    }
  },

  add: async (debt) => {
    // The outbox snapshot strips DebtWithRemaining computed fields.
    await localUpsert('debts', debt)
    set(s => ({ debts: [...s.debts, debt] }))
  },

  update: async (id, patch) => {
    await localPatch('debts', id, patch as Record<string, unknown>)
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  remove: async (id) => {
    await softDelete('debts', id) // C3 — soft delete via durable outbox
    set(s => ({ debts: s.debts.filter(d => d.id !== id) }))
  },

  recordPayment: async (id, amount) => {
    const debt = get().debts.find(d => d.id === id)
    if (!debt) return
    const paidAmount = Math.round((debt.paidAmount + amount) * 100) / 100
    // Negatif tutar bir ödemenin geri alınmasıdır → taksit sayısını azalt (0'ın altına düşme)
    const installmentDelta = amount < 0 ? -1 : amount > 0 ? 1 : 0
    const paidInstallments = Math.max(0, (debt.paidInstallments ?? 0) + installmentDelta)
    const isSettled = paidAmount >= debt.totalAmount
    const patch = { paidAmount, paidInstallments, isSettled }

    await localPatch('debts', id, patch)
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  adjustPaidAmount: async (id, delta) => {
    const debt = get().debts.find(d => d.id === id)
    if (!debt) return
    const paidAmount = Math.round(Math.max(0, debt.paidAmount + delta) * 100) / 100
    const isSettled = paidAmount >= debt.totalAmount
    const patch = { paidAmount, isSettled }
    await localPatch('debts', id, patch)
    set(s => ({ debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d) }))
  },

  settle: async (id) => {
    const patch = { isSettled: true }
    await localPatch('debts', id, patch)
    set(s => ({
      debts: s.debts.map(d => d.id === id ? { ...d, ...patch } : d),
    }))
  },

  getActive: () => get().debts.filter(d => !d.isSettled).map(enrichDebt),

  getDueSoon: (days = 7) =>
    get().debts
      .filter(d => !d.isSettled && d.dueDate && isDueSoon(d.dueDate, days))
      .map(enrichDebt),
}))
