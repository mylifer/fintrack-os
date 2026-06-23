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
    <Card className="h-full gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">Borç Takibi</span>
        <Link href="/debts" className="text-[9px] font-mono tracking-wide uppercase text-muted-foreground hover:text-primary transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {/* Total */}
        <div className="px-5 py-4 border-b border-border flex items-baseline gap-2">
          <span className="text-2xl font-black tabular tracking-tight text-foreground">
            {formatCurrency(totalOwed)}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground uppercase">toplam borç</span>
        </div>

        {/* Due soon */}
        {dueSoon.length === 0 ? (
          <div className="px-5 py-4 text-xs text-muted-foreground">30 gün içinde vadesi gelen ödeme yok.</div>
        ) : (
          <div className="divide-y divide-border">
            {dueSoon.map(debt => {
              const overdue = debt.dueDate && isOverdue(debt.dueDate)
              const days    = debt.dueDate ? daysUntil(debt.dueDate) : null

              return (
                <div key={debt.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium text-foreground">{debt.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {debt.counterparty && `${debt.counterparty} · `}
                        {debt.dueDate && formatDate(debt.dueDate, 'd MMM yyyy')}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-mono tabular text-foreground">
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
