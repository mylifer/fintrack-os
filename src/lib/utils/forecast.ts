import { addMonths, format, parseISO } from 'date-fns'
import type { Account, AccountType, PriceData, RecurringFrequency, RecurringTransaction, Transaction, TransactionType } from '@/types'
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

export interface ForecastEvent {
  date: string             // yyyy-MM-dd
  name: string             // template name or one-off description
  type: 'income' | 'expense'
  amountTry: number        // magnitude in TRY (always positive)
  balanceAfter: number     // projected balance right after this event (TRY)
}

export interface ForecastResult {
  points: ForecastPoint[]
  horizonEnd: string            // yyyy-MM-dd — last date the projection covers
  shortfallDate: string | null  // first date the running balance goes < 0, else null
  totalIncome: number           // sum of positive deltas over the horizon (TRY)
  totalExpense: number          // absolute sum of negative deltas over the horizon (TRY)
  net: number                   // totalIncome − totalExpense (TRY)
  drivers: ForecastDriver[]     // active income/expense templates, monthly-equiv desc
  events: ForecastEvent[]       // every projected occurrence, date asc
}

/* Projection modes:
   'total' — net position over ALL accounts (incl. credit-card debt) plus the
             investment portfolio. Transfers between own accounts net to zero,
             so they never appear as events.
   'cash'  — liquidity view over liquid accounts (cash/checking/savings) plus
             near-cash TEFAS fund holdings (fundsTry — T+1/T+2 redeemable, so
             the user treats them as spendable). Card debt, loans, investment
             accounts and the rest of the portfolio (gold, FX, stocks) are out
             of the starting balance. A transfer that CROSSES the liquid
             boundary is a real cash event: paying the credit card drains
             cash on the payment date (expense-like), a loan disbursement to
             checking adds cash (income-like). Expenses charged to a credit
             card do NOT touch cash when they occur — the cash leaves at
             payment time, which avoids double-counting. */
export type ForecastMode = 'total' | 'cash'

export interface BuildForecastInput {
  accounts: Account[]
  recurring: RecurringTransaction[]
  transactions?: Transaction[]  // ledger txs; future-dated one-offs enter the projection on their date
  prices?: PriceData | null
  investmentsTry?: number  // current portfolio value in TRY, held flat over the horizon ('total' only)
  fundsTry?: number        // TEFAS fund slice of the portfolio in TRY; joins the start in 'cash' mode
  horizonMonths: number
  todayStr: string
  mode?: ForecastMode  // default 'total'
}

const LIQUID_TYPES = new Set<AccountType>(['cash', 'checking', 'savings'])

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
  fundsTry = 0,
  horizonMonths,
  todayStr,
  mode = 'total',
}: BuildForecastInput): ForecastResult {
  const cash = mode === 'cash'
  // Unknown accountId (e.g. archived, so not in the array) falls back to
  // liquid so cash mode degrades to total-mode behavior instead of silently
  // dropping the event.
  const liquidById = new Map(accounts.map(a => [a.id, LIQUID_TYPES.has(a.type)]))
  const isLiquid = (id: string) => liquidById.get(id) ?? true

  // Signed TRY impact of one occurrence on the projected balance, or null if
  // it doesn't move this mode's balance at all.
  const eventDelta = (type: TransactionType, amountTry: number, accountId: string, toAccountId?: string): number | null => {
    if (!cash) {
      if (type === 'income') return amountTry
      if (type === 'expense') return -amountTry
      return null  // transfers net to zero at aggregate level
    }
    const fromLiquid = isLiquid(accountId)
    if (type === 'income') return fromLiquid ? amountTry : null
    if (type === 'expense') return fromLiquid ? -amountTry : null
    if (!toAccountId) return null
    const toLiquid = isLiquid(toAccountId)
    if (fromLiquid && !toLiquid) return -amountTry  // e.g. kredi kartı ödemesi
    if (!fromLiquid && toLiquid) return amountTry
    return null  // within the liquid pool (or entirely outside it)
  }

  // 'total' carries the whole portfolio; 'cash' only its near-cash TEFAS slice.
  const startAccounts = cash ? accounts.filter(a => LIQUID_TYPES.has(a.type)) : accounts
  const start = addMoney(calcNetWorth(startAccounts, prices), cash ? fundsTry : investmentsTry)
  const horizonEnd = format(addMonths(parseISO(todayStr), horizonMonths), 'yyyy-MM-dd')

  // 1. Materialize every future occurrence of an active template that moves
  //    this mode's balance as a signed TRY delta on its date.
  const events: { date: string; delta: number; name: string; type: 'income' | 'expense' }[] = []
  for (const r of recurring) {
    if (!r.isActive) continue
    const delta = eventDelta(r.type, toBaseTry(r.amount, r.currency), r.accountId, r.toAccountId)
    if (delta === null) continue
    const type = delta >= 0 ? 'income' as const : 'expense' as const
    for (const occ of recurringOccurrences(r, horizonEnd)) {
      if (occ > todayStr) events.push({ date: occ, delta, name: r.name, type })
    }
  }

  // 1b. Future-dated one-off ledger transactions: excluded from the current
  //     balance (they're pending), so they land in the projection on their own
  //     date. Reconciliation ghosts never carry forward.
  for (const t of transactions) {
    if (isReconciliation(t)) continue
    const d = t.date.slice(0, 10)
    if (d <= todayStr || d > horizonEnd) continue
    const delta = eventDelta(t.type, baseAmount(t), t.accountId, t.toAccountId)
    if (delta === null) continue
    events.push({
      date: d,
      delta,
      name: t.description || t.merchant || 'İşlem',
      type: delta >= 0 ? 'income' : 'expense',
    })
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

  // 3b. Per-event timeline: same walk, but one row per occurrence so the UI can
  //     show WHICH transaction moves the balance. Stable sort keeps insertion
  //     order within a day; the last event of a day matches that day's point.
  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date))
  let eventRunning = start
  const eventRows: ForecastEvent[] = sortedEvents.map(e => {
    eventRunning = addMoney(eventRunning, e.delta)
    return {
      date: e.date,
      name: e.name,
      type: e.type,
      amountTry: Math.abs(e.delta),
      balanceAfter: eventRunning,
    }
  })

  // 4. Drivers: monthly-equivalent impact of each active template that moves
  //    this mode's balance (in cash mode that includes boundary-crossing
  //    transfers, e.g. the card payment, classified by the sign of its delta).
  const drivers: ForecastDriver[] = recurring
    .filter(r => r.isActive)
    .flatMap(r => {
      const delta = eventDelta(r.type, toBaseTry(r.amount, r.currency), r.accountId, r.toAccountId)
      if (delta === null) return []
      return [{
        id:   r.id,
        name: r.name,
        type: delta >= 0 ? 'income' as const : 'expense' as const,
        monthlyEquivTry: mulMoney(Math.abs(delta), MONTHLY_FACTOR[r.frequency]),
      }]
    })
    .sort((a, b) => b.monthlyEquivTry - a.monthlyEquivTry)

  return { points, horizonEnd, shortfallDate, totalIncome, totalExpense, net, drivers, events: eventRows }
}
