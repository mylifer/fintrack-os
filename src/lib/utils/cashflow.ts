import {
  format, parseISO, differenceInDays,
  startOfWeek, endOfWeek, addWeeks,
  startOfMonth, endOfMonth, addMonths,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { isInvestmentPrincipalTx } from './calculations'
import { baseAmount } from './fx'
import { sumBy } from './money'
import type { Transaction } from '@/types'

export type CashFlowPoint = {
  label: string
  income: number
  expense: number
  /** Bu barın kapsadığı tarih aralığı — detay overlay'i bu aralığı okur. */
  from: string
  to: string
}

/**
 * Bir tarih aralığını haftalık (≤45 gün) ya da aylık (>45 gün) kovalara böler
 * ve her kovanın gelir/gider toplamını hesaplar. Raporlar ve dashboard nakit
 * akışı grafikleri aynı zaman filtresinde birebir aynı çubukları göstersin
 * diye TEK bir yerden (bu fonksiyon) beslenirler.
 */
export function buildCashFlowData(
  transactions: Transaction[],
  dateRange: { from: string; to: string },
): CashFlowPoint[] {
  const from = parseISO(dateRange.from)
  const to   = parseISO(dateRange.to)
  const days = differenceInDays(to, from) + 1
  const pts: CashFlowPoint[] = []

  // TRY-normalize (baseAmount, S2/S3) + kuruş-exact (S8) — dashboard'daki
  // calcMonthlyFlow ile aynı para birimi kuralı; ham `amount` karışık PB toplamaz.
  // Yatırım anapara satırları (… Alımı/… Satışı) akış grafiğine girmez; yalnızca
  // gerçekleşen K/Z ile normal gelir/gider — KPI kartlarıyla aynı kapsam.
  // slice(0,10): calcPeriodFlow/isInRange ile aynı gün-sınırı toleransı — legacy
  // tam-ISO datetime (ör. '2026-07-31T15:00') aralığın son gününden düşmesin,
  // yoksa çubuklar KPI'dan az toplar (bar↔KPI tutarsızlığı).
  const income  = (pFrom: string, pTo: string) =>
    sumBy(transactions.filter(t => t.type === 'income'  && t.date.slice(0, 10) >= pFrom && t.date.slice(0, 10) <= pTo && !isInvestmentPrincipalTx(t)), baseAmount)
  const expense = (pFrom: string, pTo: string) =>
    sumBy(transactions.filter(t => t.type === 'expense' && t.date.slice(0, 10) >= pFrom && t.date.slice(0, 10) <= pTo && !isInvestmentPrincipalTx(t)), baseAmount)

  if (days <= 45) {
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
      pts.push({ label, income: income(pFrom, pTo), expense: expense(pFrom, pTo), from: pFrom, to: pTo })
      wStart = addWeeks(wStart, 1)
    }
  } else {
    let mStart = startOfMonth(from)
    while (mStart <= to) {
      const mEnd  = endOfMonth(mStart)
      const pFrom = format(mStart < from ? from : mStart, 'yyyy-MM-dd')
      const pTo   = format(mEnd   > to   ? to   : mEnd,   'yyyy-MM-dd')
      pts.push({ label: format(mStart, 'MMM yy', { locale: tr }), income: income(pFrom, pTo), expense: expense(pFrom, pTo), from: pFrom, to: pTo })
      mStart = addMonths(mStart, 1)
    }
  }
  return pts
}
