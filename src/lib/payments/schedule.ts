/* ────────────────────────────────────────────────────────────────────────
   Ödeme takibi — kredi kartı ve borç ödemelerinin aylık çizelgesi

   SAF modül (store/DB yok). Bir "hedef" ya bir kredi kartı hesabıdır ya da bir
   borç (direction 'owe'). Her hedef için her ay tek bir ödeme satırı üretilir;
   satırın değerleri katmanlardan çözülür (üstteki kazanır):
     1. PaymentOccurrence — kullanıcının O AY için girdiği tutar/tarih/hesap
     2. PaymentPlan       — hedefin varsayılanları
     3. Borç alanları     — yalnız BORÇTA: monthlyPayment / accountId /
                            startDate günü (bunları kullanıcı borç formunda girer)

   KARTLARDA VARSAYIM YOK (2026-09-11 kararı): kart formu son ödeme gününü ve
   ekstre tutarını SORMUYOR (dueDay her karta 10 yazılıyor), dolayısıyla onlardan
   türetilen gün/tutar kullanıcıya yanlış bilgi gösteriyordu. Kartın ödeme günü
   yalnızca plandan gelir; plan günü yoksa kart "kurulum bekliyor" (needsSetup)
   olur ve HİÇ satır üretmez — gecikme, rozet ve toplamlara girmez. Tutar yalnızca
   plan ya da ay kaydından gelir; yoksa null ("tutar girilmedi"). Uygulamadaki
   harcamalardan hesaplanan dönem toplamı (estimateStatement) sadece düzenleme
   penceresinde etiketli bir KISAYOL olarak kullanılır, satır tutarı olmaz.

   "Ödendi" iki kaynaktan gelir: elle işaret (occurrence.status) ya da OTOMATİK
   TESPİT — o ayın ödeme penceresine düşen, karta yapılmış transferler ve borca
   bağlı (debtId) işlemler. Tespit hiçbir şey yazmaz.

   Takip başlangıcından (startMonth) önceki ve borcun son taksitinden sonraki
   aylar AÇIK satır üretmez: modül ilk açıldığında geçmiş aylar için yığınla
   yanlış "gecikti" alarmı çıkmasın. Ödenmiş/atlanmış olanlar geçmiş kaydı
   olarak yine görünür.
──────────────────────────────────────────────────────────────────────── */

import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type {
  Account, CurrencyCode, Debt, PaymentOccurrence, PaymentPlan, PaymentTargetKind, Transaction,
} from '@/types'
import { roundMoney, sumBy } from '@/lib/utils/money'
import { baseAmount, fromBaseTry, toBaseTry } from '@/lib/utils/fx'
import { isPosted } from '@/lib/utils/calculations'

export { planIdFor, occurrenceIdFor } from './ids'

/** 'YYYY-MM' */
export type MonthKey = string

/** Plan başlangıcı verilmemiş hedefler bu aydan önce gecikme üretmez (modülün
 *  yayına girdiği ay). Sabit olmalı: "bugünün ayı" olsaydı her ay başında
 *  önceki ay takip dışına düşerdi. */
export const TRACKING_EPOCH: MonthKey = '2026-09'
/** Bu kadar gün içinde vadesi gelen ödeme "yaklaşıyor" sayılır. */
export const DUE_SOON_DAYS = 7
/** Ödeme penceresi vade gününden bu kadar gün sonrasına uzar (geç ödeme). */
export const DETECT_GRACE_DAYS = 7
/** Borç hedeflerinin rengi — borçların kendi rengi yok. */
export const DEBT_COLOR = '#64748b'

/* ── Ay yardımcıları ─────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0')

export function monthOf(iso: string): MonthKey {
  return iso.slice(0, 7)
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

/** a'dan b'ye kaç ay (b − a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

/** [from, to] aralığındaki aylar (ikisi dahil). */
export function monthKeys(from: MonthKey, to: MonthKey): MonthKey[] {
  const n = monthDiff(from, to)
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => shiftMonth(from, i))
}

export function daysInMonth(month: MonthKey): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
}

export function clampDay(day: number): number {
  return Math.min(31, Math.max(1, Math.round(day)))
}

