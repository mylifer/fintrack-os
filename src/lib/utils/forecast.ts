import { addMonths, format, parseISO } from 'date-fns'
import type { Account, PriceData, RecurringFrequency, RecurringTransaction, Transaction } from '@/types'
import { calcNetWorth } from './calculations'
import { isReconciliation } from './reconciliation'
import { recurringOccurrences } from './recurrence'
import { baseAmount, toBaseTry } from './fx'
import { addMoney, mulMoney, subMoney, sumBy } from './money'

/* ────────────────────────────────────────────────────────────────────────
   Cash-flow forecast — a PURE projection of total balance forward.

   Starting point is the current net liquid position (calcNetWorth over the
   non-archived accounts) plus the current investment portfolio value
   (investmentsTry, computed by the caller from holdings at live prices —
   projected flat, we don't forecast asset prices). From there we walk every
   future occurrence of the
   user's active recurring income/expense templates, applying each as a signed
   TRY delta on its date. Transfers are skipped: they move money BETWEEN the
   user's own accounts, so at the aggregate (net-worth) level they net to zero.

   All money math runs through the integer-minor-unit helpers (S8) — never a
   bare `+` — and foreign amounts are normalized to base TRY via toBaseTry at
   the live rate (published from the investment price fetch through fx).
──────────────────────────────────────────────────────────────────────── */

export interface ForecastPoint {
  date: string     // yyyy-MM-dd
  balance: number  // projected liquid balance in TRY at end of this date
}

export interface ForecastDriver {
  id: string
  name: string
  type: 'income' | 'expense'
  monthlyEquivTry: number  // magnitude of monthly-equivalent impact in TRY
}

export interface ForecastResult {
  points: ForecastPoint[]
  shortfallDate: string | null  // first date the running balance goes < 0, else null
  totalIncome: number           // sum of positive deltas over the horizon (TRY)
  totalExpense: number          // absolute sum of negative deltas over the horizon (TRY)
  net: number                   // totalIncome − totalExpense (TRY)
  drivers: ForecastDriver[]     // active income/expense templates, monthly-equiv desc
}

export interface BuildForecastInput {
  accounts: Account[]
  recurring: RecurringTransaction[]
  transactions?: Transaction[]  // ledger txs; future-dated one-offs enter the projection on their date
  prices?: PriceData | null
  investmentsTry?: number  // current portfolio value in TRY, held flat over the horizon
  horizonMonths: number
  todayStr: string
}

// Average periods per month, used to express each frequency as a monthly figure
// for the "drivers" display (Gregorian mean month = 30.4375 days).
const MONTHLY_FACTOR: Record<RecurringFrequency, number> = {
  daily:   30.4375,
  weekly:  4.34524,
  monthly: 1,
  yearly:  1 / 12,
}

export function buildForecast({
  accounts,
  recurring,
  transactions = [],
  prices,
  investmentsTry = 0,
  horizonMonths,
  todayStr,
}: BuildForecastInput): ForecastResult {
  const start = addMoney(calcNetWorth(accounts, prices), investmentsTry)
  const horizonEnd = format(addMonths(parseISO(todayStr), horizonMonths), 'yyyy-MM-dd')

  // 1. Materialize every future occurrence of an active income/expense template
  //    as a signed TRY delta on its date.
  const events: { date: string; delta: number }[] = []
  for (const r of recurring) {
    if (!r.isActive) continue
    if (r.type !== 'income' && r.type !== 'expense') continue  // transfers net to zero
    const amountTry = toBaseTry(r.amount, r.currency)
    const signed = r.type === 'income' ? amountTry : -amountTry
    for (const occ of recurringOccurrences(r, horizonEnd)) {
      if (occ > todayStr) events.push({ date: occ, delta: signed })
    }
  }

  // 1b. Future-dated one-off ledger transactions: excluded from the current
  //     balance (they're pending), so they land in the projection on their own
  //     date. Transfers net to zero at aggregate level; reconciliation ghosts
  //     never carry forward.
  for (const t of transactions) {
    if (t.type !== 'income' && t.type !== 'expense') continue
    if (isReconciliation(t)) continue
    const d = t.date.slice(0, 10)
    if (d <= todayStr || d > horizonEnd) continue
    const amountTry = baseAmount(t)
    events.push({ date: d, delta: t.type === 'income' ? amountTry : -amountTry })
  }

  // 2. Horizon totals (kuruş-exact).
  const totalIncome  = sumBy(events.filter(e => e.delta > 0), e => e.delta)
  const totalExpense = sumBy(events.filter(e => e.delta < 0), e => -e.delta)
  const net          = subMoney(totalIncome, totalExpense)

  // 3. Fold events sharing a date into a single day-delta, then walk the balance
  //    cumulatively from the start (today).
  const dayDelta = new Map<string, number>()
  for (const e of events) {
    dayDelta.set(e.date, addMoney(dayDelta.get(e.date) ?? 0, e.delta))
  }
  const dates = [...dayDelta.keys()].sort()

  const points: ForecastPoint[] = [{ date: todayStr, balance: start }]
  let running = start
  let shortfallDate: string | null = null
  for (const d of dates) {
    running = addMoney(running, dayDelta.get(d)!)
    points.push({ date: d, balance: running })
    if (shortfallDate === null && running < 0) shortfallDate = d
  }

  // 4. Drivers: monthly-equivalent impact of each active income/expense template.
  const drivers: ForecastDriver[] = recurring
    .filter(r => r.isActive && (r.type === 'income' || r.type === 'expense'))
    .map(r => ({
      id:   r.id,
      name: r.name,
      type: r.type as 'income' | 'expense',
      monthlyEquivTry: mulMoney(toBaseTry(r.amount, r.currency), MONTHLY_FACTOR[r.frequency]),
    }))
    .sort((a, b) => b.monthlyEquivTry - a.monthlyEquivTry)

  return { points, shortfallDate, totalIncome, totalExpense, net, drivers }
}
