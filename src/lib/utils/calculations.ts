import type { Account, Transaction, Budget, BudgetWithSpent, Debt, DebtWithRemaining, MonthYear, PriceData } from '@/types'
import { isInRange, monthRange, yearRange } from './date'

// Sum of all transaction effects on an account (income adds, expense/outgoing-transfer subtracts).
// Used to derive the current balance from initialBalance.
export function computeTransactionEffect(accountId: string, transactions: Transaction[]): number {
  const raw = transactions.reduce((sum, t) => {
    if (t.type === 'transfer') {
      if (t.accountId === accountId) return sum - t.amount
      if (t.toAccountId === accountId) return sum + t.amount
    } else if (t.accountId === accountId) {
      return sum + (t.type === 'income' ? t.amount : -t.amount)
    }
    return sum
  }, 0)
  return Math.round(raw * 100) / 100
}

export function calcNetWorth(accounts: Account[], prices?: PriceData | null): number {
  const raw = accounts
    .filter(a => !a.isArchived)
    .reduce((sum, a) => {
      let balance = a.balance
      if (prices && a.currency !== 'TRY') {
        if (a.currency === 'USD') balance *= prices.usdTry
        else if (a.currency === 'EUR') balance *= prices.eurTry
        else if (a.currency === 'GBP') balance *= prices.gbpTry
      }
      return sum + balance
    }, 0)
  return Math.round(raw * 100) / 100
}

export function calcAvailableCredit(account: Account): number {
  if (account.type !== 'credit_card' || !account.creditLimit) return 0
  // Balance is negative for credit card debt
  return account.creditLimit + account.balance
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

  const raw = transactions
    .filter(tx =>
      tx.type === 'expense' &&
      tx.categoryId === budget.categoryId &&
      isInRange(tx.date, range.from, range.to),
    )
    .reduce((sum, tx) => sum + tx.amount, 0)
  return Math.round(raw * 100) / 100
}

export function enrichBudget(
  budget: Budget,
  transactions: Transaction[],
  my?: MonthYear,
): BudgetWithSpent {
  const spent = calcBudgetSpent(budget, transactions, my)
  const remaining = Math.max(0, budget.amount - spent)
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
  const status =
    percentUsed >= 100 ? 'exceeded'
    : percentUsed >= budget.alertThreshold ? 'warning'
    : 'ok'

  return { ...budget, spent, remaining, percentUsed, status }
}

export function calcPeriodFlow(
  transactions: Transaction[],
  from: string,
  to: string,
): { income: number; expense: number; net: number } {
  const inRange = transactions.filter(tx => tx.date >= from && tx.date <= to)
  const income  = Math.round(inRange.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) * 100) / 100
  const expense = Math.round(inRange.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) * 100) / 100
  return { income, expense, net: Math.round((income - expense) * 100) / 100 }
}

export function calcMonthlyFlow(
  transactions: Transaction[],
  my: MonthYear,
): { income: number; expense: number; net: number } {
  const { from, to } = monthRange(my)
  const inRange = transactions.filter(tx => isInRange(tx.date, from, to))

  const income  = Math.round(inRange.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) * 100) / 100
  const expense = Math.round(inRange.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) * 100) / 100
  return { income, expense, net: Math.round((income - expense) * 100) / 100 }
}

export function enrichDebt(debt: Debt): DebtWithRemaining {
  const remainingAmount = Math.max(0, debt.totalAmount - debt.paidAmount)
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
  return transactions
    .filter(tx =>
      tx.type === 'expense' &&
      tx.categoryId === categoryId &&
      isInRange(tx.date, from, to),
    )
    .reduce((sum, tx) => sum + tx.amount, 0)
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
