'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => (
    <div className="h-48 flex items-center justify-center text-[10px] font-mono text-muted uppercase tracking-wide">
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

  const currentNW = calcNetWorth(accounts)
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
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">
          Net Varlık Trendi — Son 6 Ay
        </span>
        {trend !== 0 && (
          <span className={`text-[10px] font-mono tabular ${trend >= 0 ? 'text-ok' : 'text-danger'}`}>
            {trend >= 0 ? '+' : ''}{formatCompact(trend)}
          </span>
        )}
      </div>
      <Chart data={data} selectedPeriod={selectedPeriod} />
      <div className="px-5 pb-4 flex items-center gap-1.5">
        <span className="w-2 h-2 bg-accent rounded-full inline-block" />
        <span className="text-[10px] font-mono text-muted uppercase tracking-wide">Net Varlık</span>
      </div>
    </div>
  )
}
