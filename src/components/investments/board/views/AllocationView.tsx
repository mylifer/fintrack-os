'use client'

import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { Highlight, SortTh } from '@/components/ui/BoardBits'
import { PortfolioValueChart } from '../PortfolioValueChart'
import { AllocBar, AllocLegend, ClassDot, DayCell, WeightBar, assetSegments, type AllocSegment } from '../bits'
import {
  CLASS_META, CLASS_ORDER, fmtQty, fmtPct, pctLabel, pnlColor, sortRows,
  type AssetClass, type AssetRow, type SortId,
} from '../shared'
import type { InvestmentTransaction } from '@/types'

/* ── Dağılım ─────────────────────────────────────────────────────────────────
 * Sayfanın kahramanı kompozisyon: portföy neyden oluşuyor, ne kadar yoğunlaşmış.
 * Üstte sınıf bazlı %100 yığılı çubuk (tıklanabilir — sınıfa iner), altında o
 * kapsamın varlık kırılımı, birleşik değer grafiği ve aynı kolon setli tablo.
 * ------------------------------------------------------------------------- */

export function AllocationView({
  rows, transactions, query, sort, onSort, totalValue,
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  query:        string
  sort:         SortId
  onSort:       (s: SortId) => void
  totalValue:   number
}) {
  const [scope, setScope] = useState<AssetClass | null>(null)

  const classSegments = useMemo<AllocSegment[]>(() =>
    CLASS_ORDER
      .map(cls => ({
        key:   cls,
        label: CLASS_META[cls].label,
        value: rows.filter(r => r.cls === cls).reduce((s, r) => s + r.currentValue, 0),
        color: CLASS_META[cls].color,
      }))
      .filter(s => s.value > 0),
  [rows])

  const scopeRows = useMemo(
    () => (scope ? rows.filter(r => r.cls === scope) : rows),
    [rows, scope],
  )

  const scopeValue = scopeRows.reduce((s, r) => s + r.currentValue, 0)
  const scopeCost  = scopeRows.reduce((s, r) => s + r.totalCost, 0)

  const assetSegs = useMemo(
    () => assetSegments([...scopeRows].sort((a, b) => b.currentValue - a.currentValue)).filter(s => s.value > 0),
    [scopeRows],
  )

  // Yoğunlaşma: en büyük pozisyon ve ilk üçün payı — "yumurtalar kaç sepette"
  const sortedByValue = useMemo(() => [...rows].sort((a, b) => b.currentValue - a.currentValue), [rows])
  const topShare  = totalValue > 0 && sortedByValue[0] ? sortedByValue[0].currentValue / totalValue : 0
  const top3Share = totalValue > 0
    ? sortedByValue.slice(0, 3).reduce((s, r) => s + r.currentValue, 0) / totalValue
    : 0

  const sorted = useMemo(() => sortRows(scopeRows, sort), [scopeRows, sort])

  return (
    <div className="flex flex-col gap-5">

      {/* ── Kompozisyon ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <span className="text-sm font-semibold text-foreground/90">Varlık Dağılımı</span>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground tabular-nums">
            <span>en büyük pozisyon {pctLabel(topShare)}</span>
            <span>ilk 3 varlık {pctLabel(top3Share)}</span>
          </div>
        </div>

        <AllocBar
          segments={classSegments}
          height={16}
          selectedKey={scope}
          onSelect={key => setScope(prev => (prev === key ? null : key as AssetClass))}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <AllocLegend
            segments={classSegments}
            selectedKey={scope}
            onSelect={key => setScope(prev => (prev === key ? null : key as AssetClass))}
          />
          {scope && (
            <button
              type="button"
              onClick={() => setScope(null)}
              className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              ✕ {CLASS_META[scope].label} kapsamından çık
            </button>
          )}
        </div>

        {/* Kapsam içi varlık kırılımı — sınıf hue'sunun açıklık basamakları */}
        {assetSegs.length > 1 && (
          <div className="mt-5 pt-4 border-t border-border/50">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {scope ? `${CLASS_META[scope].label} içi kırılım` : 'Varlık kırılımı'}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{formatCurrency(scopeValue)}</span>
            </div>
            <AllocBar segments={assetSegs} height={12} />
            <div className="mt-2.5">
              <AllocLegend segments={assetSegs} />
            </div>
          </div>
        )}
      </div>

      {/* ── Kapsamın değer geçmişi ───────────────────────────────── */}
      <PortfolioValueChart
        rows={scopeRows}
        transactions={transactions}
        totalValue={scopeValue}
        totalCost={scopeCost}
        title={scope ? `${CLASS_META[scope].label} Değeri` : 'Portföy Değeri'}
      />

      {/* ── Tablo ────────────────────────────────────────────────── */}
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
                <SortTh id="day"    sort={sort} onSort={onSort} className="px-3 text-right">Günlük</SortTh>
                <SortTh id="value"  sort={sort} onSort={onSort} className="px-3 text-right">Değer</SortTh>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Pay</th>
                <SortTh id="pnl"    sort={sort} onSort={onSort} className="px-3 text-right">K/Z</SortTh>
                <SortTh id="pnlPct" sort={sort} onSort={onSort} className="pl-3 pr-4 text-right">K/Z %</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.asset} className="border-b border-border/40 h-10 hover:bg-accent transition-colors">
                  <td className="pl-4 pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <ClassDot cls={r.cls} />
                      <span className="font-medium text-foreground">
                        <Highlight text={r.meta.label} query={query} />
                      </span>
                      {r.meta.subLabel && (
                        <span className="text-[10px] text-muted-foreground max-w-[150px] truncate" title={r.meta.subLabel}>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
