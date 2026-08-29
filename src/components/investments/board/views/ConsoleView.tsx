'use client'

import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { Highlight, SortTh } from '@/components/ui/BoardBits'
import { PriceHistoryChart } from '@/components/investments/PriceHistoryChart'
import { ClassDot, DayCell, Sparkline, WeightBar } from '../bits'
import { fmtQty, pnlColor, fmtPct, sortRows, type AssetRow, type SortId } from '../shared'
import { qtyTimelineFor } from '../timeline'
import { useHistories, daysAgo, histKey } from '../useAssetHistory'
import { chartGroupOf } from '../shared'
import type { InvestmentTransaction } from '@/types'
import type { BuyPoint } from '@/components/investments/PriceHistoryChart'

/* ── Konsol ──────────────────────────────────────────────────────────────────
 * Tek yoğun tablo; grafik duvarı yok. Her satırda 30 günlük fiyat eğrisi ve pay
 * çubuğu var, satıra tıklayınca O VARLIĞIN grafiği satırın altında açılır.
 * Amaç: tüm pozisyonu tek ekranda, kaydırmadan karşılaştırmak.
 * ------------------------------------------------------------------------- */

const SPARK_DAYS = 30

export function ConsoleView({
  rows, transactions, query, sort, onSort,
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  query:        string
  sort:         SortId
  onSort:       (s: SortId) => void
}) {
  const [openAsset, setOpenAsset] = useState<string | null>(null)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])

  // Sparkline serileri: aynı seriyi paylaşan varlıklar tek istek açar
  const from = daysAgo(SPARK_DAYS + 8)   // hafta sonu/tatil boşlukları için pay
  const specs = useMemo(() => {
    const seen = new Map<string, { group: ReturnType<typeof chartGroupOf>['group']; fundCode?: string; from: string }>()
    for (const r of rows) {
      const { group, fundCode } = chartGroupOf(r.asset)
      seen.set(`${group}|${fundCode ?? ''}`, { group, fundCode, from })
    }
    return [...seen.values()]
  }, [rows, from])
  const { series } = useHistories(specs)

  function sparkFor(row: AssetRow): number[] {
    const { group, fundCode } = chartGroupOf(row.asset)
    const pts = series[histKey({ group, fundCode, from })]
    if (!pts?.length) return []
    return pts.slice(-SPARK_DAYS).map(p => p.price)
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 text-[10px] text-muted-foreground">
              <SortTh id="name"   sort={sort} onSort={onSort} className="pl-4 pr-3 text-left">Varlık</SortTh>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Miktar</th>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Ort. Mal.</th>
              <SortTh id="cost"   sort={sort} onSort={onSort} className="px-3 text-right">Maliyet</SortTh>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Fiyat</th>
              <th className="px-3 py-2 text-center font-semibold uppercase tracking-wide whitespace-nowrap">30 Gün</th>
              <SortTh id="day"    sort={sort} onSort={onSort} className="px-3 text-right">Günlük</SortTh>
              <SortTh id="value"  sort={sort} onSort={onSort} className="px-3 text-right">Değer</SortTh>
              <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Pay</th>
              <SortTh id="pnl"    sort={sort} onSort={onSort} className="px-3 text-right">K/Z</SortTh>
              <SortTh id="pnlPct" sort={sort} onSort={onSort} className="pl-3 pr-4 text-right">K/Z %</SortTh>
            </tr>
          </thead>

          <tbody>
            {sorted.map(r => {
              const open = openAsset === r.asset
              return (
                <FragmentRow
                  key={r.asset}
                  row={r}
                  open={open}
                  query={query}
                  spark={sparkFor(r)}
                  transactions={transactions}
                  onToggle={() => setOpenAsset(open ? null : r.asset)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({
  row: r, open, query, spark, transactions, onToggle,
}: {
  row:          AssetRow
  open:         boolean
  query:        string
  spark:        number[]
  transactions: InvestmentTransaction[]
  onToggle:     () => void
}) {
  const { group, fundCode } = chartGroupOf(r.asset)

  const buyPoints = useMemo<BuyPoint[]>(() => transactions
    .filter(t => t.asset === r.asset && t.type === 'buy')
    .map(t => ({
      date: t.date,
      description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${r.meta.label}`,
      totalCost: t.quantity * t.pricePerUnit,
    })), [transactions, r.asset, r.meta.label])

  const qtyTimeline = useMemo(() => qtyTimelineFor(r.asset, transactions), [r.asset, transactions])

  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={open}
        className={`border-b border-border/40 h-10 cursor-pointer transition-colors ${open ? 'bg-accent' : 'hover:bg-accent'}`}
      >
        <td className="pl-4 pr-3 whitespace-nowrap">
          <span className="inline-flex items-center gap-2">
            <span className={`text-[9px] text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            <ClassDot cls={r.cls} />
            <span className="font-medium text-foreground">
              <Highlight text={r.meta.label} query={query} />
            </span>
            {r.meta.subLabel && (
              <span className="text-[10px] text-muted-foreground max-w-[140px] truncate" title={r.meta.subLabel}>
                {r.meta.subLabel}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtQty(r.quantity, r.meta.unit)}</td>
        <td className="px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">{formatCurrency(r.avgCostPerUnit)}</td>
        <td className="px-3 text-right tabular-nums text-foreground whitespace-nowrap">{formatCurrency(r.totalCost)}</td>
        <td className="px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
          {r.hasPrices ? formatCurrency(r.currentPrice) : '—'}
        </td>
        <td className="px-3">
          <span className="flex justify-center"><Sparkline values={spark} /></span>
        </td>
        <td className="px-3 text-right tabular-nums whitespace-nowrap"><DayCell pct={r.dayPct} /></td>
        <td className="px-3 text-right tabular-nums font-medium text-foreground whitespace-nowrap">
          {r.hasPrices ? formatCurrency(r.currentValue) : '—'}
        </td>
        <td className="px-3 text-right whitespace-nowrap"><WeightBar weight={r.weight} cls={r.cls} /></td>
        <td className={`px-3 text-right tabular-nums whitespace-nowrap ${r.hasPrices ? pnlColor(r.pnl) : 'text-muted-foreground'}`}>
          {r.hasPrices ? (r.pnl >= 0 ? '+' : '−') + formatCurrency(Math.abs(r.pnl)) : '—'}
        </td>
        <td className={`pl-3 pr-4 text-right tabular-nums font-medium whitespace-nowrap ${r.hasPrices ? pnlColor(r.pnl) : 'text-muted-foreground'}`}>
          {r.hasPrices ? fmtPct(r.pnlPercent) : '—'}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-border/40 bg-secondary/30">
          <td colSpan={11} className="p-4">
            <PriceHistoryChart
              asset={group}
              fundCode={fundCode}
              label={`${r.meta.label} — Fiyat & Pozisyon`}
              currentValue={r.hasPrices ? r.currentValue : undefined}
              currentPrice={r.unitPrice || undefined}
              buyPoints={buyPoints}
              qtyTimeline={qtyTimeline}
            />
          </td>
        </tr>
      )}
    </>
  )
}