/** Ayın `day`. günü; kısa aylarda ay sonuna sıkıştırılır (31 → 30 Eylül). */
export function dueDateFor(month: MonthKey, day: number): string {
  return `${month}-${pad(Math.min(clampDay(day), daysInMonth(month)))}`
}

function addDaysIso(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), 'yyyy-MM-dd')
}

const maxMonth = (a: MonthKey, b: MonthKey) => (a > b ? a : b)

/* ── Hedefler ────────────────────────────────────────────────────────────── */

export type AmountSource = 'custom' | 'plan' | 'derived' | null

export interface PaymentTarget {
  key: string                      // `${kind}:${id}`
  kind: PaymentTargetKind
  id: string
  name: string
  color: string
  icon?: string
  currency: CurrencyCode
  plan: PaymentPlan | null
  isActive: boolean
  /** Plandaki ya da borçtan türetilen aylık tutar. Kartta plan tutarı yoksa
   *  null — o zaman tutar her ay ayrıca girilir. */
  defaultAmount: number | null
  defaultAmountSource: AmountSource
  defaultFromAccountId: string | null
  /** Kartta yalnız plandan gelir; null = ödeme günü girilmedi. */
  dayOfMonth: number | null
  /** Kart ödeme günü girilmedi → satır üretilmez, kurulum istenir. */
  needsSetup: boolean
  startMonth: MonthKey
  endMonth: MonthKey | null
  /** Kart: uygulamadaki bakiyeye göre borç (−bakiye, ≥ 0) — bankadaki gerçek
   *  borç DEĞİL. Borç: kalan tutar. */
  outstanding: number
  account?: Account
  debt?: Debt
}

export function buildTargets(input: {
  accounts: readonly Account[]
  debts: readonly Debt[]
  plans: readonly PaymentPlan[]
}): PaymentTarget[] {
  const planBy = new Map(input.plans.map(p => [`${p.targetKind}:${p.targetId}`, p]))
  const cards: PaymentTarget[] = []
  const debts: PaymentTarget[] = []

  for (const a of input.accounts) {
    if (a.type !== 'credit_card' || a.isArchived) continue
    const plan = planBy.get(`card:${a.id}`) ?? null
    const created = a.createdAt ? monthOf(a.createdAt) : TRACKING_EPOCH
    // account.dueDay KULLANILMAZ: formda alanı yok, her karta 10 yazılıyor.
    const day = plan?.dayOfMonth != null ? clampDay(plan.dayOfMonth) : null
    cards.push({
      key: `card:${a.id}`,
      kind: 'card',
      id: a.id,
      name: a.name,
      color: a.color,
      icon: a.icon,
      currency: a.currency,
      plan,
      isActive: plan?.isActive ?? true,
      defaultAmount: plan?.amount ?? null,
      defaultAmountSource: plan?.amount != null ? 'plan' : null,
      defaultFromAccountId: plan?.fromAccountId ?? null,
      dayOfMonth: day,
      needsSetup: day === null,
      startMonth: plan?.startMonth ?? maxMonth(TRACKING_EPOCH, created),
      endMonth: null,
      outstanding: Math.max(0, roundMoney(-(a.balance ?? 0))),
      account: a,
    })
  }

  for (const d of input.debts) {
    if (d.direction !== 'owe') continue
    const plan = planBy.get(`debt:${d.id}`) ?? null
    const first = monthOf(d.startDate)
    const derived = d.monthlyPayment
      ?? (d.totalInstallments ? roundMoney(d.totalAmount / d.totalInstallments) : null)
    const startDay = Number(d.startDate.slice(8, 10))
    debts.push({
      key: `debt:${d.id}`,
      kind: 'debt',
      id: d.id,
      name: d.name,
      color: DEBT_COLOR,
      currency: 'TRY', // borçlar TRY bazlı (bkz. debts.store recordPayment)
      plan,
      isActive: plan?.isActive ?? true,
      defaultAmount: plan?.amount ?? derived,
      defaultAmountSource: plan?.amount != null ? 'plan' : derived != null ? 'derived' : null,
      defaultFromAccountId: plan?.fromAccountId ?? d.accountId ?? null,
      dayOfMonth: clampDay(plan?.dayOfMonth ?? (startDay > 0 ? startDay : 1)),
      needsSetup: false,
      startMonth: plan?.startMonth ?? maxMonth(TRACKING_EPOCH, first),
      endMonth: d.totalInstallments ? shiftMonth(first, d.totalInstallments - 1) : null,
      outstanding: Math.max(0, roundMoney(d.totalAmount - d.paidAmount)),
      debt: d,
    })
  }

  const byName = (a: PaymentTarget, b: PaymentTarget) => a.name.localeCompare(b.name, 'tr')
  return [...cards.sort(byName), ...debts.sort(byName)]
}

