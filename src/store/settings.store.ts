'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clampRate, type FundTaxConfig } from '@/lib/utils/fund-tax'

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
   sayfa yenilense de, diğer sayfada da kapalı kalır.

   fundTax*: TEFAS fon stopajı (bkz. lib/utils/fund-tax). Alanlar DÜZ tutulur,
   iç içe nesne DEĞİL: persist hidrasyonu sığ birleştirdiği için eski bir
   kayıttan gelen eksik alt anahtar sessizce undefined kalırdı. Varsayılan
   KAPALI ve oran 0 — kullanıcı Ayarlar'dan açıp kendi fonuna göre oranı
   girene kadar hiçbir tutar değişmez. */

interface SettingsState {
  includeFundGain: boolean
  setIncludeFundGain: (v: boolean) => void
  showFutureTxs: boolean
  setShowFutureTxs: (v: boolean) => void

  fundTaxEnabled: boolean
  setFundTaxEnabled: (v: boolean) => void
  fundTaxDefaultRate: number
  setFundTaxDefaultRate: (rate: number) => void
  fundTaxRates: Record<string, number>
  /** rate null → fon bazındaki istisna kaldırılır, varsayılan orana döner. */
  setFundTaxRate: (code: string, rate: number | null) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      includeFundGain: true,
      setIncludeFundGain: v => set({ includeFundGain: v }),
      showFutureTxs: true,
      setShowFutureTxs: v => set({ showFutureTxs: v }),

      fundTaxEnabled: false,
      setFundTaxEnabled: v => set({ fundTaxEnabled: v }),
      fundTaxDefaultRate: 0,
      setFundTaxDefaultRate: rate => set({ fundTaxDefaultRate: clampRate(rate) }),
      fundTaxRates: {},
      setFundTaxRate: (code, rate) => set(s => {
        const next = { ...s.fundTaxRates }
        if (rate === null) delete next[code]
        else next[code] = clampRate(rate)
        return { fundTaxRates: next }
      }),
    }),
    {
      name: 'fintrack-settings',
      partialize: s => ({
        includeFundGain:    s.includeFundGain,
        showFutureTxs:      s.showFutureTxs,
        fundTaxEnabled:     s.fundTaxEnabled,
        fundTaxDefaultRate: s.fundTaxDefaultRate,
        fundTaxRates:       s.fundTaxRates,
      }),
    },
  ),
)

/* Stopaj ayarlarının tek okuma noktası. Hesap fonksiyonları (fund-tax) saf
   kalsın diye config nesnesi burada toplanır — store'a bağımlı değiller. */

/** React dışı (store/efekt) kullanım — satış kaydı bunu okur. */
export function getFundTaxConfig(): FundTaxConfig {
  const s = useSettingsStore.getState()
  return { enabled: s.fundTaxEnabled, defaultRate: s.fundTaxDefaultRate, rates: s.fundTaxRates }
}

/** Bileşenler için — kimliği yalnız alanlar değişince değişir (memo bağımlılığı). */
export function useFundTaxConfig(): FundTaxConfig {
  const enabled     = useSettingsStore(s => s.fundTaxEnabled)
  const defaultRate = useSettingsStore(s => s.fundTaxDefaultRate)
  const rates       = useSettingsStore(s => s.fundTaxRates)
  return useMemo(() => ({ enabled, defaultRate, rates }), [enabled, defaultRate, rates])
}
