import type { Account, Transaction } from '@/types'
import { isPosted } from './calculations'
import { baseAmount, fromBaseTry } from './fx'
import { roundMoney, sumBy } from './money'

/* ── Kredi kartı ekstresi ─────────────────────────────────────────────────────
   Saf modül: kartın kesim gününe (statementDay, 1–28) göre dönemleri çıkarır ve
   her kapanmış dönem için uygulamaya GİRİLMİŞ işlemlerden bir ekstre hesaplar.
   Bankanın ekstresi değildir — uygulamada olmayan bir harcama burada da yoktur.

   Dönem: önceki kesimin ertesi günü → bu kesim günü (ikisi dahil).
   Dönem borcu: kartta gider + karttan çıkan transfer − karta işlenen iade.
     Karta YAPILAN ödemeler (assignCardPayments'ın bulduğu, Ödeme Takibi ile
     aynı kural) ve mutabakat satırları borca girmez. Onay bekleyen ya da
     tarihi gelmemiş satırlar sayılmaz (isPosted — bakiyeyle aynı kural).
   Son ödeme tarihi: kesimden SONRA gelen ilk "son ödeme günü". Gün yalnız
     ödeme planından gelir (Ödeme Takibi'nin 2026-09-11 kararı: kart formuna
     her karta 10 yazılıyordu, o değer güvenilmez); yoksa null — varsayım yok.
   Ödenen: bu karta atanmış ödemelerden kesimden sonra, son ödeme tarihi + 7
     gün (yoksa sonraki kesim) içinde olanlar.
   Asgari ödeme: dönem borcu × oran (oran girilmemişse null). */

export interface StatementPeriod {
  from: string   // ISO tarih, dahil
  to: string     // kesim günü, dahil
}

export type StatementStatus = 'clear' | 'paid' | 'partial' | 'open' | 'overdue'

export interface CardStatement {
  period: StatementPeriod
  charges: Transaction[]
  total: number
  dueDate: string | null
  minPayment: number | null
  paid: number
  status: StatementStatus
}

export interface CardStatementResult {
  /** Bugünü içeren, henüz kesilmemiş dönem */
  open: { period: StatementPeriod; charges: Transaction[]; total: number }
  /** Kapanmış dönemler, yeniden eskiye */
  statements: CardStatement[]
}

const PAY_GRACE_DAYS = 7

const pad = (n: number) => String(n).padStart(2, '0')

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Ayın `day`'i; kısa aylarda ay sonuna sıkıştırılır (31 → 30 Nisan). */
function dayInMonth(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`
}

function shift(year: number, month: number, by: number): [number, number] {
  const idx = year * 12 + (month - 1) + by
  return [Math.floor(idx / 12), (idx % 12) + 1]
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function closingOf(year: number, month: number, statementDay: number): string {
  return dayInMonth(year, month, statementDay)
}

/** Bugünü içeren açık dönem ve ondan önceki `count` kapanmış dönem (yeniden eskiye). */
export function statementPeriods(statementDay: number, todayStr: string, count: number): {
  open: StatementPeriod
  closed: StatementPeriod[]
} {
  let [y, m] = todayStr.slice(0, 7).split('-').map(Number) as [number, number]
  // Açık dönemin kesimi: bu ayın kesimi bugün ya da sonraysa o, değilse gelecek ayınki
  if (closingOf(y, m, statementDay) < todayStr.slice(0, 10)) [y, m] = shift(y, m, 1)

  const periodEndingIn = (year: number, month: number): StatementPeriod => {
    const [py, pm] = shift(year, month, -1)
    return { from: addDaysIso(closingOf(py, pm, statementDay), 1), to: closingOf(year, month, statementDay) }
  }

  const open = periodEndingIn(y, m)
  const closed: StatementPeriod[] = []
  for (let i = 1; i <= count; i++) {
    const [cy, cm] = shift(y, m, -i)
    closed.push(periodEndingIn(cy, cm))
  }
  return { open, closed }
}

/** Kesimden SONRA gelen ilk son ödeme günü. */
export function dueDateAfter(closing: string, dueDay: number): string {
  const [y, m] = closing.slice(0, 7).split('-').map(Number)
  const sameMonth = dayInMonth(y, m, dueDay)
  if (sameMonth > closing) return sameMonth
  const [ny, nm] = shift(y, m, 1)
  return dayInMonth(ny, nm, dueDay)
}

function inCurrency(t: Transaction, currency: Account['currency']): number {
  return t.currency === currency ? t.amount : fromBaseTry(baseAmount(t), currency)
}

export function buildCardStatements(
  account: Pick<Account, 'id' | 'currency' | 'statementDay'>,
  transactions: readonly Transaction[],
  opts: {
    /** assignCardPayments(...).get(account.id) — bu karta yapılan ödemeler */
    payments: readonly Transaction[]
    dueDay: number | null
    minPayPct: number | null
    todayStr: string
    count?: number
  },
): CardStatementResult {
  const statementDay = Math.min(28, Math.max(1, account.statementDay ?? 1))
  const { open, closed } = statementPeriods(statementDay, opts.todayStr, opts.count ?? 6)
  const paymentIds = new Set(opts.payments.map(t => t.id))

  const cardRows = transactions.filter(t =>
    t.accountId === account.id &&
    !t.systemKind &&
    !paymentIds.has(t.id) &&
    isPosted(t, opts.todayStr),
  )

  const chargesIn = (p: StatementPeriod) =>
    cardRows.filter(t => { const d = t.date.slice(0, 10); return d >= p.from && d <= p.to })
  const totalOf = (rows: Transaction[]) =>
    Math.max(0, roundMoney(sumBy(rows, t => (t.type === 'income' ? -1 : 1) * inCurrency(t, account.currency))))

  const postedPayments = opts.payments.filter(t => isPosted(t, opts.todayStr))

  const statements: CardStatement[] = closed.map((period, i) => {
    const charges = chargesIn(period)
    const total = totalOf(charges)
    const dueDate = opts.dueDay ? dueDateAfter(period.to, opts.dueDay) : null
    // Ödeme penceresi: kesimin ertesi → son ödeme + 7 gün. Son ödeme günü
    // bilinmiyorsa sonraki kesim (bir sonraki dönemin sonu).
    const nextClosing = i === 0 ? open.to : closed[i - 1].to
    const windowEnd = dueDate ? addDaysIso(dueDate, PAY_GRACE_DAYS) : nextClosing
    const paid = roundMoney(sumBy(
      postedPayments.filter(t => { const d = t.date.slice(0, 10); return d > period.to && d <= windowEnd }),
      t => Math.abs(inCurrency(t, account.currency)),
    ))
    const minPayment = opts.minPayPct ? roundMoney(total * opts.minPayPct / 100) : null

    let status: StatementStatus
    if (total === 0) status = 'clear'
    else if (paid >= total) status = 'paid'
    else if (dueDate && dueDate < opts.todayStr && paid < (minPayment ?? total)) status = 'overdue'
    else if (paid > 0) status = 'partial'
    else status = 'open'

    return { period, charges, total, dueDate, minPayment, paid, status }
  })

  const openCharges = chargesIn(open)
  return { open: { period: open, charges: openCharges, total: totalOf(openCharges) }, statements }
}
