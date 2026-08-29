'use client'

import { useMemo } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { Highlight, SortTh } from '@/components/ui/BoardBits'
import { PortfolioValueChart } from '../PortfolioValueChart'
import { DayCell, WeightBar } from '../bits'
import {
  CLASS_META, CLASS_ORDER, fmtQty, fmtPct, pctLabel, pnlColor, sortRows,
  type AssetClass, type AssetRow, type SortId,
} from '../shared'
import type { InvestmentTransaction } from '@/types'

/* ── Sınıf ───────────────────────────────────────────────────────────────────
 * Varlık başına ayrı grafik yerine TEK birleşik portföy grafiği; tablo ise
 * varlık sınıfına göre gruplu ve her grubun kendi ARA TOPLAMI var.
 * Amaç: "altın mı, döviz mi, fon mu kazandırıyor" sorusunu satır satır
 * toplamadan yanıtlamak.
 * ------------------------------------------------------------------------- */

interface Group {
  cls:        AssetClass
  rows:       AssetRow[]
  cost:       number
  value:      number
  pnl:        number
  pnlPercent: number
  weight:     number
  hasPrices:  boolean
}

export function GroupedView({
  rows, transactions, query, sort, onSort, totalValue, totalCost,
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  query:        string
  sort:         SortId
  onSort:       (s: SortId) => void
  totalValue:   number
  totalCost:    number
}) {
  const groups = useMemo<Group[]>(() => {
    const all = totalValue
    return CLASS_ORDER
      .map(cls => {
        const inCls = sortRows(rows.filter(r => r.cls === cls), sort)
        const cost  = inCls.reduce((s, r) => s + r.totalCost, 0)
        const value = inCls.reduce((s, r) => s + r.currentValue, 0)
        const pnl   = value - cost
        return {
          cls, rows: inCls, cost, value, pnl,
          pnlPercent: cost > 0 ? (pnl / cost) * 100 : 0,
          weight: all > 0 ? value / all : 0,
          hasPrices: inCls.some(r => r.hasPrices),
        }
      })
      .filter(g => g.rows.length > 0)
  }, [rows, sort, totalValue])

  return (
    <div className="flex flex-col gap-5">
      <PortfolioValueChart
        rows={rows}
        transactions={transactions}
        totalValue={totalValue}
        totalCost={totalCost}
      />

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

            {groups.map(g => (
              <tbody key={g.cls}>
                {/* Grup başlığı — yapışkan, sınıf rengi solda ince şerit olarak */}
                <tr className="sticky top-0 z-10 bg-secondary/80 backdrop-blur-sm">
                  <td colSpan={10} className="px-0 py-0">
                    <div className="flex items-center gap-2 pl-4 pr-4 h-8 border-y border-border/50">
                      <span className="w-1 h-3.5 rounded-full" style={{ background: CLASS_META[g.cls].color }} aria-hidden />
                      <span className="text-[11px] font-semibold text-foreground">{CLASS_META[g.cls].label}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{g.rows.length} varlık</span>
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        portföy payı {pctLabel(g.weight)}
                      </span>
                    </div>
                  </td>
                </tr>

                {g.rows.map(r => (
                  <tr key={r.asset} className="border-b border-border/40 h-10 hover:bg-accent transition-colors">
                    <td className="pl-4 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 pl-3">
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

                {/* Ara toplam — kolonlar satırlarla AYNI hizada kalır */}
                <tr className="border-b-2 border-border/60 h-9 bg-card">
                  <td className="pl-4 pr-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {CLASS_META[g.cls].label} toplamı
                  </td>
                  <td className="px-3" />
                  <td className="px-3" />
                  <td className="px-3 text-right tabular-nums font-semibold text-foreground whitespace-nowrap">{formatCurrency(g.cost)}</td>
                  <td className="px-3" />
                  <td className="px-3" />
                  <td className="px-3 text-right tabular-nums font-semibold text-foreground whitespace-nowrap">
                    {g.hasPrices ? formatCurrency(g.value) : '—'}
                  </td>
                  <td className="px-3 text-right whitespace-nowrap"><WeightBar weight={g.weight} cls={g.cls} /></td>
                  <td className={`px-3 text-right tabular-nums font-semibold whitespace-nowrap ${g.hasPrices ? pnlColor(g.pnl) : 'text-muted-foreground'}`}>
                    {g.hasPrices ? (g.pnl >= 0 ? '+' : '−') + formatCurrency(Math.abs(g.pnl)) : '—'}
                  </td>
                  <td className={`pl-3 pr-4 text-right tabular-nums font-semibold whitespace-nowrap ${g.hasPrices ? pnlColor(g.pnl) : 'text-muted-foreground'}`}>
                    {g.hasPrices ? fmtPct(g.pnlPercent) : '—'}
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </div>
  )
}
