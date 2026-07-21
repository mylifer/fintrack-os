import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { toBaseTry } from '@/lib/utils/fx'
import type { Account, Transaction, AccountType } from '@/types'

export const TYPE_LABELS: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi Kartı', investment: 'Yatırım', loan: 'Kredi',
}

// Gruplu görünümde sabit sıra — varlıklar önce, borçlar sonra
export const TYPE_ORDER: AccountType[] = [
  'cash', 'checking', 'savings', 'investment', 'credit_card', 'loan',
]

// Kredi kartı ve kredi = yükümlülük (net varlıkta eksi taraf)
export function isLiability(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan'
}

export interface AccountRow {
  account: Account
  /** TRY-normalize bakiye — pay/oran hesapları için (calcNetWorth ile aynı mantık) */
  tryBalance: number
  /** Kredi kartıysa kullanılabilir limit, değilse null */
  available: number | null
  /** Kullanılan limit yüzdesi (0–100) */
  usedPct: number
  income: number
  expense: number
  hasActivity: boolean
}

export function enrichAccounts(
  accounts: Account[],
  transactions: Transaction[],
  from: string,
  to: string,
): AccountRow[] {
  return accounts.map((account) => {
    const available = account.type === 'credit_card'
      ? calcAvailableCredit(account, transactions)
      : null
    const usedPct = account.creditLimit && available !== null
      ? ((account.creditLimit - available) / account.creditLimit) * 100
      : 0

    const acctTxs = transactions.filter(t => t.accountId === account.id || t.toAccountId === account.id)
    const { income, expense } = calcPeriodFlow(acctTxs, from, to)

    return {
      account,
      tryBalance: account.currency === 'TRY' ? account.balance : toBaseTry(account.balance, account.currency),
      available,
      usedPct,
      income,
      expense,
      hasActivity: income > 0 || expense > 0,
    }
  })
}
