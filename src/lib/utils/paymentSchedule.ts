import { addDays, format, isValid, parseISO } from 'date-fns'
import type { PaymentSchedule } from '@/types'

/* ── Ödeme Takvimi — dönem çözümleme ──────────────────────────────────────
   Her takvim aylık DÖNEMLERDEN oluşur; dönemin anahtarı "YYYY-MM"dir. Bir
   dönemin son ödeme tarihi override varsa ondan, yoksa dueDay'in o ayın gün
   sayısına sabitlenmiş halinden gelir (ör. dueDay=31, Şubat'ta 28/29).

   Hatırlatma ÖDENMEMİŞ EN ESKİ döneme bakar (paidMonths). Bu yüzden bir
   dönemin tarihi override ile komşu aya kaysa bile (ör. 30 Eylül → 1 Ekim)
   dönem kaybolmaz; "vadesi geldi" durumu da ödendi işaretlenene kadar sürer
   ve işaretlenince kalkar. Debt.dueDate gibi bu da yalnızca bir HATIRLATMADIR
   — hiçbir bakiyeyi/ödeme planını etkilemez. */

export type PaymentPeriodStatus = 'overdue' | 'today' | 'upcoming' | 'normal'

/** Bildirim ve "Yaklaşan" durumu için ufuk (gün). */
export const PAYMENT_UPCOMING_DAYS = 7

// Takvim oluşturulmadan önceki dönemler hiç sayılmaz; çok eski takvimlerde de
// en fazla bu kadar ay geriye bakılır (ödenmemiş dönem aramasının sınırı).
const LOOKBACK_MONTHS = 12
// Uzun süre peşin ödenmiş takvimde açık dönem aramasının üst sınırı.
const LOOKAHEAD_MONTHS = 24

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Geçerli bir "YYYY-MM-DD" günü mü? (biçim + gerçek takvim günü) */
export function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY.test(s) && isValid(parseISO(s)) &&
    format(parseISO(s), 'yyyy-MM-dd') === s
}

/** "2026-08-31" -> "2026-08" */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

