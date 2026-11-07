'use client'

import { Fragment, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { closedPositions } from '@/lib/utils/closed-positions'
import { cashFlowsOf } from '@/lib/utils/period-pnl'
import { matchesTokens, tokenize } from '@/lib/utils/boardText'
import { getAssetPrice } from '@/store/investment.store'
import { PriceHistoryChart } from '@/components/investments/LazyCharts'
import type { BuyPoint } from '@/components/investments/PriceHistoryChart'
import { TransactionTable } from './TransactionTable'
import { ClassDot } from './bits'
import { qtyTimelineFor } from './timeline'
import { assetClass, assetMeta, chartGroupOf, fmtPct, pnlColor } from './shared'
import type { Account, InvestmentTransaction, PriceData, TefasFundPrice } from '@/types'

/* ── Kapanan pozisyonlar ─────────────────────────────────────────────────────
 * Tamamı satılmış varlıklar (ör. TP2) eldeki varlık listesinden düşer; bu
 * bölüm onları geri getirir. Satıra tıklanınca varlığın TÜM geçmişi (ilk
 * alımdan bugüne, MAX dönem) fiyat & pozisyon grafiği, alım/satış akışları
 * ve yalnız o varlığın işlemleriyle açılır. Görünümden bağımsızdır; arama
 * kutusu bu listeyi de süzer.
 * ------------------------------------------------------------------------- */

const fmtSigned = (v: number) => (v >= 0 ? '+' : '−') + formatCurrency(Math.abs(v))

function fmtDuration(days: number): string {
  if (days < 31) return `${days} gün`
  if (days < 365) return `${Math.round(days / 30.4)} ay`
  const y = days / 365
  return `${y.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} yıl`
}

export function ClosedPositions({
  transactions, prices, fundPrices, accounts, query, onEditTx, onDeleteTx,
}: {
  transactions: InvestmentTransaction[]
  prices:       PriceData | null
  fundPrices:   Record<string, TefasFundPrice>
  accounts:     Account[]
  query:        string
  onEditTx:     (tx: InvestmentTransaction) => void
  onDeleteTx:   (id: string) => void
}) {
  const all = useMemo(() => closedPositions(transactions), [transactions])
  const [open, setOpen] = useState<string | null>(null)

  const tokens = tokenize(query)
  const list = tokens.length
    ? all.filter(c => {
        const m = assetMeta(c.asset, fundPrices)
        return matchesTokens(`${m.label} ${m.subLabel ?? ''}`, tokens)
      })
    : all

  if (!all.length) return null

  const realizedTotal = list.reduce((s, c) => s + c.realized, 0)

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-5 h-11 flex items-center gap-3 border-b border-border/60">
        <span className="text-sm font-semibold text-foreground/90">Kapanan Pozisyonlar</span>
        <span className={`text-xs tabular-nums font-medium ${pnlColor(realizedTotal)}`}>
          {fmtSigned(realizedTotal)}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground hidden sm:block">
          Tamamı satılan varlıklar · geçmiş grafiği için satıra tıklayın
        </span>
      </div>

      {list.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">Aramaya uyan kapanmış pozisyon yok.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 text-left font-medium">Varlık</th>
                <th className="px-3 py-2 text-left font-medium">Dönem</th>
                <th className="px-3 py-2 text-right font-medium">Alış</th>
                <th className="px-3 py-2 text-right font-medium">Satış</th>
                <th className="px-3 py-2 text-right font-medium">Gerçekleşen K/Z</th>
                <th className="px-3 py-2 text-right font-medium">Yıllık (XIRR)</th>
                <th className="px-5 py-2 text-right font-medium" title="Son satış fiyatından bugüne birim fiyat değişimi">Satıştan beri</th>
              </tr>
            </thead>
            <tbody>
              {list.map(c => {
                const meta = assetMeta(c.asset, fundPrices)
                const isOpen = open === c.asset
                const price = getAssetPrice(c.asset, prices, fundPrices)
                const since = price > 0 && c.lastSellPrice > 0 ? ((price - c.lastSellPrice) / c.lastSellPrice) * 100 : null
                return (
                  <Fragment key={c.asset}>
                    <tr
                      className={`border-t border-border/40 cursor-pointer transition-colors ${isOpen ? 'bg-accent/60' : 'hover:bg-accent/40'}`}
                      onClick={() => setOpen(isOpen ? null : c.asset)}
                    >
                      <td className="px-5 py-2.5">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          className="flex items-center gap-2 text-left"
                          onClick={e => { e.stopPropagation(); setOpen(isOpen ? null : c.asset) }}
                        >
                          <span className="text-[10px] text-muted-foreground w-3">{isOpen ? '▾' : '▸'}</span>
                          <ClassDot cls={assetClass(c.asset)} />
                          <span className="font-medium text-foreground">{meta.label}</span>
                          {meta.subLabel && (
                            <span className="text-[11px] text-muted-foreground truncate max-w-[220px]" title={meta.subLabel}>
                              {meta.subLabel}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDate(c.firstBuy)} – {formatDate(c.lastSell)}
                        <span className="ml-1.5 text-[11px]">({fmtDuration(c.daysHeld)})</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/90">{formatCurrency(c.bought)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground/90">{formatCurrency(c.sold)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${pnlColor(c.realized)}`}>
                        {fmtSigned(c.realized)}
                        {c.realizedPct !== null && <span className="ml-1.5 text-[11px] font-normal">{fmtPct(c.realizedPct)}</span>}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${c.xirr === null ? 'text-muted-foreground' : pnlColor(c.xirr)}`}>
                        {c.xirr === null ? '—' : fmtPct(c.xirr * 100)}
                      </td>
                      <td className={`px-5 py-2.5 text-right tabular-nums ${since === null ? 'text-muted-foreground' : pnlColor(since)}`}>
                        {since === null ? '—' : fmtPct(since)}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border/40">
                        <td colSpan={7} className="px-5 py-4 bg-background/40">
                          <ClosedDetail
                            asset={c.asset}
                            label={meta.label}
                            transactions={transactions}
                            prices={prices}
                            fundPrices={fundPrices}
                            accounts={accounts}
                            onEditTx={onEditTx}
                            onDeleteTx={onDeleteTx}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ClosedDetail({
  asset, label, transactions, prices, fundPrices, accounts, onEditTx, onDeleteTx,
}: {
  asset:        InvestmentTransaction['asset']
  label:        string
  transactions: InvestmentTransaction[]
  prices:       PriceData | null
  fundPrices:   Record<string, TefasFundPrice>
  accounts:     Account[]
  onEditTx:     (tx: InvestmentTransaction) => void
  onDeleteTx:   (id: string) => void
}) {
  const assetTxs = useMemo(() => transactions.filter(t => t.asset === asset), [transactions, asset])
  const qtyTimeline = useMemo(() => qtyTimelineFor(asset, transactions), [asset, transactions])
  const cashFlows = useMemo(() => cashFlowsOf(assetTxs), [assetTxs])
  const buyPoints: BuyPoint[] = useMemo(() => assetTxs
    .filter(t => t.type === 'buy')
    .map(t => ({
      date: t.date,
      description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${label}`,
      totalCost: t.quantity * t.pricePerUnit,
    })), [assetTxs, label])

  const { group, fundCode } = chartGroupOf(asset)
  // Grafik geçmiş seri biriminde ankrajlanır (altında gram fiyatı) — bkz. buildRows.unitPrice
  const unitPrice = group === 'GOLD' ? (prices?.goldGramTry ?? 0) : getAssetPrice(asset, prices, fundPrices)

  return (
    <div className="flex flex-col gap-4">
      <PriceHistoryChart
        asset={group}
        fundCode={fundCode}
        label={`${label} — Fiyat & Pozisyon Geçmişi`}
        currentValue={0}
        currentPrice={unitPrice || undefined}
        buyPoints={buyPoints}
        qtyTimeline={qtyTimeline}
        cashFlows={cashFlows}
        defaultPeriod="MAX"
        closed
      />
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 h-10 flex items-center border-b border-border/60">
          <span className="text-sm font-semibold text-foreground/90">{label} işlemleri</span>
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
  )
}
