'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcMonthlyFlow } from '@/lib/utils/calculations'
import { monthRange, isInRange, currentMonthYear, prevMonth } from '@/lib/utils/date'
import { getAssetPrice } from '@/store/investment.store'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { MonthYear } from '@/types'
import type { NWDataPoint } from './_NetWorthChart'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

// Build MonthYear list from a starting month to the current month (inclusive)
function monthsSince(start: MonthYear): MonthYear[] {
  const now = currentMonthYear()
  const result: MonthYear[] = []
  let cur = { ...start }
  while (cur.year < now.year || (cur.year === now.year && cur.month <= now.month)) {
    result.push({ ...cur })
    cur = cur.month === 12 ? { month: 1, year: cur.year + 1 } : { month: cur.month + 1, year: cur.year }
  }
  return result
}

export function NetWorthChart() {
  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices       = useInvestmentStore(s => s.prices)
  const investValue  = useInvestmentStore(s => s.getPortfolioValue())
  const investTxs    = useInvestmentStore(s => s.transactions)

  const currentNW = calcNetWorth(accounts, prices) + investValue

  const data = useMemo<NWDataPoint[]>(() => {
    // Find earliest transaction month — fall back to current month if no data
    let startMY = currentMonthYear()
    for (const tx of transactions) {
      const d = new Date(tx.date)
      const my: MonthYear = { month: d.getMonth() + 1, year: d.getFullYear() }
      if (my.year < startMY.year || (my.year === startMY.year && my.month < startMY.month)) {
        startMY = my
      }
    }

    const months = monthsSince(startMY)
    if (months.length === 0) return []

    // Determine label format based on span length
    const useYear = months.length > 12

    // Backward pass: start from current NW, subtract each month's net going back
    const points: NWDataPoint[] = new Array(months.length)
    let nw = currentNW

    for (let i = months.length - 1; i >= 0; i--) {
      const my = months[i]
      const d  = new Date(my.year, my.month - 1)

      const shortMonth = d.toLocaleDateString('tr-TR', { month: 'short' })
      const yearSuffix = `'${String(my.year).slice(2)}`
      const fullLabel  = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })

      points[i] = {
        label:     useYear ? `${shortMonth} ${yearSuffix}` : shortMonth,
        fullLabel,
        netWorth:  Math.round(nw),
        delta:     0, // filled in second pass
      }

      const { net } = calcMonthlyFlow(transactions, my)
      nw -= net

      // Adjust for investment portfolio changes in this month
      if (prices) {
        const { from, to } = monthRange(my)
        const investDelta = investTxs
          .filter(tx => isInRange(tx.date, from, to))
          .reduce((sum, tx) => {
            const unitPrice    = getAssetPrice(tx.asset, prices)
            const currentValue = tx.quantity * unitPrice
            return tx.type === 'buy' ? sum - currentValue : sum + currentValue
          }, 0)
        nw += investDelta
      }
    }

    // Second pass: compute month-over-month delta
    for (let i = 1; i < points.length; i++) {
      points[i].delta = points[i].netWorth - points[i - 1].netWorth
    }

    return points
  }, [transactions, currentNW, investTxs, prices])

  // Stats
  const first   = data[0]?.netWorth ?? currentNW
  const trend   = currentNW - first
  const pct     = first !== 0 ? (trend / Math.abs(first)) * 100 : 0
  const up      = trend >= 0
  const hasData = data.length >= 2

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          {/* Left: title + big number */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Net Varlık</p>
            <p className="text-3xl font-semibold tabular-nums leading-none">
              {formatCurrency(currentNW)}
            </p>
          </div>

          {/* Right: trend badge */}
          {hasData && trend !== 0 && (
            <div className={`text-right shrink-0 ${up ? 'text-green-500' : 'text-destructive'}`}>
              <p className="text-sm font-semibold tabular-nums">
                {up ? '+' : ''}{formatCompact(trend)}
              </p>
              <p className="text-xs opacity-75">
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">tüm zamanlarda</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Chart data={data} />
      </CardContent>
    </Card>
  )
}
