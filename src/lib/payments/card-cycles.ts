/* ── Kredi kartı döngüleri: ay ay kesim ve son ödeme tarihi ─────────────────
   Tek doğruluk kaynağı: Kart Takvimi paneli, hesap sayfasındaki ekstre ve
   Ödeme Takibi (ekstre penceresi) tarihleri buradan alır.

   Döngü, ÖDEME AYIYLA anılır (Ödeme Takibi'nin ay kaydıyla aynı anahtar):
   "2026-10" = son ödemesi Ekim'de olan ekstre. Kesimi Eylül'de de olabilir
   (kesim 24, son ödeme 4) Ekim'de de (kesim 11, son ödeme 16).

   Tarihler:
     son ödeme = o ayın özel tarihi (PaymentOccurrence.dueDate) ?? ayın
                 varsayılan son ödeme günü (plan.dayOfMonth)
     kesim     = o ayın özel tarihi (PaymentOccurrence.statementDate) ?? son
                 ödemeden ÖNCEKİ son varsayılan kesim günü (account.statementDay)
     dönem     = önceki döngünün kesiminin ertesi günü → bu kesim
   Kesim günü girilmemişse takvim ayı sonu sayılır (statementWindow'un eski
   kuralı). Son ödeme günü bilinmiyorsa döngü kesim ayıyla anılır ve son
   ödeme boş kalır — varsayım yapılmaz. Kısa aylarda gün ay sonuna sıkışır.
   Saf modül: store/DB yok. */

import { isBusinessDay, nextBusinessDay } from './tr-holidays'

export type MonthKey = string   // 'YYYY-MM'

/** Son ödeme tatile denk gelirse: 'due' yalnız son ödeme ilk iş gününe kayar;
 *  'both' kesim de aynı gün sayısı kadar kayar; 'none' kaydırma yok. */
export type HolidayRule = 'due' | 'both' | 'none'

export interface CardDays {
  /** 1–31, kesim günü; null = takvim ayı sonu */
  statementDay: number | null
  /** 1–31, sabit son ödeme günü (gapDays yoksa kullanılır); null = bilinmiyor */
  dueDay: number | null
  /** Kesimden son ödemeye gün (bankalarda 10). Varsa son ödeme her ay kesim +
   *  fark'tan hesaplanır — ay uzunluğuna göre günü değişir (24 Ocak → 3 Şubat,
   *  24 Şubat → 6 Mart), bankaların uyguladığı gibi. */
  gapDays?: number | null
  holidayRule?: HolidayRule
}

export interface CycleOverride {
  statementDate?: string | null
  dueDate?: string | null
}

export interface CardCycle {
  month: MonthKey
  /** Dönem başı (önceki kesimin ertesi) */
  from: string
  /** Kesim tarihi (dönem sonu, dahil) */
  closing: string
  dueDate: string | null
  closingCustom: boolean
  dueCustom: boolean
  /** Tatil / hafta sonu nedeniyle nominal günden kaydırıldı */
  closingShifted: boolean
  dueShifted: boolean
  /** Kesim son ödemeden önce değil — büyük olasılıkla yanlış girilmiş */
  invalid: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

function daysIn(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function shiftMonthKey(month: MonthKey, delta: number): MonthKey {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

/** Ayın `day`'i, kısa ayda ay sonuna sıkıştırılmış. */
export function dayOf(month: MonthKey, day: number): string {
  return `${month}-${pad(Math.min(Math.max(1, day), daysIn(month)))}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** `before` tarihinden ÖNCEKİ son kesim günü. */
export function lastClosingBefore(before: string, statementDay: number | null): string {
  const month = before.slice(0, 7)
  const day = statementDay ?? 31
  const same = dayOf(month, day)
  return same < before ? same : dayOf(shiftMonthKey(month, -1), day)
}

/** Tatil kuralı uygulanmamış tarihler. Fark modunda ödeme ayı M'nin ekstresi,
 *  kesim günü + fark 30'u aşıyorsa bir önceki ayın kesimidir (24 + 10 → Eylül
 *  kesimi Ekim'de ödenir), aşmıyorsa aynı ayınki (11 + 10 → Ekim'de kesilip
 *  ödenir) — her ödeme ayına tam bir ekstre düşer. */
function nominal(days: CardDays, month: MonthKey): { closing: string; due: string | null } {
  if (days.gapDays && days.statementDay) {
    const closingMonth = shiftMonthKey(month, days.statementDay + days.gapDays > 30 ? -1 : 0)
    const closing = dayOf(closingMonth, days.statementDay)
    return { closing, due: addDays(closing, days.gapDays) }
  }
  const due = days.dueDay ? dayOf(month, days.dueDay) : null
  return { closing: due ? lastClosingBefore(due, days.statementDay) : dayOf(month, days.statementDay ?? 31), due }
}

function withHolidayRule(n: { closing: string; due: string | null }, rule: HolidayRule | undefined) {
  if (!n.due || !rule || rule === 'none') return { ...n, closingShifted: false, dueShifted: false }
  if (rule === 'due') {
    const due = nextBusinessDay(n.due)
    return { closing: n.closing, due, closingShifted: false, dueShifted: due !== n.due }
  }
  let { closing, due } = n
  for (let i = 0; i < 15 && !isBusinessDay(due); i++) { closing = addDays(closing, 1); due = addDays(due, 1) }
  return { closing, due, closingShifted: closing !== n.closing, dueShifted: due !== n.due }
}

function closingAndDue(days: CardDays, month: MonthKey, ov?: CycleOverride | null) {
  const n = withHolidayRule(nominal(days, month), days.holidayRule)
  return {
    closing: ov?.statementDate ?? n.closing,
    dueDate: ov?.dueDate ?? n.due,
    closingCustom: !!ov?.statementDate,
    dueCustom: !!ov?.dueDate,
    closingShifted: !ov?.statementDate && n.closingShifted,
    dueShifted: !ov?.dueDate && n.dueShifted,
  }
}

/** Tek ayın döngüsü; dönem başı için önceki ayın (özel tarihli olabilir) kesimi kullanılır. */
export function cardCycle(
  days: CardDays,
  month: MonthKey,
  override?: CycleOverride | null,
  prevOverride?: CycleOverride | null,
): CardCycle {
  const cur = closingAndDue(days, month, override)
  const prev = closingAndDue(days, shiftMonthKey(month, -1), prevOverride)
  return {
    month,
    from: addDays(prev.closing, 1),
    ...cur,
    invalid: cur.dueDate !== null && cur.closing >= cur.dueDate,
  }
}

/** `from`–`to` arası (dahil) ardışık döngüler. */
export function cardCycles(
  days: CardDays,
  overrides: ReadonlyMap<MonthKey, CycleOverride>,
  from: MonthKey,
  to: MonthKey,
): CardCycle[] {
  const out: CardCycle[] = []
  for (let m = from; m <= to; m = shiftMonthKey(m, 1)) {
    out.push(cardCycle(days, m, overrides.get(m), overrides.get(shiftMonthKey(m, -1))))
  }
  return out
}
