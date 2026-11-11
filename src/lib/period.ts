import { endOfYear, format, parseISO, startOfMonth, startOfYear } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { MonthYear, PeriodType } from '@/types'
import { formatPeriodLabel, getPeriodRangeAt, periodAnchor } from '@/lib/utils/date'

/* Paylaşılan dönem seçiminin saf çözümlemesi (store: ui.store periodType /
   periodOffset / customRange). Sayfalar aralığı ve etiketi buradan alır;
   böylece Dashboard'da seçilen dönem İşlemler'de, Raporlar'da ve Bütçeler'de
   aynı aralığa çözülür. */

export interface PeriodSelection {
  type: PeriodType
  offset: number
  custom: { from: string; to: string } | null
}

/** Seçimin tarih aralığı. Özel aralıkta girilmemiş uçlar ay başı / bugün olur. */
export function resolvePeriodRange(sel: PeriodSelection, now = new Date()): { from: string; to: string } {
  if (sel.custom) {
    return {
      from: sel.custom.from || format(startOfMonth(now), 'yyyy-MM-dd'),
      to:   sel.custom.to   || format(now, 'yyyy-MM-dd'),
    }
  }
  return getPeriodRangeAt(sel.type, sel.offset)
}

/** Gezinti şeridindeki ad — "Kasım 2026", "Eyl – Kas 2026", özelde "1 Kas – 11 Kas 2026". */
export function periodSelectionLabel(sel: PeriodSelection): string {
  if (sel.custom) {
    const { from, to } = resolvePeriodRange(sel)
    return `${format(parseISO(from), 'd MMM', { locale: tr })} – ${format(parseISO(to), 'd MMM yyyy', { locale: tr })}`
  }
  return formatPeriodLabel(sel.type, sel.offset)
}

/** Yalnız ay gösteren sayfaların (Bütçeler, Aylık Özet) ayı: seçimin referans
 *  günü hangi aydaysa o. Özelde aralığın bittiği ay, Tüm Zamanlar'da bu ay. */
export function periodSelectionMonth(sel: PeriodSelection, now = new Date()): MonthYear {
  const d = sel.custom
    ? parseISO(resolvePeriodRange(sel, now).to)
    : periodAnchor(sel.type, sel.offset, now)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

/** Seçim, oturum başındaki varsayılan mı (Aylık, bu ay, özel yok)? */
export function isDefaultSelection(sel: PeriodSelection): boolean {
  return sel.type === 'monthly' && sel.offset === 0 && !sel.custom
}

/** "Tüm Zamanlar"ın gerçek aralığı: en erken işlemden BUGÜNE (Raporlar ve
 *  İstatistikler ortak). Bitişi son işleme sabitlemek, bugüne kadarki fon
 *  değerini güncel fiyatla ölçmüyordu; sabit erken başlangıç ise grafiklerde
 *  onlarca boş ay üretirdi. İşlem yoksa (ya da hepsi gelecekteyse) bu yıl. */
export function allTimeRange(transactions: readonly { date: string }[], now = new Date()): { from: string; to: string } {
  let min = ''
  for (const t of transactions) {
    const d = t.date.slice(0, 10)
    if (d && (!min || d < min)) min = d
  }
  const to = format(now, 'yyyy-MM-dd')
  if (min && min <= to) return { from: min, to }
  return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
}
