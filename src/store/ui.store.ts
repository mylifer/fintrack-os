'use client'

import { create } from 'zustand'
import type { ModalType, ModalPayload, MonthYear, TransactionFilters, PeriodType } from '@/types'
import { currentMonthYear } from '@/lib/utils/date'

interface UIState {
  modal: ModalType
  modalPayload: ModalPayload | null
  selectedPeriod: MonthYear
  periodType: PeriodType
  txFilters: TransactionFilters
  sidebarOpen: boolean

  openModal: (type: NonNullable<ModalType>, payload?: ModalPayload) => void
  closeModal: () => void
  setPeriod: (my: MonthYear) => void
  setPeriodType: (type: PeriodType) => void
  setTxFilters: (filters: TransactionFilters) => void
  toggleSidebar: () => void
}

// selectedPeriod bilinçli olarak KALICI DEĞİL: localStorage'a yazıldığı dönemde
// ay navigasyonunda kalınan bayat ay sonraki oturumlarda da açılıyor, dashboard
// ve bütçe kartları o ayın (çoğu zaman boş) verisini gösterirken hep güncel ayla
// açılan bütçe detayıyla çelişiyordu ("bütçe 0 gösteriyor" vakası, Temmuz 2026).
// Her oturum içinde bulunulan ayla başlar; oturum içi gezinme state'te yaşar.
export const useUIStore = create<UIState>()((set) => ({
  modal: null,
  modalPayload: null,
  selectedPeriod: currentMonthYear(),
  periodType: 'monthly',
  txFilters: {},
  sidebarOpen: false,

  openModal: (type, payload) => set({ modal: type, modalPayload: payload ?? null }),
  closeModal: () => set({ modal: null, modalPayload: null }),
  setPeriod: (my) => set({ selectedPeriod: my }),
  setPeriodType: (periodType) => set({ periodType }),
  setTxFilters: (txFilters) => set({ txFilters }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
}))
