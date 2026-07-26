'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTransactionStore } from '@/store'
import { calcMonthlyFlow, excludeFuture } from '@/lib/utils/calculations'
import { isReconciliation } from '@/lib/utils/reconciliation'
import { lastNMonths, monthRange } from '@/lib/utils/date'
import { formatCurrency } from '@/lib/utils/currency'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CashFlowBarChart } from '@/components/reports/CashFlowBarChart'
import { CashFlowDetailOverlay } from '@/components/reports/CashFlowDetailOverlay'
import { ListFilter, BarChart3, LineChart as LineChartIcon } from 'lucide-react'
import type { CashFlowPoint, CashFlowChartType } from '@/components/reports/_CashFlowBarChart'

export function CashflowChart() {
  const transactions = useTransactionStore(s => s.transactions)
  const [chartType, setChartType] = useState<CashFlowChartType>('bar')
  const [detail, setDetail]         = useState<{ from: string; to: string; label: string } | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const openDetail = useCallback((d: { from: string; to: string; label: string }) => {
    setDetail(d)
    setDetailOpen(true)
  }, [])

  // Nakit akışı = yalnızca gerçek nakit gelir/gider (bkz. calcMonthlyFlow/isFlowTx) —
  // gerçekleşmemiş fon getirisi barlara enjekte edilmez.
  const data = useMemo<CashFlowPoint[]>(() => {
    return lastNMonths(6).map(my => {
      const { from, to } = monthRange(my)
      const { income, expense } = calcMonthlyFlow(transactions, my)
      const label = new Date(my.year, my.month - 1).toLocaleDateString('tr-TR', { month: 'short' })
      return { label, income, expense, from, to }
    })
  }, [transactions])

  const net = useMemo(() => data.reduce((s, d) => s + d.income - d.expense, 0), [data])
  const rangeLabel = data.length ? `${data[0].label} – ${data[data.length - 1].label}` : 'Son 6 Ay'

  // Drill-down overlay'in kendi toplamları bar verisiyle tutarlı olsun diye
  // aynı kapsam: onaylanmış (pending/gelecek hariç) + mutabakat ayıklanmış.
  const flowTxs = useMemo(
    () => excludeFuture(transactions).filter(tx => !isReconciliation(tx)),
    [transactions],
  )

  return (
    <>
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Nakit Akışı</span>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium tabular-nums ${net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              Net: {net >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(net)} format={formatCurrency} />
            </span>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60">
              <button
                onClick={() => setChartType('bar')}
                className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${chartType === 'bar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title="Sütun grafik"
                aria-pressed={chartType === 'bar'}
              >
                <BarChart3 size={13} />
              </button>
              <button
                onClick={() => setChartType('line')}
                className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${chartType === 'line' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title="Çizgi grafik"
                aria-pressed={chartType === 'line'}
              >
                <LineChartIcon size={13} />
              </button>
            </div>
            <button
              onClick={() => openDetail({ from: data[0]?.from ?? '', to: data[data.length - 1]?.to ?? '', label: rangeLabel })}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"
              title="İşlemleri görüntüle"
            >
              <ListFilter size={13} />
              Detay
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[360px]">
              <CashFlowBarChart
                data={data}
                chartType={chartType}
                onBarClick={p => openDetail({ from: p.from, to: p.to, label: p.label })}
                incomeColor="var(--chart-2)"
                expenseColor="var(--chart-1)"
              />
            </div>
          </div>
          <div className="px-5 pb-4 flex gap-4">
            <LegendDot color="var(--chart-2)" label="Gelir" />
            <LegendDot color="var(--chart-1)" label="Gider" />
          </div>
        </CardContent>
      </Card>

      {detail && (
        <CashFlowDetailOverlay
          open={detailOpen}
          from={detail.from}
          to={detail.to}
          label={detail.label}
          transactions={flowTxs}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 inline-block" style={{ background: color }} />
      <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
    </div>
  )
}
