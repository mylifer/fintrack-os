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

export type MonthKey = string   // 'YYYY-MM'

export interface CardDays {
  /** 1–31, kesim günü; null = takvim ayı sonu */
  statementDay: number | null
  /** 1–31, varsayılan son ödeme günü; null = bilinmiyor */
  dueDay: number | null
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

function closingAndDue(days: CardDays, month: MonthKey, ov?: CycleOverride | null) {
  const dueDate = ov?.dueDate ?? (days.dueDay ? dayOf(month, days.dueDay) : null)
  const defaultClosing = dueDate
    ? lastClosingBefore(dueDate, days.statementDay)
    : dayOf(month, days.statementDay ?? 31)
  const closing = ov?.statementDate ?? defaultClosing
  return { closing, dueDate, closingCustom: !!ov?.statementDate, dueCustom: !!ov?.dueDate }
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
