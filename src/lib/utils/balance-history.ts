import type { Account, Transaction } from '@/types'
import { makeEventDelta, type ForecastEvent, type ForecastMode, type ForecastPoint } from './forecast'
import { excludeFuture } from './calculations'
import { baseAmount } from './fx'
import { addMoney, subMoney } from './money'

/* ────────────────────────────────────────────────────────────────────────
   Backward daily balance history — the "Tüm Zamanlar" companion of the
   forward forecast. Starting from TODAY's known balance (the same figure the
   forecast starts from), it walks the posted ledger backward and undoes each
   day's net movement, yielding an end-of-day balance point for every day
   that had activity, oldest first, ending with today.

   Mode semantics are identical to the forecast (shared makeEventDelta):
   'total' counts income/expense over all accounts and ignores transfers;
   'cash' counts only movements that cross the liquid boundary.

   Investment ledger rows arrive pre-valued (InvestEvent, at CURRENT prices —
   we don't have historical prices, so like the forward projection the walk
   holds prices flat): a buy raised the tracked balance by the asset's value
   on its day ('total' view; the cash spent isn't in the ledger), a sell
   lowered it. In 'cash' mode only near-cash TEFAS fund events count, since
   only the fund slice of the portfolio is inside that view.

   Reconciliation ghosts are INCLUDED on purpose — they really moved the raw
   balances, so undoing history without them would drift (same rule as the
   dashboard's net-worth walk).
──────────────────────────────────────────────────────────────────────── */

export interface InvestEvent {
  date: string             // yyyy-MM-dd
  name: string             // display label, e.g. "GLD alımı"
  type: 'buy' | 'sell'
  valueTry: number         // quantity × current unit price, in TRY
  isTefas: boolean
}

// One past movement, for the chart tooltip — same shape as a forecast event
// minus the running balance (the tooltip doesn't show it).
export type HistoryEvent = Omit<ForecastEvent, 'balanceAfter'>

export interface BalanceHistory {
  points: ForecastPoint[]
  events: HistoryEvent[]   // every counted movement, date asc
}

export interface BuildBalanceHistoryInput {
  accounts: Account[]
  transactions: Transaction[]
  investEvents?: InvestEvent[]
  mode?: ForecastMode      // default 'total'
  todayStr: string
  endBalance: number       // today's balance in this mode (= forecast start)
}

export function buildBalanceHistory({
  accounts,
  transactions,
  investEvents = [],
  mode = 'total',
  todayStr,
  endBalance,
}: BuildBalanceHistoryInput): BalanceHistory {
  const eventDelta = makeEventDelta(accounts, mode)

  // Fold every posted movement into a signed TRY delta per day, keeping a
  // per-movement row alongside for the chart tooltip.
  const dayDelta = new Map<string, number>()
  const events: HistoryEvent[] = []
  const add = (date: string, delta: number, name: string) => {
    dayDelta.set(date, addMoney(dayDelta.get(date) ?? 0, delta))
    events.push({ date, name, type: delta >= 0 ? 'income' : 'expense', amountTry: Math.abs(delta) })
  }

  for (const t of excludeFuture(transactions, todayStr)) {
    const delta = eventDelta(t.type, baseAmount(t), t.accountId, t.toAccountId)
    if (delta !== null) add(t.date.slice(0, 10), delta, t.description || t.merchant || 'İşlem')
  }
  for (const e of investEvents) {
    const d = e.date.slice(0, 10)
    if (d > todayStr) continue
    if (mode === 'cash' && !e.isTefas) continue
    add(d, e.type === 'buy' ? e.valueTry : -e.valueTry, e.name)
  }
  events.sort((a, b) => a.date.localeCompare(b.date))

  // Walk backward from today's balance, undoing each active day's delta.
  // Point for day d = end-of-day balance; days without activity are implied
  // (the chart carries the balance forward when densifying).
  const days = [...dayDelta.keys()].sort()
  const reversed: ForecastPoint[] = [{ date: todayStr, balance: endBalance }]
  let running = endBalance
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]
    if (d < todayStr) reversed.push({ date: d, balance: running })
    running = subMoney(running, dayDelta.get(d)!)
  }
  return { points: reversed.reverse(), events }
}
