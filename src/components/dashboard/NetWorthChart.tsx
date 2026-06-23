'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { MonthYear } from '@/types'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => (
    <div className="h-48 flex items-center justify-center text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
      Yükleniyor...
    </div>
  ),
})

interface DataPoint {
  label: string
  netWorth: number
  my: MonthYear
}

export function NetWorthChart() {
  const transactions   = useTransactionStore(s => s.transactions)
  const accounts       = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const selectedPeriod = useUIStore(s => s.selectedPeriod)
  const prices         = useInvestmentStore(s => s.prices)

  const currentNW = calcNetWorth(accounts, prices)
  const months    = lastNMonths(6)

  const data = useMemo<DataPoint[]>(() => {
    const result: DataPoint[] = new Array(months.length)
    let nw = currentNW

    for (let i = months.length - 1; i >= 0; i--) {
      result[i] = {
        label: new Date(months[i].year, months[i].month - 1)
          .toLocaleDateString('tr-TR', { month: 'short' }),
        netWorth: Math.round(nw),
        my: months[i],
      }
      const { net } = calcMonthlyFlow(transactions, months[i])
      nw -= net
    }

    return result
  }, [transactions, currentNW])

  const trend = data.length >= 2
    ? data[data.length - 1].netWorth - data[0].netWorth
    : 0

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Net Varlık Trendi — Son 6 Ay</span>
        {trend !== 0 && (
          <span className={`text-xs font-medium tabular-nums ${trend >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
            {trend >= 0 ? '+' : ''}{formatCompact(trend)}
          </span>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <Chart data={data} selectedPeriod={selectedPeriod} />
        <div className="px-6 pb-5 flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-primary rounded-full inline-block" />
          <span className="text-xs text-muted-foreground">Net Varlık</span>
        </div>
      </CardContent>
    </Card>
  )
}
