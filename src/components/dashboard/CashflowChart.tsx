'use client'

import dynamic from 'next/dynamic'
import { useTransactionStore, useUIStore } from '@/store'
import { calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

const Chart = dynamic(() => import('./_CashflowChart'), {
  ssr: false,
  loading: () => <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

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
  const up  = net >= 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nakit Akışı</CardTitle>
        <CardDescription>Son 6 aylık gelir ve gider karşılaştırması</CardDescription>
      </CardHeader>
      <CardContent>
        <Chart data={data} selectedPeriod={selectedPeriod} />
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className={`flex gap-2 font-medium leading-none ${up ? 'text-green-600' : 'text-destructive'}`}>
          {up ? 'Bu ay +' : 'Bu ay '}{formatCompact(Math.abs(net))} net{' '}
          {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        </div>
        <div className="text-muted-foreground leading-none">
          Seçili dönem: {new Date(selectedPeriod.year, selectedPeriod.month - 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}
        </div>
      </CardFooter>
    </Card>
  )
}
