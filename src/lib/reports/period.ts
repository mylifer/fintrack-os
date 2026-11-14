import {
  format, parseISO, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear,
  addMonths, addDays, addWeeks, addYears, startOfWeek, endOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'

// Raporlar sayfasının dönem modeli (reports/page.tsx'ten taşındı): presetler,
// ‹ › gezinti birimi, gezinilen dönemin adı ve tarih aralığı.

/* ── Types ────────────────────────────────────────────────────────── */

export type Preset = 'today' | 'this-week' | 'this-month' | 'last-month' | '3-months' | 'this-year' | 'all-time' | 'custom'

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today',      label: 'Bugün' },
  { key: 'this-week',  label: 'Bu Hafta' },
  { key: 'this-month', label: 'Bu Ay' },
  { key: 'last-month', label: 'Geçen Ay' },
  { key: '3-months',   label: 'Son 3 Ay' },
  { key: 'this-year',  label: 'Bu Yıl' },
  { key: 'all-time',   label: 'Tüm Zamanlar' },
  { key: 'custom',     label: 'Özel' },
]

// Gezinti birimi — ‹ › ile kaydırılabilen presetler ve kaydırma adımı. Burada
// olmayanlar ('all-time', 'custom') sabit aralıktır, gezinti şeridi gizlenir.
export const PRESET_UNIT: Partial<Record<Preset, 'day' | 'week' | 'month' | 'year'>> = {
  'today':      'day',
  'this-week':  'week',
  'this-month': 'month',
  'last-month': 'month',
  '3-months':   'month',  // 3 aylık pencere ay ay kayar
  'this-year':  'year',
}

/* ── Data helpers ─────────────────────────────────────────────────── */

/** Preset'in "şimdi" referansını `offset` birim kaydırır; aralık hesabı bunun
 *  üzerinden yürüdüğü için tek noktadan tüm presetler gezinilebilir olur. */
export function presetAnchor(preset: Preset, offset: number): Date {
  const now = new Date()
  if (!offset) return now
  switch (PRESET_UNIT[preset]) {
    case 'day':   return addDays(now, offset)
    case 'week':  return addWeeks(now, offset)
    case 'month': return addMonths(now, offset)
    case 'year':  return addYears(now, offset)
    default:      return now
  }
}

/** Gezinilen dönemin insan-okur adı — ör. "Temmuz 2026", "Haz – Ağu 2026". */
export function formatPresetLabel(preset: Preset, offset: number): string {
  const { from, to } = getPresetRange(preset, '', '', offset)
  switch (preset) {
    case 'today':      return format(parseISO(from), 'd MMMM yyyy', { locale: tr })
    case 'this-week':  return `${format(parseISO(from), 'd MMM', { locale: tr })} – ${format(parseISO(to), 'd MMM', { locale: tr })}`
    case 'this-month':
    case 'last-month': return format(parseISO(from), 'MMMM yyyy', { locale: tr })
    case '3-months':   return `${format(parseISO(from), 'MMM', { locale: tr })} – ${format(parseISO(to), 'MMM yyyy', { locale: tr })}`
    case 'this-year':  return format(parseISO(from), 'yyyy')
    default:           return ''
  }
}

export function getPresetRange(preset: Preset, customFrom: string, customTo: string, offset = 0) {
  const now = presetAnchor(preset, offset)
  switch (preset) {
    case 'today': {
      const t = format(now, 'yyyy-MM-dd')
      return { from: t, to: t }
    }
    case 'this-week':
      return {
        from: format(startOfWeek(now, { locale: tr }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(now,   { locale: tr }), 'yyyy-MM-dd'),
      }
    case 'this-month':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'last-month': {
      const lm = subMonths(now, 1)
      return { from: format(startOfMonth(lm), 'yyyy-MM-dd'), to: format(endOfMonth(lm), 'yyyy-MM-dd') }
    }
    case '3-months':
      return {
        from: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'),
        to:   format(endOfMonth(now), 'yyyy-MM-dd'),
      }
    case 'this-year':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'all-time':
      // Gerçek aralık işlemlerden hesaplanır (bkz. dateRange useMemo); burada
      // yalnızca işlem yokken kullanılan güvenli varsayılan.
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'custom':
      return {
        from: customFrom || format(startOfMonth(now), 'yyyy-MM-dd'),
        to:   customTo   || format(endOfMonth(now),   'yyyy-MM-dd'),
      }
  }
}
