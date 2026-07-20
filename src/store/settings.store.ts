'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Hesaplama tercihleri ─────────────────────────────────────────────────
   Oturumlar arası kalıcı kullanıcı tercihleri. selectedPeriod gibi oturumluk
   UI durumundan (ui.store) ayrı tutulur; buradaki her alan localStorage'a
   yazılır.

   includeFundGain: dönemsel TEFAS fon getirisi gelir/net hesaplarına ve
   anasayfa widget'larına dahil edilsin mi? Varsayılan açık (mevcut davranış).
   Kapalıyken dashboard fon getirisini tüm kartlardan ve nakit akışı
   grafiğinden çıkarır. */

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
