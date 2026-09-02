import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
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

// Kart vurgu şeridi için kategorik palet — renk çemberine yayılmış 12 belirgin
// ton (Tailwind 500). Her karta sırasıyla atanır; komşu kartlar hep farklı renk.
export const BAR_PALETTE = [
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#14b8a6', // teal
  '#22c55e', // green
  '#84cc16', // lime
  '#f59e0b', // amber
  '#f97316', // orange
  '#ef4444', // red
  '#f43f5e', // rose
  '#ec4899', // pink
  '#8b5cf6', // violet
]

/** Karttaki (index) hesaba paletten belirgin bir vurgu rengi verir. */
export function barColor(index: number): string {
  return BAR_PALETTE[index % BAR_PALETTE.length]
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
  // collapseInstallments: dönem gelir/gideri Raporlar ile aynı "satın alma
  // ayına toplu yaz" kuralıyla sayılır. calcAvailableCredit HAM `transactions`
  // okumaya devam eder — kredi limiti taksitlerin gerçek posting tarihine göre
  // bloke olur (kendi yorumunda açıklandığı gibi).
  const reportTxs = collapseInstallments(transactions)
  return accounts.map((account) => {
    const available = account.type === 'credit_card'
      ? calcAvailableCredit(account, transactions)
      : null
    const usedPct = account.creditLimit && available !== null
      ? ((account.creditLimit - available) / account.creditLimit) * 100
      : 0

    const acctTxs = reportTxs.filter(t => t.accountId === account.id || t.toAccountId === account.id)
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
