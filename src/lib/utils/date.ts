import {
  format, parseISO, startOfMonth, endOfMonth,
  subMonths, addMonths, isWithinInterval, startOfYear, endOfYear,
  differenceInDays, isAfter, isBefore, addDays, subDays, subWeeks, subYears,
  startOfWeek, endOfWeek,
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
  return isWithinInterval(parseISO(date), {
    start: parseISO(from),
    end:   parseISO(to),
  })
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
  const day = account.statementDay ?? 1
  const periodEnd   = new Date(my.year, my.month - 1, day)
  const periodStart = addDays(subMonths(periodEnd, 1), 1)
  return {
    from: format(periodStart, 'yyyy-MM-dd'),
    to:   format(periodEnd,   'yyyy-MM-dd'),
  }
}

export function daysUntil(iso: string): number {
  return differenceInDays(parseISO(iso), new Date())
}

export function getPeriodRange(type: PeriodType): { from: string; to: string } {
  const now = new Date()
  switch (type) {
    case 'daily':
      return { from: format(now, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') }
    case 'weekly':
      return {
        from: format(startOfWeek(now, { locale: tr }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(now,   { locale: tr }), 'yyyy-MM-dd'),
      }
    case 'monthly':
      return {
        from: format(startOfMonth(now), 'yyyy-MM-dd'),
        to:   format(endOfMonth(now),   'yyyy-MM-dd'),
      }
    case 'yearly':
      return {
        from: format(startOfYear(now), 'yyyy-MM-dd'),
        to:   format(endOfYear(now),   'yyyy-MM-dd'),
      }
    case 'all':
      return { from: '1900-01-01', to: '2099-12-31' }
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

export function isDueSoon(iso: string, days = 7): boolean {
  const d = parseISO(iso)
  const now = new Date()
  return isAfter(d, now) && isBefore(d, addDays(now, days))
}

export function isOverdue(iso: string): boolean {
  return isBefore(parseISO(iso), new Date())
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
