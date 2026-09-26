'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ── Gizlilik tercihleri (cihaz düzeyi) ─────────────────────────────────────
   hideAmounts: tüm tutarlar "₺•••" gösterilir (lib/utils/currency).
   onlineLogos: alıcı adları logo bulmak için /api/brand-logo'ya (Clearbit /
     Wikidata), alan adları favicon için Google'a gider. Kapalıyken hiçbir ad
     ya da alan adı dışarı çıkmaz, baş harf rozeti gösterilir. İşlem
     AÇIKLAMALARI zaten hiçbir durumda gönderilmez (güvenlik denetimi F2).

   Anahtar lib/auth DEVICE_KEYS'te: çıkışta silinmez — aksi halde çıkış
   yapınca gizlilik tercihleri kendiliğinden varsayılana (açığa) dönerdi. */

interface PrivacyState {
  hideAmounts: boolean
  setHideAmounts: (v: boolean) => void
  onlineLogos: boolean
  setOnlineLogos: (v: boolean) => void
}

export const PRIVACY_STORAGE_KEY = 'fintrack-privacy'

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    set => ({
      hideAmounts: false,
      setHideAmounts: v => set({ hideAmounts: v }),
      onlineLogos: true,
      setOnlineLogos: v => set({ onlineLogos: v }),
    }),
    {
      name: PRIVACY_STORAGE_KEY,
      partialize: s => ({ hideAmounts: s.hideAmounts, onlineLogos: s.onlineLogos }),
    },
  ),
)

/** React dışı (store/servis) okuma: dışarıya ad göndermeden önce sorulur. */
export function onlineLogosAllowed(): boolean {
  return usePrivacyStore.getState().onlineLogos
}
