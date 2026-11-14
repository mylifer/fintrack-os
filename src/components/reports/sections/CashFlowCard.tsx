'use client'

import { useState } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CashFlowBarChart }   from '@/components/reports/CashFlowBarChart'
import { formatCurrency } from '@/lib/utils/currency'
import { PRESETS, type Preset } from '@/lib/reports/period'
import { ListFilter, BarChart3, LineChart as LineChartIcon } from 'lucide-react'
import { BarSkeleton } from './skeletons'

type CashFlowData = Parameters<typeof CashFlowBarChart>[0]['data']

/* ── Nakit Akışı kartı (tam genişlik) ──────────────────────────────── */
export function CashFlowCard({
  isLoading, cashFlowNet, cashFlowData, hasInstallment, dateRange, preset, presetOffset, periodLabel, openDetail,
}: {
  isLoading: boolean
  cashFlowNet: number
  cashFlowData: CashFlowData
  hasInstallment: boolean
  dateRange: { from: string; to: string }
  preset: Preset
  presetOffset: number
  periodLabel: string
  openDetail: (d: { from: string; to: string; label: string }) => void
}) {
  const [cashFlowChartType, setCashFlowChartType] = useState<'bar' | 'line'>('bar')

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
        <span className="text-sm font-semibold text-foreground/90">Nakit Akışı</span>
        <div className="flex items-center gap-3">
          {!isLoading && (
            <span className={`text-xs font-medium tabular-nums ${cashFlowNet >= 0 ? 'text-green-600' : 'text-destructive'}`}>
              Net: {cashFlowNet >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(cashFlowNet)} format={formatCurrency} />
            </span>
          )}
          {!isLoading && (
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60">
              <button
                onClick={() => setCashFlowChartType('bar')}
                className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${cashFlowChartType === 'bar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title="Sütun grafik"
                aria-pressed={cashFlowChartType === 'bar'}
              >
                <BarChart3 size={13} />
              </button>
              <button
                onClick={() => setCashFlowChartType('line')}
                className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${cashFlowChartType === 'line' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                title="Çizgi grafik"
                aria-pressed={cashFlowChartType === 'line'}
              >
                <LineChartIcon size={13} />
              </button>
            </div>
          )}
          {!isLoading && (
            <button
              onClick={() => openDetail({
                from:  dateRange.from,
                to:    dateRange.to,
                // Gezinilen dönemde "Bu Ay" yanıltıcı olur → gerçek dönem adı
                label: (presetOffset !== 0 && periodLabel) || PRESETS.find(p => p.key === preset)?.label || 'Dönem',
              })}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"
              title="İşlemleri görüntüle"
            >
              <ListFilter size={13} />
              Detay
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[360px]">
            {isLoading ? <BarSkeleton /> : (
              <CashFlowBarChart
                data={cashFlowData}
                chartType={cashFlowChartType}
                onBarClick={p => openDetail({ from: p.from, to: p.to, label: p.label })}
              />
            )}
          </div>
        </div>
        <div className="px-5 pb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <LegendDot color="var(--cf-income)" label="Gelir" />
          <LegendDot color="var(--cf-expense)" label="Gider" />
          {/* Taksitli alışverişler burada aya yayılmaz — toplam tutar satın
              alma ayında görünür (bkz. collapseInstallments). */}
          {hasInstallment && (
            <span className="text-[11px] text-muted-foreground/80">
              Taksitli alışverişler satın alma ayına toplam yazılır
            </span>
          )}
        </div>
      </CardContent>
    </Card>
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
