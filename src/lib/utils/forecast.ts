import { addMonths, format, parseISO } from 'date-fns'
import type { Account, AccountType, Debt, PriceData, RecurringFrequency, RecurringTransaction, Transaction, TransactionType } from '@/types'
import { calcNetWorth } from './calculations'
import { isReconciliation } from './reconciliation'
import { recurringOccurrences } from './recurrence'
import { baseAmount, toBaseTry } from './fx'
import { addMoney, mulMoney, roundMoney, subMoney, sumBy } from './money'

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
  debts?: Debt[]           // tracked debts; future scheduled installments project forward
  prices?: PriceData | null
  investmentsTry?: number  // current portfolio value in TRY, held flat over the horizon ('total' only)
  fundsTry?: number        // TEFAS fund slice of the portfolio in TRY; joins the start in 'cash' mode
  horizonMonths: number
  todayStr: string
  mode?: ForecastMode  // default 'total'
}

export const LIQUID_TYPES = new Set<AccountType>(['cash', 'checking', 'savings'])

// Add `months` calendar months to an ISO date, clamping the day to the target
// month's length (31 Ocak + 1 ay → 28/29 Şubat). Mirrors the debts page plan.
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = m - 1 + months
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const lastDay = new Date(ny, nm + 1, 0).getDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

export interface DebtPayment {
  date: string    // yyyy-MM-dd
  amount: number  // TRY, positive magnitude of the still-unpaid portion
}

/* Future, still-unpaid installments of a tracked debt, derived from its
   monthlyPayment schedule. Mirrors buildPaymentPlan on the debts page but
   yields only forward-dated slices in (after, horizonEnd] and nets out any
   portion already covered by paidAmount (so a partially-paid installment
   contributes only its remaining balance, and fully-paid ones drop out).
   Debt amounts are TRY (Debt carries no currency), so no FX conversion. */
export function futureDebtPayments(debt: Debt, after: string, horizonEnd: string): DebtPayment[] {
  const monthly = debt.monthlyPayment
  if (debt.isSettled || !monthly || monthly <= 0) return []
  const count = debt.totalInstallments && debt.totalInstallments > 0
    ? debt.totalInstallments
    : Math.ceil(debt.totalAmount / monthly)
  if (count <= 0 || count > 600) return []

  // Last installment carries the rounding remainder so the plan sums to total.
  const remainder = roundMoney(subMoney(debt.totalAmount, mulMoney(monthly, count - 1)))
  const out: DebtPayment[] = []
  let cumulative = 0
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 && remainder > 0 ? remainder : monthly
    const prevCumulative = cumulative
    cumulative = addMoney(cumulative, amount)
    // Vade girilmişse son taksit vadeye denk gelir; girilmemişse ilk taksit
    // başlangıç tarihine denk gelir (debts sayfasındaki takvimle birebir).
    const date = debt.dueDate
      ? addMonthsIso(debt.dueDate, -(count - 1 - i))
      : addMonthsIso(debt.startDate, i)
    if (date <= after || date > horizonEnd) continue
    // Bu taksitin ödenmemiş kısmı (kısmi ödemeyi de ele alır).
    const covered = Math.max(prevCumulative, debt.paidAmount)
    const unpaid = Math.min(amount, Math.max(0, subMoney(cumulative, covered)))
    if (unpaid > 0.005) out.push({ date, amount: unpaid })
  }
  return out
}

/* Signed TRY impact of one ledger movement on the given mode's balance, or
   null if it doesn't move that balance at all. Shared by the forward forecast
   and the backward balance-history walk (Tüm Zamanlar) so both views apply
   identical mode semantics. Unknown accountId (e.g. archived, so not in the
   array) falls back to liquid so cash mode degrades to total-mode behavior
   instead of silently dropping the event. */
export function makeEventDelta(accounts: Pick<Account, 'id' | 'type'>[], mode: ForecastMode) {
  const cash = mode === 'cash'
  const liquidById = new Map(accounts.map(a => [a.id, LIQUID_TYPES.has(a.type)]))
  const isLiquid = (id: string) => liquidById.get(id) ?? true

  return (type: TransactionType, amountTry: number, accountId: string, toAccountId?: string): number | null => {
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
  debts = [],
  prices,
  investmentsTry = 0,
  fundsTry = 0,
  horizonMonths,
  todayStr,
  mode = 'total',
}: BuildForecastInput): ForecastResult {
  const cash = mode === 'cash'
  const eventDelta = makeEventDelta(accounts, mode)

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

  // 1c. Tracked debts: future scheduled installments derived from monthlyPayment.
  //     Past payments are already real ledger transactions (counted above/in the
  //     start balance), so only forward-dated, still-unpaid slices are projected.
  //     'owe' drains the balance (expense-like); 'owed' is money coming back to
  //     us (income-like). accountId (payments are drawn from) drives cash-mode
  //     liquidity; unknown/undefined falls back to liquid, like makeEventDelta.
  const debtPaid = new Set<string>()  // debts that produced at least one future event (for drivers)
  for (const debt of debts) {
    const type: TransactionType = debt.direction === 'owed' ? 'income' : 'expense'
    for (const p of futureDebtPayments(debt, todayStr, horizonEnd)) {
      const delta = eventDelta(type, p.amount, debt.accountId ?? '', undefined)
      if (delta === null) continue
      debtPaid.add(debt.id)
      events.push({ date: p.date, delta, name: debt.name, type: delta >= 0 ? 'income' : 'expense' })
    }
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
  const recurringDrivers: ForecastDriver[] = recurring
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

  // Debt drivers: only debts that actually contribute a future payment in this
  // mode/horizon, shown at their monthlyPayment (already a monthly figure).
  const debtDrivers: ForecastDriver[] = debts
    .filter(d => debtPaid.has(d.id) && d.monthlyPayment && d.monthlyPayment > 0)
    .flatMap(debt => {
      const type: TransactionType = debt.direction === 'owed' ? 'income' : 'expense'
      const delta = eventDelta(type, debt.monthlyPayment!, debt.accountId ?? '', undefined)
      if (delta === null) return []
      return [{
        id:   `debt-${debt.id}`,
        name: debt.name,
        type: delta >= 0 ? 'income' as const : 'expense' as const,
        monthlyEquivTry: Math.abs(delta),
      }]
    })

  const drivers: ForecastDriver[] = [...recurringDrivers, ...debtDrivers]
    .sort((a, b) => b.monthlyEquivTry - a.monthlyEquivTry)

  return { points, horizonEnd, shortfallDate, totalIncome, totalExpense, net, drivers, events: eventRows }
}
