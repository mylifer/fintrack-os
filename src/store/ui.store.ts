'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      modal: null,
      modalPayload: null,
      selectedPeriod: currentMonthYear(),
      periodType: 'daily',
      txFilters: {},
      sidebarOpen: false,

      openModal: (type, payload) => set({ modal: type, modalPayload: payload ?? null }),
      closeModal: () => set({ modal: null, modalPayload: null }),
      setPeriod: (my) => set({ selectedPeriod: my }),
      setPeriodType: (periodType) => set({ periodType }),
      setTxFilters: (txFilters) => set({ txFilters }),
      toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: 'fintrack-ui',
      partialize: (state) => ({
        selectedPeriod: state.selectedPeriod,
      }),
    },
  )
)
