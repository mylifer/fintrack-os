'use client'

import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { Highlight } from '@/components/ui/BoardBits'
import { PriceHistoryChart, type BuyPoint } from '@/components/investments/PriceHistoryChart'
import { TransactionTable } from '../TransactionTable'
import { ClassDot, DayCell, Sparkline } from '../bits'
import { qtyTimelineFor } from '../timeline'
import { useHistories, daysAgo, histKey } from '../useAssetHistory'
import {
  CLASS_META, chartGroupOf, fmtQty, fmtPct, pnlColor, sortRows,
  type AssetRow, type SortId,
} from '../shared'
import type { Account, InvestmentTransaction, TefasFundPrice } from '@/types'

/* ── Odak ────────────────────────────────────────────────────────────────────
 * Sayfa bir tarama listesi değil, çalışma tezgâhı: solda kompakt varlık rayı
 * (32px satır), sağda seçili varlığın her şeyi — grafiği, pozisyon künyesi ve
 * YALNIZCA o varlığın işlemleri. Portföyde çok varlık varken tek varlığa
 * odaklanmak için sayfayı kaydırmak gerekmiyor.
 * ------------------------------------------------------------------------- */

const SPARK_DAYS = 30

export function FocusView({
  rows, transactions, fundPrices, accounts, query, sort, onEditTx, onDeleteTx,
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  fundPrices:   Record<string, TefasFundPrice>
  accounts:     Account[]
  query:        string
  sort:         SortId
  onEditTx:     (tx: InvestmentTransaction) => void
  onDeleteTx:   (id: string) => void
}) {
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  const [selected, setSelected] = useState<string | null>(null)

  // Seçili varlık listeden düşerse (arama/satış) ilk satıra DÜŞÜLÜR — seçim
  // türetilir, efektle geri yazılmaz (zincirleme render olmasın).
  const active = sorted.find(r => r.asset === selected) ?? sorted[0] ?? null

  const from = daysAgo(SPARK_DAYS + 8)
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
    return (series[histKey({ group, fundCode, from })] ?? []).slice(-SPARK_DAYS).map(p => p.price)
  }

  if (!active) return null

  const assetTxs = transactions.filter(t => t.asset === active.asset)
  const { group, fundCode } = chartGroupOf(active.asset)

  const buyPoints: BuyPoint[] = assetTxs
    .filter(t => t.type === 'buy')
    .map(t => ({
      date: t.date,
      description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${active.meta.label}`,
      totalCost: t.quantity * t.pricePerUnit,
    }))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">

      {/* ── Varlık rayı ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden lg:sticky lg:top-0">
        <div className="px-3 h-8 flex items-center border-b border-border/60">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Varlıklar
          </span>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{sorted.length}</span>
        </div>

        <div className="divide-y divide-border/40">
          {sorted.map(r => {
            const on = r.asset === active.asset
            return (
              <button
                key={r.asset}
                type="button"
                onClick={() => setSelected(r.asset)}
                aria-pressed={on}
                className={`w-full h-8 px-3 flex items-center gap-2 text-left transition-colors ${
                  on ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                <ClassDot cls={r.cls} />
                <span className={`text-xs truncate ${on ? 'font-semibold text-foreground' : 'text-foreground/90'}`}>
                  <Highlight text={r.meta.label} query={query} />
                </span>
                <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {r.hasPrices ? formatCurrency(r.currentValue) : '—'}
                  </span>
                  <span className={`text-[10px] tabular-nums w-12 text-right ${r.hasPrices ? pnlColor(r.pnl) : 'text-muted-foreground'}`}>
                    {r.hasPrices ? fmtPct(r.pnlPercent, 1) : '—'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Detay ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-5 min-w-0">

        {/* Künye */}
        <div className="rounded-xl border border-border/60 bg-card px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                  style={{ background: CLASS_META[active.cls].color + '22', color: 'inherit' }}
                >
                  {CLASS_META[active.cls].label}
                </span>
                <span className="text-sm font-semibold text-foreground">{active.meta.label}</span>
              </div>
              {active.meta.subLabel && (
                <span className="block text-[11px] text-muted-foreground mt-0.5 max-w-[420px] truncate" title={active.meta.subLabel}>
                  {active.meta.subLabel}
                </span>
              )}
              <div className="flex items-baseline gap-2.5 mt-2">
                <span className="text-2xl font-medium text-foreground" style={{ fontVariantNumeric: 'proportional-nums' }}>
                  {active.hasPrices ? formatCurrency(active.currentValue) : '—'}
                </span>
                <span className={`text-xs font-semibold tabular-nums ${active.hasPrices ? pnlColor(active.pnl) : 'text-muted-foreground'}`}>
                  {active.hasPrices
                    ? `${active.pnl >= 0 ? '+' : '−'}${formatCurrency(Math.abs(active.pnl))} · ${fmtPct(active.pnlPercent)}`
                    : '—'}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Sparkline values={sparkFor(active)} w={110} h={32} />
              <span className="text-[10px] text-muted-foreground">son 30 gün · birim fiyat</span>
            </div>
          </div>

          {/* Pozisyon künyesi — kolon hizalı */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-3 mt-4 pt-4 border-t border-border/50">
            <Stat label="Miktar"        value={fmtQty(active.quantity, active.meta.unit)} />
            <Stat label="Ort. Maliyet"  value={formatCurrency(active.avgCostPerUnit)} />
            <Stat label="Toplam Maliyet" value={formatCurrency(active.totalCost)} />
            <Stat label="Güncel Fiyat"  value={active.hasPrices ? formatCurrency(active.currentPrice) : '—'} />
            <Stat label="Günlük"        value={<DayCell pct={active.dayPct} />} />
          </dl>
        </div>

        {/* Grafik */}
        <PriceHistoryChart
          asset={group}
          fundCode={fundCode}
          label={`${active.meta.label} — Fiyat & Pozisyon`}
          currentValue={active.hasPrices ? active.currentValue : undefined}
          currentPrice={active.unitPrice || undefined}
          buyPoints={buyPoints}
          qtyTimeline={qtyTimelineFor(active.asset, transactions)}
        />

        {/* Yalnızca bu varlığın işlemleri */}
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <div className="px-5 h-11 flex items-center border-b border-border/60">
            <span className="text-sm font-semibold text-foreground/90">{active.meta.label} işlemleri</span>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{assetTxs.length} işlem</span>
          </div>
          <TransactionTable
            transactions={assetTxs}
            fundPrices={fundPrices}
            accounts={accounts}
            onEdit={onEditTx}
            onDelete={onDeleteTx}
            showAsset={false}
          />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground mt-0.5">{value}</dd>
    </div>
  )
}
