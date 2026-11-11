'use client'

import { create } from 'zustand'
import type { ModalType, ModalPayload, MonthYear, TransactionFilters, PeriodType } from '@/types'
import { currentMonthYear, monthsBetween, today } from '@/lib/utils/date'

/** Özel tarih aralığı; boş uçlar çözümlenirken ay başı / bugün olur (bkz. lib/period). */
export interface CustomRange {
  from: string
  to: string
}

interface UIState {
  modal: ModalType
  modalPayload: ModalPayload | null
  /** Seçili dönem — Dashboard, İşlemler, Hesaplar, Raporlar, İstatistikler,
   *  Bütçeler ve Aylık Özet aynı dönemi paylaşır (sayfalar arası taşınır). */
  periodType: PeriodType
  /** 0 = içinde bulunulan dönem, −1 = bir önceki; türe göre birim (gün/hafta/ay/yıl) */
  periodOffset: number
  /** Doluysa "Özel" aralık etkin; tür ve kaydırma yok sayılır */
  customRange: CustomRange | null
  /** Bugünün tarihi — gün dönünce güncellenir ki "bu ay" gibi göreli dönemler yeniden hesaplansın */
  periodDay: string
  txFilters: TransactionFilters
  sidebarOpen: boolean

  openModal: (type: NonNullable<ModalType>, payload?: ModalPayload) => void
  closeModal: () => void
  /** Dönem türü seçmek her zaman güncel döneme döner ve özel aralıktan çıkar */
  setPeriodType: (type: PeriodType) => void
  setPeriodOffset: (offset: number) => void
  setCustomRange: (range: CustomRange | null) => void
  /** Yalnız ay gösteren sayfalar (Bütçeler, Aylık Özet) — dönemi o aya taşır */
  setMonth: (my: MonthYear) => void
  setPeriodDay: (day: string) => void
  setTxFilters: (filters: TransactionFilters) => void
  toggleSidebar: () => void
}

// Dönem bilinçli olarak KALICI DEĞİL: localStorage'a yazıldığı dönemde ay
// navigasyonunda kalınan bayat ay sonraki oturumlarda da açılıyor, dashboard ve
// bütçe kartları o ayın (çoğu zaman boş) verisini gösteriyordu ("bütçe 0
// gösteriyor" vakası, Temmuz 2026). Her oturum içinde bulunulan dönemle başlar;
// kaydırma bugüne GÖRELİ tutulduğundan ay dönünce offset 0 kendiliğinden yeni aya geçer.
export const useUIStore = create<UIState>()((set) => ({
  modal: null,
  modalPayload: null,
  periodType: 'monthly',
  periodOffset: 0,
  customRange: null,
  periodDay: today(),
  txFilters: {},
  sidebarOpen: false,

  openModal: (type, payload) => set({ modal: type, modalPayload: payload ?? null }),
  closeModal: () => set({ modal: null, modalPayload: null }),
  setPeriodType: (periodType) => set({ periodType, periodOffset: 0, customRange: null }),
  setPeriodOffset: (periodOffset) => set({ periodOffset }),
  setCustomRange: (customRange) => set({ customRange }),
  setMonth: (my) => set({ periodType: 'monthly', periodOffset: monthsBetween(currentMonthYear(), my), customRange: null }),
  setPeriodDay: (periodDay) => set({ periodDay }),
  setTxFilters: (txFilters) => set({ txFilters }),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
}))
