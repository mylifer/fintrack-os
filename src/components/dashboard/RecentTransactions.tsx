'use client'

import Link from 'next/link'
import { useTransactionStore, useCategoryStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDateShort } from '@/lib/utils/date'

export function RecentTransactions() {
  const transactions = useTransactionStore(useShallow(s => s.transactions.slice(0, 10)))
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)

  return (
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">Son İşlemler</span>
        <Link href="/transactions" className="text-[9px] font-mono tracking-wide uppercase text-muted hover:text-ink transition-colors">
          Tümü →
        </Link>
      </div>

      {transactions.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted">Henüz işlem yok.</p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {transactions.map(tx => {
            const cat     = categories.find(c => c.id === tx.categoryId)
            const account = accounts.find(a => a.id === tx.accountId)
            const isPos   = tx.type === 'income'
            const isXfer  = tx.type === 'transfer'

            return (
              <div key={tx.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-base w-5 text-center flex-shrink-0">
                  {cat?.icon ?? (isXfer ? '↔' : '·')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{tx.description}</div>
                  <div className="text-[10px] font-mono text-muted flex gap-1.5 mt-0.5">
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
                  isPos ? 'text-ok' : isXfer ? 'text-info' : 'text-ink'
                }`}>
                  {isPos ? '+' : isXfer ? '↔' : '−'}{formatCurrency(tx.amount, tx.currency)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
