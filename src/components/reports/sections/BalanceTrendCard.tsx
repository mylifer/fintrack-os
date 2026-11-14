'use client'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { BalanceTrendChart }   from '@/components/reports/BalanceTrendChart'
import type { TrendPoint }     from '@/components/reports/_BalanceTrendChart'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { BarSkeleton } from './skeletons'

/* ── Balance / Net Worth Trend ─────────────────────────────────────── */
export function BalanceTrendCard({
  isLoading, accountId, trendData,
}: {
  isLoading: boolean
  accountId: string
  trendData: TrendPoint[]
}) {
  // Seçili aralıktaki net değişim (ilk → son nokta), trend başlığında gösterilir
  const trendFirst = trendData[0]?.balance ?? 0
  const trendLast  = trendData.at(-1)?.balance ?? 0
  const trendDelta = trendLast - trendFirst
  const trendPct   = trendFirst !== 0 ? (trendDelta / Math.abs(trendFirst)) * 100 : 0

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
        <span className="text-sm font-semibold text-foreground/90">
          {accountId === 'all' ? 'Net Varlık Trendi' : 'Hesap Bakiye Trendi'}
        </span>
        {!isLoading && trendData.length > 0 && (
          <span className="flex items-center gap-3 text-xs font-medium tabular-nums">
            {trendData.length >= 2 && trendDelta !== 0 && (
              <span className={trendDelta >= 0 ? 'text-green-600' : 'text-destructive'}>
                {trendDelta >= 0 ? '+' : ''}{formatCompact(trendDelta)}
                {' '}({trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%)
              </span>
            )}
            <span className={trendLast >= 0 ? 'text-green-600' : 'text-destructive'}>
              Güncel: <AnimatedNumber value={trendLast} format={formatCurrency} />
            </span>
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <div className="min-w-[400px]">
            {isLoading ? <BarSkeleton /> : <BalanceTrendChart data={trendData} />}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
