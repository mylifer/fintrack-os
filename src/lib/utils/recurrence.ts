import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import type { RecurringTransaction, RecurringFrequency } from '@/types'

// Pure recurrence math — no store/DB/supabase imports, so it is safe to use from
// analytics/forecast utils and unit tests without booting a Supabase client.

export function advanceDueDate(current: string, frequency: RecurringFrequency): string {
  const d = parseISO(current)
  switch (frequency) {
    case 'daily':   return format(addDays(d, 1),   'yyyy-MM-dd')
    case 'weekly':  return format(addWeeks(d, 1),  'yyyy-MM-dd')
    case 'monthly': return format(addMonths(d, 1), 'yyyy-MM-dd')
    case 'yearly':  return format(addYears(d, 1),  'yyyy-MM-dd')
  }
}

const OCCURRENCE_CAP = 1000 // runaway guard for a very stale nextDueDate

/** Every occurrence date from nextDueDate up to & including asOf (endDate-aware).
 *  Drives catch-up generation: months offline → one transaction per missed
 *  period, not a single one. */
export function recurringOccurrences(r: RecurringTransaction, asOf: string): string[] {
  const out: string[] = []
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && (!r.endDate || d <= r.endDate) && guard < OCCURRENCE_CAP) {
    out.push(d)
    d = advanceDueDate(d, r.frequency)
    guard++
  }
  return out
}

/** First occurrence strictly after asOf — the new nextDueDate after (re)processing. */
export function nextDueAfter(r: RecurringTransaction, asOf: string): string {
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && guard < OCCURRENCE_CAP) {
    d = advanceDueDate(d, r.frequency)
    guard++
  }
  return d
}
