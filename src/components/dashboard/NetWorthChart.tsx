'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { useTransactionStore, useAccountStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcMonthlyFlow } from '@/lib/utils/calculations'
import { monthRange, isInRange, currentMonthYear } from '@/lib/utils/date'
import { getAssetPrice } from '@/store/investment.store'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { MonthYear } from '@/types'
import type { NWDataPoint } from './_NetWorthChart'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

type Range = 'monthly' | 'yearly' | 'all'

const RANGES: { key: Range; label: string; limit: number | null; trendLabel: string }[] = [
  { key: 'monthly', label: 'Aylık',        limit: 12,   trendLabel: 'son 12 ayda'    },
  { key: 'yearly',  label: 'Yıllık',       limit: 24,   trendLabel: 'son 2 yılda'    },
  { key: 'all',     label: 'Tüm Zamanlar', limit: null,  trendLabel: 'tüm zamanlarda' },
]

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

type RawPoint = NWDataPoint & { shortLabel: string; longLabel: string }

export function NetWorthChart() {
  const [range, setRange] = useState<Range>('all')

  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices       = useInvestmentStore(s => s.prices)
  const investValue  = useInvestmentStore(s => s.getPortfolioValue())
  const investTxs    = useInvestmentStore(s => s.transactions)

  const currentNW = calcNetWorth(accounts, prices) + investValue

  const allData = useMemo<RawPoint[]>(() => {
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

    const points: RawPoint[] = new Array(months.length)
    let nw = currentNW

    for (let i = months.length - 1; i >= 0; i--) {
      const my = months[i]
      const d  = new Date(my.year, my.month - 1)

      const shortLabel = d.toLocaleDateString('tr-TR', { month: 'short' })
      const longLabel  = `${shortLabel} '${String(my.year).slice(2)}`
      const fullLabel  = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })

      points[i] = {
        label: shortLabel,
        shortLabel,
        longLabel,
        fullLabel,
        netWorth: Math.round(nw),
        delta:    0,
      }

      const { net } = calcMonthlyFlow(transactions, my)
      nw -= net

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

    for (let i = 1; i < points.length; i++) {
      points[i].delta = points[i].netWorth - points[i - 1].netWorth
    }

    return points
  }, [transactions, currentNW, investTxs, prices])

  const { data, trendLabel } = useMemo(() => {
    const cfg = RANGES.find(r => r.key === range)!
    const sliced = cfg.limit ? allData.slice(-cfg.limit) : allData
    const useYear = sliced.length > 12
    return {
      data: sliced.map(({ shortLabel, longLabel, ...p }): NWDataPoint => ({
        ...p,
        label: useYear ? longLabel : shortLabel,
      })),
      trendLabel: cfg.trendLabel,
    }
  }, [allData, range])

  const first   = data[0]?.netWorth ?? currentNW
  const trend   = currentNW - first
  const pct     = first !== 0 ? (trend / Math.abs(first)) * 100 : 0
  const up      = trend >= 0
  const hasData = data.length >= 2

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader className="pb-2">
        {/* Row 1: title + filter buttons */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Varlık</p>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: big number + trend badge */}
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums leading-none">
            {formatCurrency(currentNW)}
          </p>

          {hasData && trend !== 0 && (
            <div className={`text-right shrink-0 ${up ? 'text-green-500' : 'text-destructive'}`}>
              <p className="text-sm font-semibold tabular-nums">
                {up ? '+' : ''}{formatCompact(trend)}
              </p>
              <p className="text-xs opacity-75">
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{trendLabel}</p>
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