/* ── Uygulamadaki kart harcamaları (yalnız kısayol önerisi) ─────────────── */

function inCurrency(t: Transaction, currency: CurrencyCode): number {
  return t.currency === currency ? t.amount : fromBaseTry(baseAmount(t), currency)
}

/** Vade gününden ÖNCEKİ son hesap kesiminde kapanan dönem. Kesim günü yoksa
 *  vadeden önceki takvim ayı. */
export function statementWindow(
  account: Pick<Account, 'statementDay'>,
  dueDate: string,
): { from: string; to: string } {
  const dueMonth = monthOf(dueDate)
  if (!account.statementDay) {
    const prev = shiftMonth(dueMonth, -1)
    return { from: `${prev}-01`, to: dueDateFor(prev, 31) }
  }
  let closing = dueDateFor(dueMonth, account.statementDay)
  if (closing >= dueDate) closing = dueDateFor(shiftMonth(dueMonth, -1), account.statementDay)
  const prevClosing = dueDateFor(shiftMonth(monthOf(closing), -1), account.statementDay)
  return { from: addDaysIso(prevClosing, 1), to: closing }
}

/** Dönemde UYGULAMAYA GİRİLMİŞ net kart harcaması: gider + karttan çıkan
 *  transfer − karta işlenen gelir/iade. Karta YAPILAN ödemeler (toAccountId =
 *  kart) ve mutabakat satırları sayılmaz. Bankanın ekstre tutarı değildir —
 *  yalnız düzenleme penceresinde etiketli kısayol olarak gösterilir. */
export function estimateStatement(
  account: Account,
  dueDate: string,
  transactions: readonly Transaction[],
): number {
  const { from, to } = statementWindow(account, dueDate)
  const charges = transactions.filter(t => {
    if (t.accountId !== account.id || t.systemKind) return false
    const d = t.date.slice(0, 10)
    return d >= from && d <= to
  })
  const total = sumBy(charges, t => (t.type === 'income' ? -1 : 1) * inCurrency(t, account.currency))
  return Math.max(0, total)
}

/* ── Ödeme satırları ─────────────────────────────────────────────────────── */

export type PaymentState =
  | 'open'     // ödenmedi
  | 'partial'  // bir kısmı ödendi (tespit)
  | 'paid'
  | 'skipped'  // bu ay ödeme yok (kullanıcı atladı)
  | 'clear'    // ödenecek tutar yok (kullanıcı 0 girdi)

export type PaymentTiming = 'overdue' | 'today' | 'soon' | 'later' | 'done'

export interface PaymentRow {
  id: string                       // occurrenceIdFor(kind, targetId, month)
  target: PaymentTarget
  month: MonthKey
  dueDate: string
  /** Bugünden vadeye takvim günü (negatif = geçti). */
  daysLeft: number
  /** Hedefin para biriminde. null = tutar girilmedi. */
  amount: number | null
  amountSource: AmountSource
  fromAccountId: string | null
  state: PaymentState
  timing: PaymentTiming
  paidAmount: number
  paidDate: string | null
  paidVia: 'manual' | 'detected' | null
  /** Elle bağlanmış ya da otomatik tespit edilen ödeme işlemleri. */
  transactionIds: string[]
  /** Kalan ödenecek (açık/kısmi satırlarda; diğerlerinde 0). */
  remaining: number
  custom: { amount: boolean; dueDate: boolean; fromAccount: boolean }
  /** Takip aralığı dışında (yalnız geçmiş kaydı olarak görünür). */
  outOfRange: boolean
  note: string | null
  occurrence: PaymentOccurrence | null
}

