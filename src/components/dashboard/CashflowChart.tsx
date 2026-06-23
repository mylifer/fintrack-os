'use client'

import dynamic from 'next/dynamic'
import { useTransactionStore } from '@/store'
import { useUIStore } from '@/store'
import { calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

const Chart = dynamic(() => import('./_CashflowChart'), { ssr: false, loading: () => (
  <div className="h-48 flex items-center justify-center text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Yükleniyor...</div>
)})

export function CashflowChart() {
  const transactions   = useTransactionStore(s => s.transactions)
  const selectedPeriod = useUIStore(s => s.selectedPeriod)

  const months = lastNMonths(6)
  const data: DataPoint[] = months.map(my => {
    const { income, expense } = calcMonthlyFlow(transactions, my)
    return {
      label: new Date(my.year, my.month - 1).toLocaleDateString('tr-TR', { month: 'short' }),
      income, expense, my,
    }
  })

  const currentData = data.find(d => d.my.month === selectedPeriod.month && d.my.year === selectedPeriod.year)
  const net = currentData ? currentData.income - currentData.expense : 0

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Nakit Akışı — Son 6 Ay</span>
        {currentData && (
          <span className={`text-xs font-medium tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
            Net: {formatCompact(net)}
          </span>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <Chart data={data} selectedPeriod={selectedPeriod} />
        <div className="px-6 pb-5 flex gap-5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full inline-block" />
            <span className="text-xs text-muted-foreground">Gelir</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-destructive rounded-full inline-block" />
            <span className="text-xs text-muted-foreground">Gider</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
