'use client'

import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CategoryDonutChart }  from '@/components/reports/CategoryDonutChart'
import type { CategorySlice }  from '@/components/reports/_CategoryDonutChart'
import { FUND_GAIN_SLICE_ID, FUND_LOSS_SLICE_ID } from '@/lib/reports/report-data'
import { DonutSkeleton } from './skeletons'

/* ── Kategori dağılımları (gider + gelir donut'ları) ───────────────── */
export function CategoryDistributionRow({
  isLoading, categoryData, incomeCatData,
  selectedCat, setSelectedCat, activeSliceIdx, setActiveSliceIdx,
  selectedIncomeCat, setSelectedIncomeCat, activeIncomeSliceIdx, setActiveIncomeSliceIdx,
}: {
  isLoading: boolean
  categoryData: CategorySlice[]
  incomeCatData: CategorySlice[]
  selectedCat: CategorySlice | null
  setSelectedCat: (s: CategorySlice | null) => void
  activeSliceIdx: number | null
  setActiveSliceIdx: (i: number | null) => void
  selectedIncomeCat: CategorySlice | null
  setSelectedIncomeCat: (s: CategorySlice | null) => void
  activeIncomeSliceIdx: number | null
  setActiveIncomeSliceIdx: (i: number | null) => void
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Kategori Bazlı Giderler</span>
          {selectedCat && (
            <button
              onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: selectedCat.color }} />
              {selectedCat.name}
              <span className="ml-1 opacity-50">✕</span>
            </button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[360px]">
              {isLoading ? <DonutSkeleton /> : (
                <CategoryDonutChart
                  data={categoryData}
                  activeIndex={activeSliceIdx}
                  onDrillChange={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                  onSliceClick={(slice, idx) => {
                    if (activeSliceIdx === idx) {
                      setSelectedCat(null)
                      setActiveSliceIdx(null)
                    } else {
                      // "Yatırım Zararı" defter kategorisi değil → drill-down açılmaz.
                      setSelectedCat(slice.categoryId === FUND_LOSS_SLICE_ID ? null : slice)
                      setActiveSliceIdx(idx)
                    }
                  }}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Kategori Bazlı Gelirler</span>
          {selectedIncomeCat && (
            <button
              onClick={() => { setSelectedIncomeCat(null); setActiveIncomeSliceIdx(null) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <span className="w-2 h-2 rounded-sm inline-block" style={{ background: selectedIncomeCat.color }} />
              {selectedIncomeCat.name}
              <span className="ml-1 opacity-50">✕</span>
            </button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[360px]">
              {isLoading ? <DonutSkeleton /> : (
                <CategoryDonutChart
                  data={incomeCatData}
                  activeIndex={activeIncomeSliceIdx}
                  emptyMessage="Bu dönemde gelir kaydedilmemiş"
                  onDrillChange={() => { setSelectedIncomeCat(null); setActiveIncomeSliceIdx(null) }}
                  onSliceClick={(slice, idx) => {
                    if (activeIncomeSliceIdx === idx) {
                      setSelectedIncomeCat(null)
                      setActiveIncomeSliceIdx(null)
                      return
                    }
                    setActiveIncomeSliceIdx(idx)
                    // "Fon Getirisi" bir defter kategorisi değil: gerçekleşmemiş
                    // kısmının işlem satırı yok, dolayısıyla başlıktaki toplam
                    // listeyle tutmaz → yalnız vurgulanır, drill-down açılmaz.
                    setSelectedIncomeCat(slice.categoryId === FUND_GAIN_SLICE_ID ? null : slice)
                  }}
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
