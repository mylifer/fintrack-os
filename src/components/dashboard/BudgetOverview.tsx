'use client'

import Link from 'next/link'
import { useBudgetStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { formatCurrency } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

export function BudgetOverview() {
  const transactions   = useTransactionStore(s => s.transactions)
  const categories     = useCategoryStore(s => s.categories)
  const selectedPeriod = useUIStore(s => s.selectedPeriod)
  const getBudgets     = useBudgetStore(s => s.getMonthBudgets)

  const budgets = getBudgets(selectedPeriod, transactions).slice(0, 6)

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Bütçe Durumu</span>
        <Link href="/budgets" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {budgets.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">Bu ay için bütçe tanımlı değil.</p>
            <Link href="/budgets" className="text-xs text-primary hover:underline mt-2 inline-block">
              Bütçe ekle →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {budgets.map(b => {
              const cat = categories.find(c => c.id === b.categoryId)
              return (
                <div key={b.id} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{cat?.icon}</span>
                      <span className="text-sm font-medium text-foreground">{cat?.name}</span>
                      {b.status !== 'ok' && (
                        <span className={`text-xs font-medium ${
                          b.status === 'exceeded' ? 'text-destructive' : 'text-orange-500'
                        }`}>
                          {b.status === 'exceeded' ? 'Aşıldı' : 'Uyarı'}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`text-sm tabular-nums ${
                        b.status === 'exceeded' ? 'text-destructive' : b.status === 'warning' ? 'text-orange-500' : 'text-foreground'
                      }`}>
                        {formatCurrency(b.spent, 'TRY')}
                      </span>
                      <span className="text-xs text-muted-foreground"> / {formatCurrency(b.amount, 'TRY')}</span>
                    </div>
                  </div>
                  <ProgressBar percent={b.percentUsed} status={b.status} showLabel />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
