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
   satırları da akıştan (gelir/gider/net) düşülür — isRealizedInvestmentPnlTx.

   showFutureTxs: işlem listelerinde (İşlemler + hesap detayı) "Gelecek
   işlemler" kutusu. Tek ayar iki sayfada ortak — birinde kaldırılan kutu
   sayfa yenilense de, diğer sayfada da kapalı kalır. */

interface SettingsState {
  includeFundGain: boolean
  setIncludeFundGain: (v: boolean) => void
  showFutureTxs: boolean
  setShowFutureTxs: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      includeFundGain: true,
      setIncludeFundGain: v => set({ includeFundGain: v }),
      showFutureTxs: true,
      setShowFutureTxs: v => set({ showFutureTxs: v }),
    }),
    {
      name: 'fintrack-settings',
      partialize: s => ({ includeFundGain: s.includeFundGain, showFutureTxs: s.showFutureTxs }),
    },
  ),
)
