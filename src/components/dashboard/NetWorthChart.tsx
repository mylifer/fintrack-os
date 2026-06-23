'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths, monthRange, isInRange } from '@/lib/utils/date'
import { getAssetPrice } from '@/store/investment.store'
import { formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { MonthYear } from '@/types'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
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
  const prices      = useInvestmentStore(s => s.prices)
  const investValue = useInvestmentStore(s => s.getPortfolioValue())
  const investTxs   = useInvestmentStore(s => s.transactions)

  const currentNW = calcNetWorth(accounts, prices) + investValue
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

      // Subtract current portfolio value added by investment buys in this month
      // (buys reduce cash but add portfolio value; going backwards we remove that value)
      if (prices) {
        const { from, to } = monthRange(months[i])
        const investDelta = investTxs
          .filter(tx => isInRange(tx.date, from, to))
          .reduce((sum, tx) => {
            const unitPrice = getAssetPrice(tx.asset, prices)
            const currentValue = tx.quantity * unitPrice
            return tx.type === 'buy' ? sum - currentValue : sum + currentValue
          }, 0)
        nw += investDelta
      }
    }

    return result
  }, [transactions, currentNW, investTxs, prices])

  const trend = data.length >= 2 ? data[data.length - 1].netWorth - data[0].netWorth : 0
  const up    = trend >= 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Varlık</CardTitle>
        <CardDescription>Son 6 aylık varlık trendi</CardDescription>
      </CardHeader>
      <CardContent>
        <Chart data={data} selectedPeriod={selectedPeriod} />
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className={`flex gap-2 font-medium leading-none ${up ? 'text-green-600' : 'text-destructive'}`}>
          {up ? '6 ayda +' : '6 ayda '}{formatCompact(Math.abs(trend))} değişim{' '}
          {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        </div>
        <div className="text-muted-foreground leading-none">
          Güncel: {formatCompact(currentNW)}
        </div>
      </CardFooter>
    </Card>
  )
}
