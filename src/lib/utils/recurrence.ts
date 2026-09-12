import { addDays, addWeeks, addMonths, addYears, format, parseISO } from 'date-fns'
import type { RecurringTransaction, RecurringFrequency } from '@/types'

// Pure recurrence math — no store/DB/supabase imports, so it is safe to use from
// analytics/forecast utils and unit tests without booting a Supabase client.

/** Ay/yıl adımlarının döneceği gün — şablonun BAŞLANGIÇ TARİHİNİN günü.
 *  Formdaki eski "Ayın Günü" (dayOfMonth) alanı takvimde hiç okunmadı; gün hep
 *  başlangıç tarihinden geldi, bu yüzden alan kaldırıldı. */
export function anchorDayOf(r: Pick<RecurringTransaction, 'startDate'>): number | undefined {
  const day = Number(r.startDate?.slice(8, 10))
  return day >= 1 && day <= 31 ? day : undefined
}

function withDayClamped(d: Date, day: number): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth(), Math.min(day, last))
}

/* Ay/yıl adımında date-fns ayın son gününe kırpar (31 Ocak + 1 ay = 28 Şubat).
   Sonuç nextDueDate olarak KALICI yazıldığı için şablon eskiden 31'ine bir daha
   dönmüyordu (denetim #17). `anchorDay` verilirse kırpılmış tarih çapa güne geri
   taşınır. Koşul bilerek dar: yalnızca 28+ bir gün çapadan küçükse — kırpmanın
   bırakabileceği tek iz budur (28/29/30 → çapa 29/30/31). Başka nedenle çapadan
   farklı duran eski bir nextDueDate kaydırılmaz. */
export function advanceDueDate(current: string, frequency: RecurringFrequency, anchorDay?: number): string {
  const d = parseISO(current)
  switch (frequency) {
    case 'daily':   return format(addDays(d, 1),   'yyyy-MM-dd')
    case 'weekly':  return format(addWeeks(d, 1),  'yyyy-MM-dd')
    case 'monthly':
    case 'yearly': {
      const next = frequency === 'monthly' ? addMonths(d, 1) : addYears(d, 1)
      const cur  = d.getDate()
      const day  = anchorDay !== undefined && anchorDay > cur && cur >= 28 ? anchorDay : cur
      return format(withDayClamped(next, day), 'yyyy-MM-dd')
    }
  }
}

const OCCURRENCE_CAP = 1000 // runaway guard for a very stale nextDueDate

/** Every occurrence date from nextDueDate up to & including asOf (endDate-aware).
 *  Drives catch-up generation: months offline → one transaction per missed
 *  period, not a single one. */
export function recurringOccurrences(r: RecurringTransaction, asOf: string): string[] {
  const anchor = anchorDayOf(r)
  const out: string[] = []
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && (!r.endDate || d <= r.endDate) && guard < OCCURRENCE_CAP) {
    out.push(d)
    d = advanceDueDate(d, r.frequency, anchor)
    guard++
  }
  return out
}

/** First occurrence strictly after asOf — the new nextDueDate after (re)processing. */
export function nextDueAfter(r: RecurringTransaction, asOf: string): string {
  const anchor = anchorDayOf(r)
  let d = r.nextDueDate
  let guard = 0
  while (d <= asOf && guard < OCCURRENCE_CAP) {
    d = advanceDueDate(d, r.frequency, anchor)
    guard++
  }
  return d
}
