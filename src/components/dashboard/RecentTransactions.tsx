'use client'

import Link from 'next/link'
import { useTransactionStore, useCategoryStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateShort } from '@/lib/utils/date'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

export function RecentTransactions() {
  const transactions = useTransactionStore(useShallow(s => s.transactions.slice(0, 10)))
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Son İşlemler</span>
        <Link href="/transactions" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {transactions.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">Henüz işlem yok.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {transactions.map(tx => {
              const cat     = categories.find(c => c.id === tx.categoryId)
              const account = accounts.find(a => a.id === tx.accountId)
              const isPos   = tx.type === 'income'
              const isXfer  = tx.type === 'transfer'

              return (
                <div key={tx.id} className="flex items-center gap-3 px-6 py-3.5 hover:bg-secondary/50 transition-colors">
                  <span className="text-base w-5 text-center flex-shrink-0 select-none">
                    {cat?.icon ?? (isXfer ? '↔' : '·')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-foreground">{tx.description}</div>
                    <div className="text-xs text-muted-foreground flex gap-1.5 mt-0.5">
                      <span>{formatDateShort(tx.date)}</span>
                      <span>·</span>
                      <span className="truncate">{account?.name ?? '—'}</span>
                      {tx.isInstallment && (
                        <>
                          <span>·</span>
                          <span className="text-orange-500">{tx.installIndex}/{tx.installTotal}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm tabular-nums flex-shrink-0 font-medium ${
                    isPos ? 'text-green-600' : isXfer ? 'text-primary' : 'text-foreground'
                  }`}>
                    {isPos ? '+' : isXfer ? '↔' : '−'}{formatCurrency(tx.amount, tx.currency)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
