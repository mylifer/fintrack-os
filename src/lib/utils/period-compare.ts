import { differenceInCalendarDays, differenceInCalendarMonths, endOfMonth, format, isLastDayOfMonth, parseISO, subDays, subMonths, subYears } from 'date-fns'

/* Karşılaştırma dönemi (Raporlar → Gelişmiş Analiz, Aylık Özet):
   - 'previous': hemen önceki aralık. Aralık TAM takvim aylarıysa (Bu Ay, Son 3
     Ay, Bu Yıl) aynı sayıda önceki tam ay: Eylül → 1–31 Ağustos (gün sayısıyla
     kaydırmak 2–31 Ağustos verirdi). Diğer aralıklarda aynı uzunlukta önceki
     günler (10 günlük aralık → önceki 10 gün).
   - 'year':     aynı tarihlerin bir yıl öncesi (Eylül 2026 → Eylül 2025) —
     mevsimsellik (bayram, tatil, okul açılışı) yüzünden aylık harcamayı
     önceki ayla değil geçen yılın aynı ayıyla kıyaslamak çoğu zaman daha
     anlamlıdır. 29 Şubat → 28 Şubat (date-fns subYears). */

export type CompareMode = 'previous' | 'year'

export function comparisonRange(
  range: { from: string; to: string },
  mode: CompareMode,
): { from: string; to: string } {
  const from = parseISO(range.from)
  const to = parseISO(range.to)
  if (mode === 'year') {
    return { from: format(subYears(from, 1), 'yyyy-MM-dd'), to: format(subYears(to, 1), 'yyyy-MM-dd') }
  }
  if (from.getDate() === 1 && isLastDayOfMonth(to)) {
    const months = differenceInCalendarMonths(to, from) + 1
    return {
      from: format(subMonths(from, months), 'yyyy-MM-dd'),
      to:   format(endOfMonth(subMonths(to, months)), 'yyyy-MM-dd'),
    }
  }
  const days = differenceInCalendarDays(to, from) + 1
  return { from: format(subDays(from, days), 'yyyy-MM-dd'), to: format(subDays(from, 1), 'yyyy-MM-dd') }
}

/** Yüzde değişim; önceki 0 ise ve şimdiki > 0 ise null ("yeni"). */
export function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return current === 0 ? 0 : null
  return ((current - prev) / Math.abs(prev)) * 100
}