/** "2026-08" + n ay (negatif olabilir); yıl sınırını doğru sarar. */
export function addMonthsKey(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** "2026-08" -> "2026-09" */
export function nextMonthKey(monthKey: string): string {
  return addMonthsKey(monthKey, 1)
}

/** Bir ayın gün sayısına sabitlenmiş gün (ör. Şubat'ta 31 -> 28/29). Bozuk
 *  (ondalıklı/NaN) bir dueDay tarihi bozmasın diye tam sayıya indirgenir. */
function clampDayInMonth(year: number, month1to12: number, day: number): number {
  const lastDay = new Date(year, month1to12, 0).getDate()
  const d = Number.isFinite(day) ? Math.trunc(day) : 1
  return Math.min(Math.max(d, 1), lastDay)
}

/** monthKey "YYYY-MM" için dueDay'den türetilen ISO tarih (override YOK sayılır). */
export function defaultDueDateForMonth(dueDay: number, monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const day = clampDayInMonth(y, m, dueDay)
  return `${monthKey}-${String(day).padStart(2, '0')}`
}

/** monthKey "YYYY-MM" için ÇÖZÜLMÜŞ son ödeme tarihi — geçerli bir override
 *  varsa o, yoksa varsayılan. */
export function dueDateForMonth(schedule: PaymentSchedule, monthKey: string): string {
  const o = schedule.overrides?.[monthKey]
  return isIsoDay(o) ? o : defaultDueDateForMonth(schedule.dueDay, monthKey)
}

/** Bu ay için elle bir istisna (override) girilmiş mi? */
export function hasOverride(schedule: PaymentSchedule, monthKey: string): boolean {
  return isIsoDay(schedule.overrides?.[monthKey])
}

/** Dönem ödendi olarak işaretli mi? */
export function isPaid(schedule: PaymentSchedule, monthKey: string): boolean {
  return schedule.paidMonths?.[monthKey] != null
}

/** Override için izin verilen aralık (iki uç DAHİL): önceki dönemin tarihinden
 *  sonraki gün … sonraki dönemin tarihinden önceki gün. Dönemlerin sırası
 *  bozulmasın diye — kayma komşu aya taşabilir ama komşu dönemi geçemez. */
export function overrideBounds(schedule: PaymentSchedule, monthKey: string): { min: string; max: string } {
  const prev = dueDateForMonth(schedule, addMonthsKey(monthKey, -1))
  const next = dueDateForMonth(schedule, addMonthsKey(monthKey, 1))
  return { min: shiftDay(prev, 1), max: shiftDay(next, -1) }
}

/** Override doğrulaması — geçerliyse null, değilse kullanıcıya gösterilecek mesaj. */
export function validateOverride(schedule: PaymentSchedule, monthKey: string, date: string): string | null {
  if (!isIsoDay(date)) return 'Geçerli bir tarih girin.'
  const { min, max } = overrideBounds(schedule, monthKey)
  if (date < min || date > max) {
    return `Tarih önceki ve sonraki dönemin arasında olmalı (${min} – ${max}).`
  }
  return null
}

export interface ResolvedPeriod {
  /** Dönemin anahtarı — "değiştir"/"ödendi" aksiyonları bu dönem için yazar. */
  monthKey: string
  /** Dönemin çözülmüş son ödeme tarihi. */
  date: string
  status: PaymentPeriodStatus
  /** date - asOf (gün). Negatif = geçmiş. */
  daysDelta: number
  /** Tarihi asOf'a gelmiş/geçmiş ödenmemiş dönem sayısı (bu dönem dahil). */
  unpaidDueCount: number
}

/** Takvimin asOf itibarıyla ilgilenilmesi gereken dönemi: ödenmemiş en eski
 *  dönem (oluşturulmadan önceki dönemler hariç). */
export function resolvePeriod(schedule: PaymentSchedule, asOf: string): ResolvedPeriod {
  const asOfKey = monthKeyOf(asOf)
  const createdDay = localDayOf(schedule.createdAt)

  let mk = addMonthsKey(asOfKey, -LOOKBACK_MONTHS)
  if (createdDay && monthKeyOf(createdDay) > mk) mk = monthKeyOf(createdDay)
  const end = addMonthsKey(asOfKey, LOOKAHEAD_MONTHS)

  let first: { monthKey: string; date: string } | null = null
  let unpaidDueCount = 0
  for (; mk <= end; mk = nextMonthKey(mk)) {
    if (isPaid(schedule, mk)) continue
    const date = dueDateForMonth(schedule, mk)
    if (createdDay && date < createdDay) continue
    if (!first) first = { monthKey: mk, date }
    if (date <= asOf) unpaidDueCount++
    else break // dönemler sıralı: sonrakiler de ileride
  }
  if (!first) first = { monthKey: nextMonthKey(end), date: dueDateForMonth(schedule, nextMonthKey(end)) }

  const daysDelta = daysBetween(asOf, first.date)
  const status: PaymentPeriodStatus =
    daysDelta < 0 ? 'overdue'
      : daysDelta === 0 ? 'today'
        : daysDelta <= PAYMENT_UPCOMING_DAYS ? 'upcoming'
          : 'normal'
  return { ...first, status, daysDelta, unpaidDueCount }
}

/** Aksiyon bekliyor mu (vadesi gelmiş/geçmiş ve ödenmemiş)? */
export function isPaymentDue(schedule: PaymentSchedule, asOf: string): boolean {
  if (!schedule.isActive) return false
  const s = resolvePeriod(schedule, asOf).status
  return s === 'overdue' || s === 'today'
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b + 'T00:00:00').getTime() - parseISO(a + 'T00:00:00').getTime()) / 86_400_000)
}

function shiftDay(iso: string, n: number): string {
  return format(addDays(parseISO(iso + 'T00:00:00'), n), 'yyyy-MM-dd')
}

// createdAt tam bir ISO zaman damgasıdır (UTC). Takvim günü YEREL saate göre
// alınır: TR'de 01:00'de oluşturulan takvimin günü UTC'deki önceki gün değil.
function localDayOf(ts: string | undefined): string | null {
  if (!ts) return null
  const d = parseISO(ts)
  return isValid(d) ? format(d, 'yyyy-MM-dd') : null
}
