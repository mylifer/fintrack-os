import {
  format, parseISO, startOfMonth, endOfMonth,
  subMonths, addMonths, isWithinInterval, startOfYear, endOfYear,
  differenceInCalendarDays, isBefore, addDays, subDays, subWeeks, subYears,
  addWeeks, addYears, startOfWeek, endOfWeek, startOfDay,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import type { Account, MonthYear, PeriodType } from '@/types'

export function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function formatDate(iso: string, fmt = 'd MMM yyyy'): string {
  return format(parseISO(iso), fmt, { locale: tr })
}

export function formatDateShort(iso: string): string {
  return format(parseISO(iso), 'd MMM', { locale: tr })
}

export function formatMonthYear(my: MonthYear): string {
  return format(new Date(my.year, my.month - 1), 'MMMM yyyy', { locale: tr })
}

export function currentMonthYear(): MonthYear {
  const now = new Date()
  return { month: now.getMonth() + 1, year: now.getFullYear() }
}

export function monthRange(my: MonthYear): { from: string; to: string } {
  const d = new Date(my.year, my.month - 1)
  return {
    from: format(startOfMonth(d), 'yyyy-MM-dd'),
    to:   format(endOfMonth(d),   'yyyy-MM-dd'),
  }
}

export function yearRange(year: number): { from: string; to: string } {
  const d = new Date(year, 0)
  return {
    from: format(startOfYear(d), 'yyyy-MM-dd'),
    to:   format(endOfYear(d),   'yyyy-MM-dd'),
  }
}

export function isInRange(date: string, from: string, to: string): boolean {
  let start = parseISO(from)
  let end   = parseISO(to)
  // Tolerate a reversed range (user enters dateTo < dateFrom): isWithinInterval
  // throws RangeError when start > end, which would crash the filter.
  if (start > end) [start, end] = [end, start]
  // slice(0,10): legacy tam-ISO datetime tarih (isPosted ile aynı tolerans) —
  // '2026-07-31T15:00' aralığın son günü 00:00'ından büyük diye ay dışına düşmesin
  return isWithinInterval(parseISO(date.slice(0, 10)), { start, end })
}

export function prevMonth(my: MonthYear): MonthYear {
  const d = subMonths(new Date(my.year, my.month - 1), 1)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

export function nextMonth(my: MonthYear): MonthYear {
  const d = addMonths(new Date(my.year, my.month - 1), 1)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

// Returns statement period [from, to] for a credit card account
export function getStatementPeriod(account: Account, my: MonthYear): { from: string; to: string } {
  const rawDay = account.statementDay ?? 1
  // Clamp to the month's length so statementDay 29–31 doesn't roll into the
  // next month for short months (e.g. day 31 in April → May 1).
  const daysInMonth = new Date(my.year, my.month, 0).getDate()
  const day = Math.min(rawDay, daysInMonth)
  const periodEnd   = new Date(my.year, my.month - 1, day)
  const periodStart = addDays(subMonths(periodEnd, 1), 1)
  return {
    from: format(periodStart, 'yyyy-MM-dd'),
    to:   format(periodEnd,   'yyyy-MM-dd'),
  }
}

// TAKVİM günü farkı — duvar saatinden bağımsız. differenceInDays kullanılamaz:
// hedefin gece yarısını şimdiki SAATLE kıyaslayıp kesirli günü kırpıyor, yani
// öğleden sonra "yarın" 0, 7 gün sonrası 6 çıkıyordu (abonelikte "bugün" yazan,
// borç kartında "6g" gösteren hata).
export function daysUntil(iso: string): number {
  return differenceInCalendarDays(parseISO(iso), new Date())
}

export function getPeriodRange(type: PeriodType): { from: string; to: string } {
  return getPeriodRangeAt(type, 0)
}

/** Period range shifted by `offset` periods from now (offset 0 = current period,
 *  -1 = previous, +1 = next). 'all' ignores the offset. */
export function getPeriodRangeAt(type: PeriodType, offset: number): { from: string; to: string } {
  const now = new Date()
  switch (type) {
    case 'daily': {
      const d = addDays(now, offset)
      return { from: format(d, 'yyyy-MM-dd'), to: format(d, 'yyyy-MM-dd') }
    }
    case 'weekly': {
      const d = addWeeks(now, offset)
      return {
        from: format(startOfWeek(d, { locale: tr }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(d,   { locale: tr }), 'yyyy-MM-dd'),
      }
    }
    case 'monthly': {
      const d = addMonths(now, offset)
      return {
        from: format(startOfMonth(d), 'yyyy-MM-dd'),
        to:   format(endOfMonth(d),   'yyyy-MM-dd'),
      }
    }
    case 'yearly': {
      const d = addYears(now, offset)
      return {
        from: format(startOfYear(d), 'yyyy-MM-dd'),
        to:   format(endOfYear(d),   'yyyy-MM-dd'),
      }
    }
    case 'all':
      return { from: '1900-01-01', to: '2099-12-31' }
  }
}

/** Human label for the period at `offset` — e.g. "Temmuz 2026", "2026", "14 Tem – 20 Tem". */
export function formatPeriodLabel(type: PeriodType, offset: number): string {
  const { from, to } = getPeriodRangeAt(type, offset)
  switch (type) {
    case 'daily':   return format(parseISO(from), 'd MMMM yyyy', { locale: tr })
    case 'weekly':  return `${format(parseISO(from), 'd MMM', { locale: tr })} – ${format(parseISO(to), 'd MMM', { locale: tr })}`
    case 'monthly': return format(parseISO(from), 'MMMM yyyy', { locale: tr })
    case 'yearly':  return format(parseISO(from), 'yyyy')
    case 'all':     return ''
  }
}

export function getPrevPeriodRange(type: PeriodType): { from: string; to: string } | null {
  const now = new Date()
  switch (type) {
    case 'daily':
      return { from: format(subDays(now, 1), 'yyyy-MM-dd'), to: format(subDays(now, 1), 'yyyy-MM-dd') }
    case 'weekly': {
      const prevWeekDay = subWeeks(now, 1)
      return {
        from: format(startOfWeek(prevWeekDay, { locale: tr }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(prevWeekDay,   { locale: tr }), 'yyyy-MM-dd'),
      }
    }
    case 'monthly': {
      const prev = subMonths(now, 1)
      return { from: format(startOfMonth(prev), 'yyyy-MM-dd'), to: format(endOfMonth(prev), 'yyyy-MM-dd') }
    }
    case 'yearly': {
      const prev = subYears(now, 1)
      return { from: format(startOfYear(prev), 'yyyy-MM-dd'), to: format(endOfYear(prev), 'yyyy-MM-dd') }
    }
    case 'all':
      return null
  }
}

// [bugün, bugün+days] takvim aralığı — isOverdue ile birlikte BOŞLUK bırakmaz.
// Saat bazlı isAfter(d, now) karşılaştırması bugün vadesi geleni dışlıyordu:
// dueSoon=false + overdue=false → vade günü hiçbir uyarıda görünmüyordu.
export function isDueSoon(iso: string, days = 7): boolean {
  const d = differenceInCalendarDays(parseISO(iso), new Date())
  return d >= 0 && d <= days
}

export function isOverdue(iso: string): boolean {
  // Overdue only if strictly before the start of today — a debt due today is not overdue
  return isBefore(parseISO(iso), startOfDay(new Date()))
}

// Generate list of last N months
export function lastNMonths(n: number): MonthYear[] {
  const result: MonthYear[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = subMonths(new Date(), i)
    result.push({ month: d.getMonth() + 1, year: d.getFullYear() })
  }
  return result
}
