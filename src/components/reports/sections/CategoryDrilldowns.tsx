'use client'

import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { TransactionList }     from '@/components/transactions/TransactionList'
import type { CategorySlice }  from '@/components/reports/_CategoryDonutChart'
import { formatCurrency } from '@/lib/utils/currency'
import type { Transaction } from '@/types'

/* ── Gider / gelir kategori detay katmanları (drill-down) ──────────── */
export function CategoryDrilldowns({
  isLoading, selectedCat, catFilteredTxs, setSelectedCat, setActiveSliceIdx,
  selectedIncomeCat, incomeCatFilteredTxs, setSelectedIncomeCat, setActiveIncomeSliceIdx,
}: {
  isLoading: boolean
  selectedCat: CategorySlice | null
  catFilteredTxs: Transaction[]
  setSelectedCat: (s: CategorySlice | null) => void
  setActiveSliceIdx: (i: number | null) => void
  selectedIncomeCat: CategorySlice | null
  incomeCatFilteredTxs: Transaction[]
  setSelectedIncomeCat: (s: CategorySlice | null) => void
  setActiveIncomeSliceIdx: (i: number | null) => void
}) {
  return (
    <>
      {/* ── Category drill-down ───────────────────────────────────── */}
      {selectedCat && !isLoading && (
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border/50">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedCat.color }} />
            <span className="text-sm font-semibold text-foreground/90 flex-1">
              {selectedCat.name} — {catFilteredTxs.length} işlem
            </span>
            <span className="text-sm font-medium tabular-nums text-destructive">
              −{formatCurrency(selectedCat.amount)}
            </span>
            <button
              onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
              className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm flex-shrink-0"
              title="Kapat"
            >✕</button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto" style={{ maxHeight: 440 }}>
              <TransactionList
                transactions={catFilteredTxs}
                focusCategoryId={selectedCat.categoryId}
                showAccount
                emptyTitle="İşlem bulunamadı"
                emptyDescription="Seçili dönemde bu kategoride gider yok."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Income category drill-down ────────────────────────────── */}
      {selectedIncomeCat && !isLoading && (
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border/50">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedIncomeCat.color }} />
            <span className="text-sm font-semibold text-foreground/90 flex-1">
              {selectedIncomeCat.name} — {incomeCatFilteredTxs.length} işlem
            </span>
            <span className="text-sm font-medium tabular-nums text-green-600">
              +{formatCurrency(selectedIncomeCat.amount)}
            </span>
            <button
              onClick={() => { setSelectedIncomeCat(null); setActiveIncomeSliceIdx(null) }}
              className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm flex-shrink-0"
              title="Kapat"
            >✕</button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto" style={{ maxHeight: 440 }}>
              <TransactionList
                transactions={incomeCatFilteredTxs}
                focusCategoryId={selectedIncomeCat.categoryId}
                showAccount
                emptyTitle="İşlem bulunamadı"
                emptyDescription="Seçili dönemde bu kategoride gelir yok."
              />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