export function isActionable(row: Pick<PaymentRow, 'state'>): boolean {
  return row.state === 'open' || row.state === 'partial'
}

function isPaymentFor(target: PaymentTarget, t: Transaction): boolean {
  return target.kind === 'card'
    ? t.type === 'transfer' && t.toAccountId === target.id
    : t.debtId === target.id
}

function paymentValue(target: PaymentTarget, t: Transaction): number {
  return target.kind === 'card' ? inCurrency(t, target.currency) : baseAmount(t)
}

const occKey = (kind: PaymentTargetKind, targetId: string, month: MonthKey) => `${kind}:${targetId}:${month}`

export interface ScheduleInput {
  targets: readonly PaymentTarget[]
  occurrences: readonly PaymentOccurrence[]
  transactions: readonly Transaction[]
  from: MonthKey
  to: MonthKey
  todayStr: string
}

/** [from, to] aylarındaki ödeme satırları, vade tarihine göre sıralı.
 *  Pasif (takipten çıkarılmış) ve ödeme günü girilmemiş hedefler satır üretmez. */
export function buildSchedule(input: ScheduleInput): PaymentRow[] {
  const { targets, occurrences, transactions, from, to, todayStr } = input
  if (monthDiff(from, to) < 0) return []

  const occBy = new Map<string, PaymentOccurrence>()
  const linked = new Set<string>()
  for (const o of occurrences) {
    occBy.set(occKey(o.targetKind, o.targetId, o.month), o)
    if (o.transactionId) linked.add(o.transactionId)
  }

  const rows: PaymentRow[] = []

  for (const target of targets) {
    const day = target.dayOfMonth
    if (!target.isActive || day === null) continue
    // Yalnız işlenmiş ödemeler "ödendi" sayılır — ileri tarihli planlı transfer
    // henüz ödeme değildir.
    const payments = transactions.filter(t => isPaymentFor(target, t) && isPosted(t, todayStr))
    // Borç: kalan tutarın, sıradaki açık aylara zaten ayrılmış kısmı. Takip
    // başlangıcından yürümek için gezinti aralığın başından ÖNCE başlayabilir.
    let consumed = 0
    const walkFrom = from < target.startMonth ? from : target.startMonth

    for (const month of monthKeys(walkFrom, to)) {
      const occ = occBy.get(occKey(target.kind, target.id, month)) ?? null
      const prev = shiftMonth(month, -1)
      const dueDate = occ?.dueDate ?? dueDateFor(month, day)
      const prevDue = occBy.get(occKey(target.kind, target.id, prev))?.dueDate
        ?? dueDateFor(prev, day)
      const tracked = month >= target.startMonth
        && (target.endMonth === null || month <= target.endMonth)

      // Ödeme penceresi (önceki vade + ek süre, bu vade + ek süre] — ardışık
      // aylar örtüşmez, arada boşluk da kalmaz. Elle bir aya bağlanmış işlem
      // başka ayda tespit edilmez.
      const winFrom = addDaysIso(prevDue, DETECT_GRACE_DAYS)
      const winTo   = addDaysIso(dueDate, DETECT_GRACE_DAYS)
      const detected = payments.filter(t => {
        if (linked.has(t.id)) return false
        const d = t.date.slice(0, 10)
        return d > winFrom && d <= winTo
      })
      const detectedSum = sumBy(detected, t => paymentValue(target, t))

      let amount: number | null = null
      let amountSource: AmountSource = null
      if (occ?.amount != null) {
        amount = occ.amount
        amountSource = 'custom'
      } else if (target.defaultAmount !== null) {
        amount = target.defaultAmount
        amountSource = target.defaultAmountSource
      }

      let state: PaymentState
      let paidAmount = 0
      let paidDate: string | null = null
      let paidVia: PaymentRow['paidVia'] = null
      let transactionIds: string[] = []

      if (occ?.status === 'paid') {
        state = 'paid'
        paidVia = 'manual'
        paidAmount = occ.paidAmount ?? amount ?? 0
        paidDate = occ.paidDate ?? null
        transactionIds = occ.transactionId ? [occ.transactionId] : []
      } else if (occ?.status === 'skipped') {
        state = 'skipped'
      } else if (detectedSum > 0) {
        paidVia = 'detected'
        paidAmount = detectedSum
        paidDate = detected.reduce((m, t) => (t.date.slice(0, 10) > m ? t.date.slice(0, 10) : m), '')
        transactionIds = detected.map(t => t.id)
        state = amount === null || detectedSum >= amount ? 'paid' : 'partial'
      } else {
        state = amount === 0 ? 'clear' : 'open'
      }

      let remaining = isActionable({ state }) && amount !== null
        ? Math.max(0, roundMoney(amount - paidAmount))
        : 0

      // Borç: kalan tutar tükenince açık aylar biter, son taksit küçülür.
      if (target.kind === 'debt' && tracked && isActionable({ state }) && amount !== null) {
        const cap = Math.max(0, roundMoney(target.outstanding - consumed))
        if (remaining > cap) {
          remaining = cap
          amount = roundMoney(paidAmount + cap)
          if (remaining === 0) state = state === 'partial' ? 'paid' : 'clear'
        }
        consumed = roundMoney(consumed + remaining)
      }

      if (month < from) continue

      const actionable = isActionable({ state })
      if (!occ) {
        // Takip dışı açık ay ya da tükenmiş borç: satır yok.
        if (!tracked && (actionable || state === 'clear')) continue
        if (target.kind === 'debt' && state === 'clear') continue
      }

      const daysLeft = differenceInCalendarDays(parseISO(dueDate), parseISO(todayStr))
      const timing: PaymentTiming = actionable && tracked
        ? daysLeft < 0 ? 'overdue'
          : daysLeft === 0 ? 'today'
            : daysLeft <= DUE_SOON_DAYS ? 'soon'
              : 'later'
        : 'done'

      rows.push({
        id: occ?.id ?? `${target.key}:${month}`,
        target,
        month,
        dueDate,
        daysLeft,
        amount,
        amountSource,
        fromAccountId: occ?.fromAccountId ?? target.defaultFromAccountId,
        state,
        timing,
        paidAmount,
        paidDate,
        paidVia,
        transactionIds,
        remaining,
        custom: {
          amount: occ?.amount != null,
          dueDate: occ?.dueDate != null,
          fromAccount: occ?.fromAccountId != null,
        },
        outOfRange: !tracked,
        note: occ?.note ?? null,
        occurrence: occ,
      })
    }
  }

  return rows.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || a.target.name.localeCompare(b.target.name, 'tr'))
}

