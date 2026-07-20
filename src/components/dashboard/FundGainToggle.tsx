'use client'

import { useSettingsStore } from '@/store'

/** Anasayfa dönem barının sağ üstündeki "Fon getirileri dahil" anahtarı.
 *  Kapalıyken dönemsel TEFAS fon getirisi gelir/net kartlarından ve nakit
 *  akışı grafiğinden çıkarılır (tercih oturumlar arası kalıcıdır). */
export function FundGainToggle() {
  const includeFundGain    = useSettingsStore(s => s.includeFundGain)
  const setIncludeFundGain = useSettingsStore(s => s.setIncludeFundGain)

  return (
    <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
      <input
        type="checkbox"
        checked={includeFundGain}
        onChange={e => setIncludeFundGain(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
      />
      <span className="text-xs font-medium text-muted-foreground">Fon getirileri dahil</span>
    </label>
  )
}
