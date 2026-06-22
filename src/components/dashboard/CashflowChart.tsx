'use client'

import dynamic from 'next/dynamic'
import { useTransactionStore } from '@/store'
import { useUIStore } from '@/store'
import { calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

const Chart = dynamic(() => import('./_CashflowChart'), { ssr: false, loading: () => (
  <div className="h-48 flex items-center justify-center text-[10px] font-mono text-muted uppercase tracking-wide">Yükleniyor...</div>
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
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">Nakit Akışı — Son 6 Ay</span>
        {currentData && (
          <span className={`text-[10px] font-mono tabular ${net >= 0 ? 'text-ok' : 'text-danger'}`}>
            Net: {formatCompact(net)}
          </span>
        )}
      </div>
      <Chart data={data} selectedPeriod={selectedPeriod} />
      <div className="px-5 pb-4 flex gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-ok inline-block" />
          <span className="text-[10px] font-mono text-muted uppercase tracking-wide">Gelir</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-danger inline-block" />
          <span className="text-[10px] font-mono text-muted uppercase tracking-wide">Gider</span>
        </div>
      </div>
    </div>
  )
}
