import type { Account, Transaction } from '@/types'
import { isPosted } from './calculations'
import { baseAmount, fromBaseTry } from './fx'
import { roundMoney, sumBy } from './money'
import { cardCycles, shiftMonthKey, type CycleOverride, type MonthKey } from '@/lib/payments/card-cycles'

/* ── Kredi kartı ekstresi ─────────────────────────────────────────────────────
   Saf modül: dönemleri kart döngülerinden (lib/payments/card-cycles — varsayılan
   kesim/son ödeme günü + Kart Takvimi'nde aya özel girilen tarihler) alır ve her
   kapanmış dönem için uygulamaya GİRİLMİŞ işlemlerden bir ekstre hesaplar.
   Bankanın ekstresi değildir — uygulamada olmayan bir harcama burada da yoktur.

   Dönem: önceki kesimin ertesi günü → bu kesim günü (ikisi dahil).
   Dönem borcu: kartta gider + karttan çıkan transfer − karta işlenen iade.
     Karta YAPILAN ödemeler (assignCardPayments'ın bulduğu, Ödeme Takibi ile
     aynı kural) ve mutabakat satırları borca girmez. Onay bekleyen ya da
     tarihi gelmemiş satırlar sayılmaz (isPosted — bakiyeyle aynı kural).
   Son ödeme tarihi: döngünün son ödemesi. Varsayılan gün yalnız ödeme
     planından gelir (Ödeme Takibi'nin 2026-09-11 kararı: kart formuna her
     karta 10 yazılıyordu, o değer güvenilmez); yoksa null — varsayım yok.
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

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
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
    /** Kart Takvimi'nde aya özel girilen kesim/son ödeme (ödeme ayı → tarih) */
    overrides?: ReadonlyMap<MonthKey, CycleOverride>
  },
): CardStatementResult {
  const count = opts.count ?? 6
  const month = opts.todayStr.slice(0, 7)
  const cycles = cardCycles(
    { statementDay: account.statementDay ?? null, dueDay: opts.dueDay },
    opts.overrides ?? new Map(),
    shiftMonthKey(month, -(count + 2)),
    shiftMonthKey(month, 3),
  )
  // Açık dönem: kesimi bugün ya da sonra olan ilk döngü
  const openIdx = cycles.findIndex(c => c.closing >= opts.todayStr.slice(0, 10))
  const openCycle = cycles[openIdx]
  const closedCycles = cycles.slice(Math.max(0, openIdx - count), openIdx).reverse()
  const open: StatementPeriod = { from: openCycle.from, to: openCycle.closing }
  const closed: StatementPeriod[] = closedCycles.map(c => ({ from: c.from, to: c.closing }))
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
    const dueDate = closedCycles[i].dueDate
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
