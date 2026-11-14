'use client'

import Link from 'next/link'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CategoryDonutChart }  from '@/components/reports/CategoryDonutChart'
import type { CategorySlice }  from '@/components/reports/_CategoryDonutChart'
import { formatCompact } from '@/lib/utils/currency'
import { DonutSkeleton, AdvancedSkeleton } from './skeletons'

export function TagAnalyticsRow({
  isLoading, tagData, topTags, tagSliceIdx, setTagSliceIdx,
}: {
  isLoading: boolean
  tagData: CategorySlice[]
  topTags: CategorySlice[]
  tagSliceIdx: number | null
  setTagSliceIdx: React.Dispatch<React.SetStateAction<number | null>>
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Etiket Dağılımı */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Etiket Dağılımı</span>
          {!isLoading && tagData.length > 0 && (
            <span className="text-xs text-muted-foreground">{tagData.length} etiket</span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[360px]">
              {isLoading ? <DonutSkeleton /> : tagData.length === 0 ? (
                <TagEmptyState />
              ) : (
                <CategoryDonutChart
                  data={tagData}
                  activeIndex={tagSliceIdx}
                  onDrillChange={() => setTagSliceIdx(null)}
                  onSliceClick={(_slice, idx) => setTagSliceIdx(prev => prev === idx ? null : idx)}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* En Aktif Etiketler */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">En Aktif Etiketler</span>
          {!isLoading && topTags.length > 0 && (
            <span className="text-xs text-muted-foreground">Gider hacmi</span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <AdvancedSkeleton />
          ) : topTags.length === 0 ? (
            <TagEmptyState />
          ) : (
            <div className="p-5 flex flex-col gap-0.5">
              {topTags.map((t, i) => {
                const width = topTags[0].amount > 0 ? (t.amount / topTags[0].amount) * 100 : 0
                return (
                  <Link
                    key={t.categoryId}
                    href={`/tags/${encodeURIComponent(t.name)}`}
                    className="group flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors"
                  >
                    <span className="text-[11px] tabular-nums text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: t.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-foreground/80 truncate group-hover:text-primary transition-colors">
                          #{t.name}
                        </span>
                        <span className="text-[13px] tabular-nums font-medium text-foreground/70 flex-shrink-0">
                          {formatCompact(t.amount)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: t.color }} />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}

function TagEmptyState() {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground/60 text-xl font-bold select-none">
        #
      </div>
      <p className="text-sm text-muted-foreground">Bu dönemde etiketli işlem bulunmuyor</p>
    </div>
  )
}
