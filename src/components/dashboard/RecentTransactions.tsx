'use client'

import Link from 'next/link'
import { useTransactionStore, useCategoryStore, useAccountStore, usePeopleStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateShort } from '@/lib/utils/date'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'

export function RecentTransactions() {
  const transactions = useTransactionStore(useShallow(s => s.transactions.slice(0, 10)))
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)
  const people       = usePeopleStore(s => s.people)

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
          <div className="divide-y divide-border/40">
            {transactions.map(tx => {
              const cat       = categories.find(c => c.id === tx.categoryId)
              const account   = accounts.find(a => a.id === tx.accountId)
              const recipient = tx.recipientId    ? people.find(p => p.id === tx.recipientId)    : null
              const family    = tx.familyMemberId ? people.find(p => p.id === tx.familyMemberId) : null
              const person    = recipient ?? family
              const isPos     = tx.type === 'income'
              const isXfer    = tx.type === 'transfer'

              const metaParts: string[] = []
              metaParts.push(formatDateShort(tx.date))
              if (account) metaParts.push(account.name)
              if (tx.isInstallment) metaParts.push(`${tx.installIndex}/${tx.installTotal}`)

              return (
                <div key={tx.id} className="flex items-center gap-2.5 px-5 py-2 hover:bg-secondary/40 transition-colors">
                  {person ? (
                    <PersonAvatar person={person} size="xs" className="flex-shrink-0" />
                  ) : cat ? (
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: cat.color ? `${cat.color}18` : 'rgba(255,255,255,0.06)' }}
                    >
                      <CategoryIcon icon={cat.icon} color={cat.color} size={11} />
                    </span>
                  ) : (
                    <span className="text-xs w-5 text-center flex-shrink-0 select-none text-muted-foreground">
                      {tx.icon ?? (isXfer ? '↔' : '·')}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate text-foreground leading-snug">{tx.description}</div>
                    <div className="text-[11px] text-muted-foreground/60 truncate leading-snug">
                      {metaParts.join(' · ')}
                    </div>
                  </div>
                  <span className={`text-[13px] tabular-nums flex-shrink-0 font-medium ${
                    isPos ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground'
                  }`}>
                    {isPos ? '+' : isXfer ? '' : '−'}{formatCurrency(tx.amount, tx.currency)}
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