/* ── Özet ────────────────────────────────────────────────────────────────── */

export interface PaymentSummary {
  count: number
  /** Ödenecek toplam (atlananlar hariç; ödenen tutar planı aştıysa ödenen). */
  totalTry: number
  paidTry: number
  remainingTry: number
  overdueCount: number
  overdueTry: number
  /** Tutarı girilmemiş açık satır sayısı — toplamlara girmez. */
  unknownCount: number
  /** Vadesi geçmemiş en yakın açık ödeme. */
  next: PaymentRow | null
}

export function summarizeRows(rows: readonly PaymentRow[]): PaymentSummary {
  const live = rows.filter(r => r.state !== 'skipped')
  const open = rows.filter(isActionable)
  const overdue = open.filter(r => r.timing === 'overdue')
  const tryOf = (r: PaymentRow, v: number) => toBaseTry(v, r.target.currency)
  return {
    count: rows.length,
    totalTry: sumBy(live, r => tryOf(r, Math.max(r.amount ?? 0, r.paidAmount))),
    paidTry: sumBy(live, r => tryOf(r, r.paidAmount)),
    remainingTry: sumBy(open, r => tryOf(r, r.remaining)),
    overdueCount: overdue.length,
    overdueTry: sumBy(overdue, r => tryOf(r, r.remaining)),
    unknownCount: open.filter(r => r.amount === null).length,
    next: open
      .filter(r => r.timing !== 'overdue' && r.timing !== 'done')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null,
  }
}
