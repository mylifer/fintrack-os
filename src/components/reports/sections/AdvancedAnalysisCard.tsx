'use client'

import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CategoryTrendChart }  from '@/components/reports/CategoryTrendChart'
import type { CategoryTrendPoint }  from '@/components/reports/_CategoryTrendChart'
import { formatCompact } from '@/lib/utils/currency'
import type { CompareMode } from '@/lib/utils/period-compare'
import type { ComparisonRow } from '@/lib/reports/report-data'
import { AdvancedSkeleton } from './skeletons'

/* ── Advanced Analytics: dönem karşılaştırması + kategori 6-ay trendi ── */
export function AdvancedAnalysisCard({
  isLoading, compareMode, setCompareMode, prevPeriodLabel, comparisonData,
  trendCatKey, setTrendCatKey, activeTrendCat, catTrendData,
}: {
  isLoading: boolean
  compareMode: CompareMode
  setCompareMode: (m: CompareMode) => void
  prevPeriodLabel: string
  comparisonData: ComparisonRow[]
  trendCatKey: string
  setTrendCatKey: (k: string) => void
  activeTrendCat: ComparisonRow | null
  catTrendData: CategoryTrendPoint[]
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
        <span className="text-sm font-semibold text-foreground/90">Gelişmiş Analiz</span>
        {!isLoading && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex rounded-lg border border-border overflow-hidden print:hidden" role="group" aria-label="Karşılaştırma dönemi">
              {([['previous', 'Önceki dönem'], ['year', 'Geçen yıl']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCompareMode(mode)}
                  aria-pressed={compareMode === mode}
                  className={`px-2 py-0.5 transition-colors ${compareMode === mode ? 'bg-primary/10 text-primary font-medium' : 'hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </span>
            <span>{prevPeriodLabel}</span>
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
            <AdvancedSkeleton />
            <AdvancedSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">

            {/* Period comparison table */}
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Dönem Karşılaştırması
              </div>
              {comparisonData.length === 0 ? (
                <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
                  Gider verisi bulunamadı
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {comparisonData.map((row, idx) => {
                    const key = row.categoryId ?? '__none__'
                    const isActive = trendCatKey ? trendCatKey === key : idx === 0
                    return (
                      <button
                        key={key}
                        onClick={() => setTrendCatKey(isActive && !!trendCatKey ? '' : key)}
                        className={[
                          'flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors w-full',
                          isActive ? 'bg-muted' : 'hover:bg-accent',
                        ].join(' ')}
                      >
                        <span
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: row.color }}
                        />
                        <span className="text-[13px] text-foreground/80 flex-1 truncate min-w-0">
                          {row.name}
                        </span>
                        <span className="text-[13px] tabular-nums text-foreground/70 font-medium">
                          {formatCompact(row.current)}
                        </span>
                        <PctBadge pct={row.pct} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 6-month category trend */}
            <div className="p-5">
              {activeTrendCat ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: activeTrendCat.color }}
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Son 6 Ay — {activeTrendCat.name}
                    </span>
                  </div>
                  <CategoryTrendChart data={catTrendData} color={activeTrendCat.color} />
                </>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
                  Kategori seçin
                </div>
              )}
            </div>

          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PctBadge({ pct }: { pct: number }) {
  if (!isFinite(pct) || Math.abs(pct) < 0.5) {
    return <span className="text-[11px] text-muted-foreground tabular-nums w-12 text-right">—</span>
  }
  const up = pct > 0
  return (
    <span className={['text-[11px] font-semibold tabular-nums w-12 text-right', up ? 'text-destructive' : 'text-green-600'].join(' ')}>
      {up ? '+' : ''}{pct.toFixed(0)}%
    </span>
  )
}
