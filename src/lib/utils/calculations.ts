import type { Account, Transaction, Budget, BudgetWithSpent, Debt, DebtWithRemaining, MonthYear, PriceData } from '@/types'
import { isInRange, monthRange, yearRange } from './date'
import { isReconciliation } from './reconciliation'
import { toMinor, toMajor, sumBy, subMoney } from './money'
import { baseAmount, fromBaseTry } from './fx'

// Sum of all transaction effects on an account, in the ACCOUNT'S OWN currency
// (a TRY account's balance is TRY, a USD account's is USD). Used to derive the
// current balance from initialBalance.
//
// Cross-currency transfers (S2): the outgoing leg is `amount` (already in the
// source = transfer currency). The incoming leg is `amount` when the transfer
// currency matches the target account (same-currency, exact, the common case),
// otherwise the TRY-normalized value converted into the target's currency.
export function computeTransactionEffect(
  account: Pick<Account, 'id' | 'currency'>,
  transactions: Transaction[],
): number {
  let minor = 0
  for (const t of transactions) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) minor -= toMinor(t.amount)
      if (t.toAccountId === account.id) {
        const incoming = t.currency === account.currency
          ? t.amount
          : fromBaseTry(baseAmount(t), account.currency)
        minor += toMinor(incoming)
      }
    } else if (t.accountId === account.id) {
      minor += t.type === 'income' ? toMinor(t.amount) : -toMinor(t.amount)
    }
  }
  return toMajor(minor)
}

export function calcNetWorth(accounts: Account[], prices?: PriceData | null): number {
  let minor = 0
  for (const a of accounts) {
    if (a.isArchived) continue
    let balance = a.balance
    if (prices && a.currency !== 'TRY') {
      if (a.currency === 'USD') balance *= prices.usdTry
      else if (a.currency === 'EUR') balance *= prices.eurTry
      else if (a.currency === 'GBP') balance *= prices.gbpTry
    }
    minor += toMinor(balance)
  }
  return toMajor(minor)
}

export function calcAvailableCredit(account: Account): number {
  if (account.type !== 'credit_card' || !account.creditLimit) return 0
  // Balance is negative for credit card debt
  return account.creditLimit + account.balance
}

// categoryId can hold a plain UUID or a JSON-encoded string[] for multi-category budgets
export function getBudgetCategoryIds(budget: Budget): string[] {
  const raw = budget.categoryId
  if (raw && raw.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) return parsed
    } catch {}
  }
  return raw ? [raw] : []
}

export function calcBudgetSpent(
  budget: Budget,
  transactions: Transaction[],
  my?: MonthYear,
): number {
  const range = my
    ? monthRange(my)
    : budget.period === 'monthly' && budget.month && budget.year
      ? monthRange({ month: budget.month, year: budget.year })
      : yearRange(budget.year ?? new Date().getFullYear())

  const categoryIds = getBudgetCategoryIds(budget)
  // Budgets are TRY-denominated → sum the normalized amountTry (S3), not raw.
  const matching = transactions.filter(tx =>
    tx.type === 'expense' &&
    tx.categoryId !== undefined &&
    categoryIds.includes(tx.categoryId) &&
    isInRange(tx.date, range.from, range.to),
  )
  return sumBy(matching, baseAmount)
}

export function enrichBudget(
  budget: Budget,
  transactions: Transaction[],
  my?: MonthYear,
): BudgetWithSpent {
  const spent = calcBudgetSpent(budget, transactions, my)
  const remaining = Math.max(0, subMoney(budget.amount, spent))
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
  const status =
    percentUsed >= 100 ? 'exceeded'
    : percentUsed >= budget.alertThreshold ? 'warning'
    : 'ok'

  return { ...budget, spent, remaining, percentUsed, status }
}

// Income/expense/net over an already date-scoped slice, summed in TRY-normalized
// amountTry (S2/S3) via integer minor units (S8). No ghosting — callers decide
// whether to pre-filter reconciliation.
function sumFlow(inRange: Transaction[]): { income: number; expense: number; net: number } {
  const income  = sumBy(inRange.filter(t => t.type === 'income'),  baseAmount)
  const expense = sumBy(inRange.filter(t => t.type === 'expense'), baseAmount)
  return { income, expense, net: subMoney(income, expense) }
}

// Flow metrics (income/expense/net) exclude balance-reconciliation ("ghost")
// entries everywhere — they correct raw balances only and must never inflate
// any income/expense total or average. Net-worth math uses calcMonthlyNetRaw.
export function calcPeriodFlow(
  transactions: Transaction[],
  from: string,
  to: string,
): { income: number; expense: number; net: number } {
  const inRange = transactions.filter(tx => tx.date >= from && tx.date <= to && !isReconciliation(tx))
  return sumFlow(inRange)
}

export function calcMonthlyFlow(
  transactions: Transaction[],
  my: MonthYear,
): { income: number; expense: number; net: number } {
  const { from, to } = monthRange(my)
  const inRange = transactions.filter(tx => isInRange(tx.date, from, to) && !isReconciliation(tx))
  return sumFlow(inRange)
}

// Net worth delta for a month INCLUDING reconciliation. Used only to walk
// account balances backwards in the Net Worth trend: reconciliation entries
// move the raw balance, so they must be counted here even though they are
// ghosted from the flow metrics above.
export function calcMonthlyNetRaw(
  transactions: Transaction[],
  my: MonthYear,
): number {
  const { from, to } = monthRange(my)
  const inRange = transactions.filter(tx => isInRange(tx.date, from, to))
  return sumFlow(inRange).net
}

export function enrichDebt(debt: Debt): DebtWithRemaining {
  const remainingAmount = Math.max(0, subMoney(debt.totalAmount, debt.paidAmount))
  const progressPercent = debt.totalAmount > 0
    ? Math.min(100, (debt.paidAmount / debt.totalAmount) * 100)
    : 0
  return { ...debt, remainingAmount, progressPercent }
}

export function calcCategorySpend(
  transactions: Transaction[],
  categoryId: string,
  from: string,
  to: string,
): number {
  const matching = transactions.filter(tx =>
    tx.type === 'expense' &&
    tx.categoryId === categoryId &&
    isInRange(tx.date, from, to),
  )
  return sumBy(matching, baseAmount)
}

// Group transactions by date for list display
export function groupByDate(
  transactions: Transaction[],
): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    const key = tx.date.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(tx)
  }
  return map
}
