'use client'

import Link from 'next/link'
import { useDebtStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, daysUntil, isOverdue } from '@/lib/utils/date'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

export function DebtSummary() {
  const getDueSoon = useDebtStore(s => s.getDueSoon)
  const getActive  = useDebtStore(s => s.getActive)
  const dueSoon    = getDueSoon(30)
  const allActive  = getActive()

  const totalOwed = allActive
    .filter(d => d.direction === 'owe')
    .reduce((s, d) => s + d.remainingAmount, 0)

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Borç Takibi</span>
        <Link href="/debts" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {/* Total */}
        <div className="px-6 py-4 border-b border-border/50 flex items-baseline gap-2">
          <span className="text-2xl font-light tracking-tight tabular-nums text-foreground">
            {formatCurrency(totalOwed)}
          </span>
          <span className="text-xs text-muted-foreground uppercase tracking-wide">toplam borç</span>
        </div>

        {/* Due soon */}
        {dueSoon.length === 0 ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">30 gün içinde vadesi gelen ödeme yok.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {dueSoon.map(debt => {
              const overdue = debt.dueDate && isOverdue(debt.dueDate)
              const days    = debt.dueDate ? daysUntil(debt.dueDate) : null

              return (
                <div key={debt.id} className="px-6 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{debt.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {debt.counterparty && `${debt.counterparty} · `}
                        {debt.dueDate && formatDate(debt.dueDate, 'd MMM yyyy')}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm tabular-nums text-foreground">
                        {formatCurrency(debt.monthlyPayment ?? debt.remainingAmount)}
                      </div>
                      {overdue ? (
                        <Badge variant="danger">Gecikmiş</Badge>
                      ) : days !== null && days <= 7 ? (
                        <Badge variant="warning">{days}g kaldı</Badge>
                      ) : (
                        <Badge variant="default">{days}g kaldı</Badge>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
