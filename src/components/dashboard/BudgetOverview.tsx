'use client'

import Link from 'next/link'
import { useBudgetStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { formatCurrency } from '@/lib/utils/currency'

export function BudgetOverview() {
  const transactions   = useTransactionStore(s => s.transactions)
  const categories     = useCategoryStore(s => s.categories)
  const selectedPeriod = useUIStore(s => s.selectedPeriod)
  const getBudgets     = useBudgetStore(s => s.getMonthBudgets)

  const budgets = getBudgets(selectedPeriod, transactions).slice(0, 6)

  return (
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">Bütçe Durumu</span>
        <Link href="/budgets" className="text-[9px] font-mono tracking-wide uppercase text-muted hover:text-ink transition-colors">
          Tümü →
        </Link>
      </div>

      {budgets.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted">Bu ay için bütçe tanımlı değil.</p>
          <Link href="/budgets" className="text-xs font-mono uppercase tracking-wide text-amber hover:underline mt-1 inline-block">
            Bütçe ekle →
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {budgets.map(b => {
            const cat = categories.find(c => c.id === b.categoryId)
            return (
              <div key={b.id} className="px-5 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{cat?.icon}</span>
                    <span className="text-xs font-medium">{cat?.name}</span>
                    {b.status !== 'ok' && (
                      <span className={`text-[9px] font-mono uppercase tracking-wide ${
                        b.status === 'exceeded' ? 'text-danger' : 'text-amber'
                      }`}>
                        {b.status === 'exceeded' ? '!!' : '!'}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-mono tabular ${
                      b.status === 'exceeded' ? 'text-danger' : b.status === 'warning' ? 'text-amber' : 'text-ink'
                    }`}>
                      {formatCurrency(b.spent, 'TRY')}
                    </span>
                    <span className="text-[10px] font-mono text-muted"> / {formatCurrency(b.amount, 'TRY')}</span>
                  </div>
                </div>
                <ProgressBar percent={b.percentUsed} status={b.status} showLabel />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
