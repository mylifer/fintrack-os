'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Header }        from '@/components/layout/Header'
import { PeriodTabs }    from '@/components/ui/PeriodTabs'
import { useAccountStore, useUIStore, useTransactionStore, useInvestmentStore } from '@/store'
import { useShallow }    from 'zustand/react/shallow'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { calcNetWorth, calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { getPeriodRange } from '@/lib/utils/date'
import { AccountFormModal } from '@/components/accounts/AccountFormModal'
import { AccountAvatar }  from '@/components/accounts/AccountAvatar'
import { EmptyState }    from '@/components/ui/EmptyState'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/Badge'
import { Card, CardContent } from '@/components/ui/card'
import type { Account }  from '@/types'

const TYPE_LABELS: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi Kartı', investment: 'Yatırım', loan: 'Kredi',
}

export default function AccountsPage() {
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const transactions  = useTransactionStore(s => s.transactions)
  const periodType    = useUIStore(s => s.periodType)
  const investValue   = useInvestmentStore(s => s.getPortfolioValue())
  const prices        = useInvestmentStore(s => s.prices)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  const netWorth = calcNetWorth(accounts, prices)

  const [showForm, setShowForm]             = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | undefined>()

  return (
    <>
      <Header title="Hesaplar" action={{ label: 'Yeni Hesap', onClick: () => setShowForm(true) }} />

      <PeriodTabs />

      {/* Net worth summary */}
      <div className="px-6 lg:px-8 py-5 border-b border-border bg-card flex items-baseline gap-3 flex-shrink-0">
        <span className={`text-3xl font-normal tabular-nums ${(netWorth + investValue) >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCurrency(netWorth + investValue)}
        </span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">toplam net varlık</span>
        {investValue > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            Yatırım: {formatCompact(investValue)}
          </span>
        )}
      </div>

      <div className="p-6 overflow-auto flex-1">
        {accounts.length === 0 ? (
          <EmptyState
            icon="▣"
            title="Henüz hesap yok"
            description="İlk hesabınızı ekleyerek başlayın."
            action={<Button size="sm" onClick={() => setShowForm(true)}>Hesap Ekle</Button>}
          />
        ) : (
          <div className="grid grid-cols-2 gap-5">
            {accounts.map((account) => {
                    const available = account.type === 'credit_card' ? calcAvailableCredit(account) : null
                    const usedPct   = account.creditLimit && available !== null
                      ? ((account.creditLimit - available) / account.creditLimit) * 100
                      : 0

                    // Period flow for this account
                    const acctTxs = transactions.filter(t => t.accountId === account.id || t.toAccountId === account.id)
                    const { income, expense } = calcPeriodFlow(acctTxs, from, to)
                    const hasActivity = income > 0 || expense > 0

                    return (
                      <Card
                        key={account.id}
                        className="p-0"
                      >
                        <CardContent className="p-5">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <AccountAvatar account={account} size="sm" />
                            <Link
                              href={`/accounts/${account.id}`}
                              className="text-xs font-semibold hover:text-primary transition-colors"
                            >
                              {account.name}
                            </Link>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="default">{TYPE_LABELS[account.type]}</Badge>
                            <button
                              onClick={() => { setEditingAccount(account); setShowForm(true) }}
                              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                            >✎</button>
                          </div>
                        </div>

                        <div className={`text-sm font-medium tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {formatCurrency(account.balance, account.currency)}
                        </div>

                        {/* Period stats */}
                        {hasActivity && (
                          <div className="flex items-center gap-3 mt-2 text-xs font-medium">
                            {income > 0 && <span className="text-green-600">+{formatCompact(income)}</span>}
                            {expense > 0 && <span className="text-destructive">−{formatCompact(expense)}</span>}
                          </div>
                        )}

                        {account.type === 'credit_card' && account.creditLimit && (
                          <div className="mt-3 pt-3 border-t border-border">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                              <span>Kullanılabilir</span>
                              <span className="tabular-nums">{formatCurrency(available ?? 0, account.currency)}</span>
                            </div>
                            <div className="h-[2px] bg-muted">
                              <div
                                className={`h-full ${usedPct > 80 ? 'bg-destructive' : usedPct > 60 ? 'bg-orange-500' : 'bg-green-600'}`}
                                style={{ width: `${Math.min(usedPct, 100)}%` }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Limit: {formatCurrency(account.creditLimit, account.currency)}
                              {account.statementDay && ` · Ekstre: ${account.statementDay}. gün`}
                            </div>
                          </div>
                        )}
                        </CardContent>
                      </Card>
                    )
            })}
          </div>
        )}
      </div>

      <AccountFormModal
        key={editingAccount?.id ?? 'new'}
        open={showForm}
        account={editingAccount}
        onClose={() => { setShowForm(false); setEditingAccount(undefined) }}
      />
    </>
  )
}
