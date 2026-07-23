'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Hesaplama tercihleri ─────────────────────────────────────────────────
   Oturumlar arası kalıcı kullanıcı tercihleri. selectedPeriod gibi oturumluk
   UI durumundan (ui.store) ayrı tutulur; buradaki her alan localStorage'a
   yazılır.

   includeFundGain: fon getirisi gelir/net hesaplarına dahil edilsin mi?
   Varsayılan açık (mevcut davranış). Kapalıyken dashboard geliri/net'i
   TAMAMEN fon-sız gösterir: (1) gerçekleşmemiş dönemsel TEFAS fon getirisi
   (fundGain) eklenmez ve (2) gerçekleşen "… Satış Kârı/Zararı" defter
   satırları da akıştan (gelir/gider/net) düşülür — isRealizedInvestmentPnlTx. */

interface SettingsState {
  includeFundGain: boolean
  setIncludeFundGain: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      includeFundGain: true,
      setIncludeFundGain: v => set({ includeFundGain: v }),
    }),
    { name: 'fintrack-settings', partialize: s => ({ includeFundGain: s.includeFundGain }) },
  ),
)
