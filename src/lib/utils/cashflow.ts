import {
  format, parseISO, differenceInDays,
  startOfWeek, endOfWeek, addWeeks, addDays,
  startOfMonth, endOfMonth, addMonths, subMonths,
  startOfYear, endOfYear, addYears,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { isPrincipalMoveTx } from './calculations'
import { baseAmount } from './fx'
import { sumBy } from './money'
import type { Transaction, PeriodType } from '@/types'

export type CashFlowPoint = {
  label: string
  income: number
  expense: number
  /** Bu barın kapsadığı tarih aralığı — detay overlay'i bu aralığı okur. */
  from: string
  to: string
}

// TRY-normalize (baseAmount, S2/S3) + kuruş-exact (S8) — dashboard'daki
// calcMonthlyFlow ile aynı para birimi kuralı; ham `amount` karışık PB toplamaz.
// Yatırım anapara satırları (… Alımı/… Satışı) akış grafiğine girmez; yalnızca
// gerçekleşen K/Z ile normal gelir/gider — KPI kartlarıyla aynı kapsam.
// slice(0,10): calcPeriodFlow/isInRange ile aynı gün-sınırı toleransı — legacy
// tam-ISO datetime (ör. '2026-07-31T15:00') aralığın son gününden düşmesin,
// yoksa çubuklar KPI'dan az toplar (bar↔KPI tutarsızlığı).
function flowSum(transactions: Transaction[], type: 'income' | 'expense', pFrom: string, pTo: string): number {
  return sumBy(
    transactions.filter(t => t.type === type && t.date.slice(0, 10) >= pFrom && t.date.slice(0, 10) <= pTo && !isPrincipalMoveTx(t)),
    baseAmount,
  )
}

function bucket(transactions: Transaction[], label: string, pFrom: string, pTo: string): CashFlowPoint {
  return { label, income: flowSum(transactions, 'income', pFrom, pTo), expense: flowSum(transactions, 'expense', pFrom, pTo), from: pFrom, to: pTo }
}

function dailyBuckets(transactions: Transaction[], fromISO: string, toISO: string): CashFlowPoint[] {
  const from = parseISO(fromISO)
  const to   = parseISO(toISO)
  const pts: CashFlowPoint[] = []
  let d = from
  while (d <= to) {
    const iso = format(d, 'yyyy-MM-dd')
    pts.push(bucket(transactions, format(d, 'd MMM', { locale: tr }), iso, iso))
    d = addDays(d, 1)
  }
  return pts
}

function weeklyBuckets(transactions: Transaction[], fromISO: string, toISO: string): CashFlowPoint[] {
  const from = parseISO(fromISO)
  const to   = parseISO(toISO)
  const pts: CashFlowPoint[] = []
  let wStart = startOfWeek(from, { locale: tr })
  while (wStart <= to) {
    const wEnd  = endOfWeek(wStart, { locale: tr })
    const s     = wStart < from ? from : wStart
    const e     = wEnd   > to   ? to   : wEnd
    const pFrom = format(s, 'yyyy-MM-dd')
    const pTo   = format(e, 'yyyy-MM-dd')
    // Etiket tek bir GÜN değil, bir HAFTA aralığını gösterir (ör. "13–19 Tem").
    // Yalnız başlangıç gününü ("13 Tem") yazmak "tüm gider tek güne yığılmış"
    // yanılgısına yol açıyordu; ay sınırını aşan haftalarda iki ay da yazılır.
    const label = s.getMonth() === e.getMonth()
      ? `${format(s, 'd', { locale: tr })}–${format(e, 'd MMM', { locale: tr })}`
      : `${format(s, 'd MMM', { locale: tr })}–${format(e, 'd MMM', { locale: tr })}`
    pts.push(bucket(transactions, label, pFrom, pTo))
    wStart = addWeeks(wStart, 1)
  }
  return pts
}

function monthlyBuckets(transactions: Transaction[], fromISO: string, toISO: string): CashFlowPoint[] {
  const from = parseISO(fromISO)
  const to   = parseISO(toISO)
  const pts: CashFlowPoint[] = []
  let mStart = startOfMonth(from)
  while (mStart <= to) {
    const mEnd  = endOfMonth(mStart)
    const pFrom = format(mStart < from ? from : mStart, 'yyyy-MM-dd')
    const pTo   = format(mEnd   > to   ? to   : mEnd,   'yyyy-MM-dd')
    pts.push(bucket(transactions, format(mStart, 'MMM yy', { locale: tr }), pFrom, pTo))
    mStart = addMonths(mStart, 1)
  }
  return pts
}

function yearlyBuckets(transactions: Transaction[], fromISO: string, toISO: string): CashFlowPoint[] {
  const from = parseISO(fromISO)
  const to   = parseISO(toISO)
  const pts: CashFlowPoint[] = []
  let yStart = startOfYear(from)
  while (yStart <= to) {
    const yEnd  = endOfYear(yStart)
    const pFrom = format(yStart < from ? from : yStart, 'yyyy-MM-dd')
    const pTo   = format(yEnd   > to   ? to   : yEnd,   'yyyy-MM-dd')
    pts.push(bucket(transactions, format(yStart, 'yyyy'), pFrom, pTo))
    yStart = addYears(yStart, 1)
  }
  return pts
}

function earliestTxDate(transactions: Transaction[]): string | null {
  let min = ''
  for (const t of transactions) {
    const d = t.date.slice(0, 10)
    if (!d) continue
    if (!min || d < min) min = d
  }
  return min || null
}

/**
 * Bir tarih aralığını haftalık (≤45 gün) ya da aylık (>45 gün) kovalara böler
 * ve her kovanın gelir/gider toplamını hesaplar. Raporlar sayfasının nakit
 * akışı grafiği (kendi preset'inin aralık uzunluğuna göre) bu fonksiyonu
 * kullanır.
 */
export function buildCashFlowData(
  transactions: Transaction[],
  dateRange: { from: string; to: string },
): CashFlowPoint[] {
  const days = differenceInDays(parseISO(dateRange.to), parseISO(dateRange.from)) + 1
  return days <= 45
    ? weeklyBuckets(transactions, dateRange.from, dateRange.to)
    : monthlyBuckets(transactions, dateRange.from, dateRange.to)
}

/**
 * Dashboard'un nakit akışı grafiği için: kova GENİŞLİĞİ seçili dönem
 * sekmesine (Günlük/Haftalık/Aylık/Yıllık/Tüm Zamanlar) göre sabit, aralık
 * uzunluğundan bağımsızdır (Raporlar'daki buildCashFlowData'nın aksine) —
 * Günlük→gün (son 4 ay), Haftalık→hafta, Aylık→ay, Yıllık→yıl kovası. "Özel"
 * (custom) aralıkta da gün kovası kullanılır — kullanıcı hangi aralığı
 * seçerse seçsin gün bazında detay görür.
 */
export function buildDashboardCashFlowData(
  transactions: Transaction[],
  periodType: PeriodType,
  customRange: { from: string; to: string } | null,
): CashFlowPoint[] {
  if (customRange) return dailyBuckets(transactions, customRange.from, customRange.to)

  const now         = new Date()
  const todayISO     = format(now, 'yyyy-MM-dd')
  const yearStartISO = format(startOfYear(now), 'yyyy-MM-dd')

  switch (periodType) {
    case 'daily':
      return dailyBuckets(transactions, format(subMonths(now, 4), 'yyyy-MM-dd'), todayISO)
    case 'weekly':
      return weeklyBuckets(transactions, yearStartISO, todayISO)
    case 'monthly':
      return monthlyBuckets(transactions, yearStartISO, format(endOfMonth(now), 'yyyy-MM-dd'))
    case 'yearly':
      return yearlyBuckets(transactions, earliestTxDate(transactions) ?? yearStartISO, todayISO)
    case 'all':
      return monthlyBuckets(transactions, earliestTxDate(transactions) ?? yearStartISO, todayISO)
  }
}
