'use client'

import { useMemo } from 'react'
import { useUIStore } from '@/store'
import type { MonthYear } from '@/types'
import { periodSelectionLabel, periodSelectionMonth, resolvePeriodRange, type PeriodSelection } from '@/lib/period'

/** Sayfalar arası paylaşılan dönem: seçim, çözülmüş aralık, ad ve değiştiriciler. */
export function usePeriod() {
  const type           = useUIStore(s => s.periodType)
  const offset         = useUIStore(s => s.periodOffset)
  const custom         = useUIStore(s => s.customRange)
  const periodDay      = useUIStore(s => s.periodDay)
  const setType        = useUIStore(s => s.setPeriodType)
  const setOffset      = useUIStore(s => s.setPeriodOffset)
  const setCustomRange = useUIStore(s => s.setCustomRange)

  const sel = useMemo<PeriodSelection>(() => ({ type, offset, custom }), [type, offset, custom])
  // periodDay: gün dönünce "bugün"e göreli aralık yeniden hesaplanır
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(() => resolvePeriodRange(sel), [sel, periodDay])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const label = useMemo(() => periodSelectionLabel(sel), [sel, periodDay])

  return {
    type,
    offset,
    custom,
    from: range.from,
    to: range.to,
    label,
    /** Gezinti ya da özel aralık yok — canlı (içinde bulunulan) dönem */
    isCurrent: !custom && offset === 0,
    setType,
    setOffset,
    setCustomRange,
  }
}

/** Yalnız ay gösteren sayfalar için paylaşılan dönemin ayı ve ayı değiştiren fonksiyon. */
export function useSelectedMonth(): [MonthYear, (my: MonthYear) => void] {
  const type      = useUIStore(s => s.periodType)
  const offset    = useUIStore(s => s.periodOffset)
  const custom    = useUIStore(s => s.customRange)
  const periodDay = useUIStore(s => s.periodDay)
  const setMonth  = useUIStore(s => s.setMonth)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const month = useMemo(() => periodSelectionMonth({ type, offset, custom }), [type, offset, custom, periodDay])
  return [month, setMonth]
}
