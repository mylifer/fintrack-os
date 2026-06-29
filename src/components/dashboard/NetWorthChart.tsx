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

type Range = 'weekly' | 'monthly' | 'yearly' | 'all'

const RANGES: { key: Range; label: string }[] = [
  { key: 'weekly',  label: 'Haftalık'      },
  { key: 'monthly', label: 'Aylık'         },
  { key: 'yearly',  label: 'Yıllık'        },
  { key: 'all',     label: 'Tüm Zamanlar'  },
]

// Local date string YYYY-MM-DD (avoids UTC offset issues)
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Last n weeks as date-range buckets, newest last
function lastNWeeks(n: number) {
  const today = new Date()
  const result: { from: string; to: string; label: string; fullLabel: string }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const to = new Date(today)
    to.setDate(today.getDate() - i * 7)
    const from = new Date(to)
    from.setDate(to.getDate() - 6)

    const fmt = (d: Date) =>
      `${d.getDate()} ${d.toLocaleDateString('tr-TR', { month: 'short' })}`

    result.push({
      from:      localDateStr(from),
      to:        localDateStr(to),
      label:     fmt(from),
      fullLabel: `${fmt(from)} – ${fmt(to)}`,
    })
  }
  return result
}

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

type RawPoint = {
  month: number
  year: number
  shortLabel: string
  longLabel: string
  fullLabel: string
  netWorth: number
  delta: number
}

export function NetWorthChart() {
  const [range, setRange] = useState<Range>('all')

  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices       = useInvestmentStore(s => s.prices)
  const investValue  = useInvestmentStore(s => s.getPortfolioValue())
  const investTxs    = useInvestmentStore(s => s.transactions)

  const currentNW = calcNetWorth(accounts, prices) + investValue

  // Full monthly history — used by monthly / yearly / all ranges
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

      points[i] = { month: my.month, year: my.year, shortLabel, longLabel, fullLabel, netWorth: Math.round(nw), delta: 0 }

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

  // Weekly data — computed independently, same backward pattern
  const weeklyData = useMemo<NWDataPoint[]>(() => {
    const weeks = lastNWeeks(8)
    const points: NWDataPoint[] = new Array(weeks.length)
    let nw = currentNW

    for (let i = weeks.length - 1; i >= 0; i--) {
      const week = weeks[i]

      points[i] = { label: week.label, fullLabel: week.fullLabel, netWorth: Math.round(nw), delta: 0 }

      const inRange = transactions.filter(tx => isInRange(tx.date, week.from, week.to))
      const income  = inRange.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = inRange.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      nw -= (income - expense)

      if (prices) {
        const investDelta = investTxs
          .filter(tx => isInRange(tx.date, week.from, week.to))
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

  const { data, tickInterval, trendLabel } = useMemo(() => {
    if (range === 'weekly') {
      return { data: weeklyData, tickInterval: 0, trendLabel: 'son 8 haftada' }
    }

    const now = currentMonthYear()

    if (range === 'monthly') {
      const yearPoints = allData.filter(p => p.year === now.year)
      return {
        data: yearPoints.map((p): NWDataPoint => ({
          label: p.shortLabel, fullLabel: p.fullLabel, netWorth: p.netWorth, delta: p.delta,
        })),
        tickInterval: 0,
        trendLabel: `${now.year} yılında`,
      }
    }

    if (range === 'yearly') {
      const seenYears = new Set<number>()
      return {
        data: allData.map((p): NWDataPoint => {
          const first = !seenYears.has(p.year)
          if (first) seenYears.add(p.year)
          return { label: first ? String(p.year) : '', fullLabel: p.fullLabel, netWorth: p.netWorth, delta: p.delta }
        }),
        tickInterval: 0,
        trendLabel: 'tüm zamanlarda',
      }
    }

    // all
    const useYear = allData.length > 12
    const autoInterval = Math.max(0, Math.ceil(allData.length / 6) - 1)
    return {
      data: allData.map((p): NWDataPoint => ({
        label: useYear ? p.longLabel : p.shortLabel, fullLabel: p.fullLabel, netWorth: p.netWorth, delta: p.delta,
      })),
      tickInterval: autoInterval,
      trendLabel: 'tüm zamanlarda',
    }
  }, [allData, weeklyData, range])

  const first   = data[0]?.netWorth ?? currentNW
  const trend   = currentNW - first
  const pct     = first !== 0 ? (trend / Math.abs(first)) * 100 : 0
  const up      = trend >= 0
  const hasData = data.length >= 2

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader className="pb-2">
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
        <Chart data={data} tickInterval={tickInterval} />
      </CardContent>
    </Card>
  )
}
