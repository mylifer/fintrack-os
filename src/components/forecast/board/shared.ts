import { addDays, format, parseISO } from 'date-fns'
import type { ForecastDriver, ForecastEvent, ForecastMode, ForecastPoint } from '@/lib/utils/forecast'
import { subMoney, sumBy } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/date'
import type { ChartEvent } from '../_ForecastChart'

/* ── Tahmin tahtası — paylaşılan veri ────────────────────────────────────────
 * Kabuk (forecast/page.tsx) tahmini bir kez hesaplar; görünümler yalnız basar.
 * Görünüm değiştirmek olay kümesini ya da tutarları DEĞİŞTİRMEZ — buradaki
 * yardımcılar aynı `points`/`events` üzerinden türetilmiş kesitler üretir
 * (gün gün bakiye, ay kovaları), yeni bir hesap yapmaz.
 * ------------------------------------------------------------------------- */

export interface ForecastViewProps {
  /** Projeksiyon noktaları: bugün + her olay günü (bugünden ufka). */
  points: ForecastPoint[]
  /** Grafik serisi — 'Tüm Zamanlar'da geçmiş yürüyüşü de içerir. */
  chartPoints: ForecastPoint[]
  chartEvents: ChartEvent[]
  /** Gelecek olaylar, tarih artan. */
  events: ForecastEvent[]
  drivers: ForecastDriver[]
  shortfallDate: string | null
  horizonEnd: string
  todayStr: string
  mode: ForecastMode
}

/** Gün gün bakiye haritası: seyrek noktalar sessiz günlerde taşınarak doldurulur.
 *  Grafikteki yoğunlaştırmanın aynısı — takvim ve defter de aynı bakiyeyi görsün. */
export function dailyBalances(points: ForecastPoint[], endDate: string): Map<string, number> {
  const out = new Map<string, number>()
  if (points.length === 0) return out
  const last = points[points.length - 1].date
  const end = endDate > last ? endDate : last
  let idx = 0
  let balance = points[0].balance
  for (let d = parseISO(points[0].date); ; d = addDays(d, 1)) {
    const date = format(d, 'yyyy-MM-dd')
    while (idx < points.length && points[idx].date <= date) {
      balance = points[idx].balance
      idx++
    }
    out.set(date, balance)
    if (date >= end) break
  }
  return out
}

export function groupByDay(events: ForecastEvent[]): Map<string, ForecastEvent[]> {
  const out = new Map<string, ForecastEvent[]>()
  for (const e of events) {
    const list = out.get(e.date)
    if (list) list.push(e)
    else out.set(e.date, [e])
  }
  return out
}

export interface MonthBucket {
  key: string            // yyyy-MM
  label: string          // 'Eylül 2026'
  firstDay: string       // ayın ufuk içindeki ilk günü (yyyy-MM-dd)
  lastDay: string        // ayın ufuk içindeki son günü
  startBalance: number   // ay başlamadan önceki bakiye (ilk ayda: bugünkü bakiye)
  endBalance: number     // ufuk içindeki son günün bakiyesi
  minBalance: number     // ay içindeki en düşük gün bakiyesi
  income: number
  expense: number
  net: number
  events: ForecastEvent[]
}

/** Ufkun kapsadığı her takvim ayı için tek kova. Olaysız aylar da döner —
 *  takvimde ve ay şeridinde boşluk atlamak akışı yanıltıcı gösterirdi. */
export function monthlyBuckets(
  points: ForecastPoint[],
  events: ForecastEvent[],
  todayStr: string,
  horizonEnd: string,
): MonthBucket[] {
  if (points.length === 0) return []
  const daily = dailyBalances(points, horizonEnd)
  const byMonth = new Map<string, ForecastEvent[]>()
  for (const e of events) {
    const key = e.date.slice(0, 7)
    const list = byMonth.get(key)
    if (list) list.push(e)
    else byMonth.set(key, [e])
  }

  const out: MonthBucket[] = []
  let carry = points[0].balance
  const days = [...daily.keys()].sort()
  let i = 0
  while (i < days.length) {
    const key = days[i].slice(0, 7)
    const monthDays: string[] = []
    while (i < days.length && days[i].slice(0, 7) === key) {
      monthDays.push(days[i])
      i++
    }
    const monthEvents = byMonth.get(key) ?? []
    const income  = sumBy(monthEvents.filter(e => e.type === 'income'),  e => e.amountTry)
    const expense = sumBy(monthEvents.filter(e => e.type === 'expense'), e => e.amountTry)
    const balances = monthDays.map(d => daily.get(d)!)
    out.push({
      key,
      label: formatDate(`${key}-01`, 'MMMM yyyy'),
      firstDay: monthDays[0],
      lastDay: monthDays[monthDays.length - 1],
      startBalance: carry,
      endBalance: balances[balances.length - 1],
      minBalance: Math.min(...balances, carry),
      income,
      expense,
      net: subMoney(income, expense),
      events: monthEvents,
    })
    carry = balances[balances.length - 1]
  }
  return out
}

/** Sıfırın sabit bir konumda durduğu ıraksak çubuk geometrisi (yüzde).
 *  Negatif bakiye sıfırın soluna taşar; hepsi pozitifse sıfır sola yapışır. */
export function barGeometry(value: number, min: number, max: number) {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const span = hi - lo || 1
  const zero = ((0 - lo) / span) * 100
  const v = ((value - lo) / span) * 100
  const negative = value < 0
  return {
    zeroPct:  zero,
    leftPct:  negative ? v : zero,
    widthPct: Math.abs(v - zero),
    negative,
  }
}

/** Gelir yeşili / gider kırmızısı — sayfa genelinde tek yerden. */
export const INCOME_COLOR  = '#00C853'
export const EXPENSE_COLOR = '#FF1744'
