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
    <Card className="h-full gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">Son İşlemler</span>
        <Link href="/transactions" className="text-[9px] font-mono tracking-wide uppercase text-muted-foreground hover:text-primary transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {transactions.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-muted-foreground">Henüz işlem yok.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {transactions.map(tx => {
              const cat     = categories.find(c => c.id === tx.categoryId)
              const account = accounts.find(a => a.id === tx.accountId)
              const isPos   = tx.type === 'income'
              const isXfer  = tx.type === 'transfer'

              return (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/50 transition-colors">
                  <span className="text-sm w-5 text-center flex-shrink-0 select-none">
                    {cat?.icon ?? (isXfer ? '↔' : '·')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate text-foreground">{tx.description}</div>
                    <div className="text-[10px] font-mono text-muted-foreground flex gap-1.5 mt-0.5">
                      <span>{formatDateShort(tx.date)}</span>
                      <span>·</span>
                      <span className="truncate">{account?.name ?? '—'}</span>
                      {tx.isInstallment && (
                        <>
                          <span>·</span>
                          <span className="text-amber">{tx.installIndex}/{tx.installTotal}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`font-mono text-xs tabular flex-shrink-0 ${
                    isPos ? 'text-ok' : isXfer ? 'text-info' : 'text-foreground'
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
