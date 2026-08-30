'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { PriceHistoryChart, type BuyPoint } from '@/components/investments/PriceHistoryChart'
import { GOLD_GRAMS } from '@/store/investment.store'
import { tefasAsset, tefasCodesIn } from '@/lib/tefas'
import { assetMeta, fmtQty, pnlColor, sortRows, type AssetRow, type SortId } from '../shared'
import type { QtyPoint } from '../timeline'
import type { AssetGroup } from '@/app/api/prices/history/route'
import type {
  InvestmentAsset, InvestmentHolding, InvestmentTransaction, PriceData, TefasFundPrice,
} from '@/types'

/* ── Klasik ──────────────────────────────────────────────────────────────────
 * Yeniden tasarım ÖNCESİNDEKİ Yatırımlar düzeni, olduğu gibi: dört özet kartı,
 * varlık ailesi başına ayrı fiyat grafiği ızgarası ve "Portföy" tablosu.
 * Varsayılan görünüm budur; diğer dördü alternatiftir.
 *
 * Eski sayfadan iki şey KASITLI olarak taşınmadı, çünkü kabuk onları zaten
 * veriyor: canlı fiyat şeridi ve işlem geçmişi (geçmiş artık kolonlu tabloda —
 * tx-list-views kolon kuralı). Geri kalan her şey birebir aynı.
 * ------------------------------------------------------------------------- */

const GOLD_ASSETS: InvestmentAsset[] = [
  'GOLD_GRAM', 'GOLD_QUARTER', 'GOLD_HALF', 'GOLD_FULL', 'GOLD_OZ', 'GOLD_BRACELET',
]

interface ChartGroup {
  key: string; asset: AssetGroup; fundCode?: string; label: string
  currentValue?: number; currentPrice?: number; currentPrevPrice?: number
  buyPoints: BuyPoint[]; qtyTimeline: QtyPoint[]
}

export function ClassicView({
  rows, transactions, prices, fundPrices, sort, totalValue, totalCost, onBuy, onSell,
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  prices:       PriceData | null
  fundPrices:   Record<string, TefasFundPrice>
  /** Kabuktaki sıralama seçicisi bu görünümde de çalışsın. */
  sort:         SortId
  totalValue:   number
  totalCost:    number
  onBuy:        () => void
  onSell:       () => void
}) {
  const totalPnl    = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  const animTotalValue = useCountUp(totalValue)
  const animTotalCost  = useCountUp(totalCost)
  const animTotalPnl   = useCountUp(Math.abs(totalPnl))

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])

  // Arama satırları süzdüğünde grafik ızgarası da süzülen varlıkları izler.
  const scopedTxs = useMemo(() => {
    const keep = new Set(rows.map(r => r.asset))
    return transactions.filter(t => keep.has(t.asset))
  }, [rows, transactions])

  /* Grafik grupları: fiyat ailesi başına bir grafik. Tüm birimler satılmış olsa
     bile (currentValue = 0) grafik görünür kalır. qtyTimeline her işlem
     tarihindeki kümülatif miktarı taşır; böylece çoklu alımlar portföy
     çizgisine basamak basamak yansır. (Eski sayfadan birebir taşındı.) */
  const chartGroups = useMemo<ChartGroup[]>(() => {
    if (!scopedTxs.length) return []
    const groups: ChartGroup[] = []
    const holdingOf = (a: InvestmentAsset): InvestmentHolding | undefined => rows.find(r => r.asset === a)

    const timelineOf = (txs: InvestmentTransaction[], mult?: (a: InvestmentAsset) => number): QtyPoint[] => {
      const sorted = [...txs].sort((a, b) =>
        a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      let cum = 0
      return sorted.map(t => {
        const m = mult ? mult(t.asset) : 1
        cum = Math.max(0, cum + (t.type === 'buy' ? t.quantity * m : -(t.quantity * m)))
        return { date: t.date, qty: cum }
      })
    }

    // ── Altın — tüm altın türleri gram eşdeğerinde tek grafikte ───────
    const goldTxs    = scopedTxs.filter(t => GOLD_ASSETS.includes(t.asset))
    const goldBuyTxs = goldTxs.filter(t => t.type === 'buy')
    if (goldBuyTxs.length) {
      const goldValue = rows
        .filter(r => GOLD_ASSETS.includes(r.asset))
        .reduce((s, r) => s + r.currentValue, 0)

      groups.push({
        key: 'GOLD', asset: 'GOLD', label: 'Altın Portföyü',
        currentValue: prices ? goldValue : undefined,
        currentPrice: prices?.goldGramTry,
        buyPoints: goldBuyTxs.map(t => ({
          date: t.date,
          description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${assetMeta(t.asset, fundPrices).label}`,
          totalCost: t.quantity * t.pricePerUnit,
        })),
        qtyTimeline: timelineOf(goldTxs, a => GOLD_GRAMS[a] ?? 1),
      })
    }

    // ── Dövizler ─────────────────────────────────────────────────────
    for (const [a, lbl] of [['USD', 'USD Portföyü'], ['EUR', 'EUR Portföyü'], ['GBP', 'GBP Portföyü']] as const) {
      const assetTxs = scopedTxs.filter(t => t.asset === (a as InvestmentAsset))
      const buyTxs   = assetTxs.filter(t => t.type === 'buy')
      if (!buyTxs.length) continue

      const cp = a === 'USD' ? prices?.usdTry : a === 'EUR' ? prices?.eurTry : prices?.gbpTry

      groups.push({
        key: a, asset: a as AssetGroup, label: lbl,
        currentValue: prices ? (holdingOf(a as InvestmentAsset)?.currentValue ?? 0) : undefined,
        currentPrice: cp,
        buyPoints: buyTxs.map(t => ({
          date: t.date,
          description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${a}`,
          totalCost: t.quantity * t.pricePerUnit,
        })),
        qtyTimeline: timelineOf(assetTxs),
      })
    }

    // ── TEFAS fonları — her fon kodu kendi grafiği ────────────────────
    for (const code of tefasCodesIn(scopedTxs.map(t => t.asset))) {
      const asset   = tefasAsset(code)
      const fundTxs = scopedTxs.filter(t => t.asset === asset)
      const buyTxs  = fundTxs.filter(t => t.type === 'buy')
      if (!buyTxs.length) continue

      const fp = fundPrices[code]

      groups.push({
        key: asset, asset: 'TEFAS', fundCode: code,
        label: `${code} Portföyü`,
        currentValue: fp ? (holdingOf(asset)?.currentValue ?? 0) : undefined,
        currentPrice: fp?.price,
        currentPrevPrice: fp?.prevPrice,
        buyPoints: buyTxs.map(t => ({
          date: t.date,
          description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} pay ${code}`,
          totalCost: t.quantity * t.pricePerUnit,
        })),
        qtyTimeline: timelineOf(fundTxs),
      })
    }

    return groups
  }, [scopedTxs, rows, prices, fundPrices])

  return (
    <div className="flex flex-col gap-6">

      {/* ── Özet kartları ─────────────────────────────────────────────
          Değer/maliyet TAM gösterilir: formatCompact ≥1 Mn'yi "₺1,2 Mn"ye
          yuvarlıyordu ve portföyün gerçek tutarı okunamıyordu. */}
      {(rows.length > 0 || totalCost > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          <SumCard label="Toplam Değer"   value={formatCurrency(animTotalValue)} />
          <SumCard label="Toplam Maliyet" value={formatCurrency(animTotalCost)} />
          <SumCard
            label="Kar / Zarar"
            value={(totalPnl >= 0 ? '+' : '−') + formatCompact(animTotalPnl)}
            color={totalPnl > 0 ? 'ok' : totalPnl < 0 ? 'danger' : 'neutral'}
          />
          <SumCard
            label="K/Z %"
            value={(totalPnlPct >= 0 ? '+' : '') + totalPnlPct.toFixed(2) + '%'}
            color={totalPnlPct > 0 ? 'ok' : totalPnlPct < 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      {/* ── Fiyat geçmişi grafikleri ──────────────────────────────── */}
      {chartGroups.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {chartGroups.map(g => (
            <PriceHistoryChart
              key={g.key}
              asset={g.asset}
              fundCode={g.fundCode}
              label={g.label}
              currentValue={g.currentValue}
              currentPrice={g.currentPrice}
              currentPrevPrice={g.currentPrevPrice}
              buyPoints={g.buyPoints}
              qtyTimeline={g.qtyTimeline}
            />
          ))}
        </div>
      )}

      {/* ── Portföy tablosu ──────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Portföy</span>
          <div className="flex gap-2">
            <button
              onClick={onBuy}
              className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-600/80 transition-colors"
            >Al</button>
            <button
              onClick={onSell}
              className="px-3 py-1.5 rounded-xl bg-destructive text-white text-xs font-semibold hover:bg-destructive/80 transition-colors"
            >Sat</button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Portföyde varlık yok. Yatırım işlemi ekleyin.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    {['Varlık', 'Miktar', 'Ort. Maliyet', 'Toplam Maliyet', 'Güncel Fiyat', 'Değer', 'K/Z', 'K/Z%'].map(h => (
                      <th key={h} className="px-4 py-4 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => <HoldingRow key={r.asset} r={r} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ── Alt bileşenler (eski sayfadan birebir) ─────────────────────────── */

function HoldingRow({ r }: { r: AssetRow }) {
  const animAvgCost   = useCountUp(r.avgCostPerUnit)
  const animTotalCost = useCountUp(r.totalCost)
  const animPrice     = useCountUp(r.currentPrice)
  const animValue     = useCountUp(r.currentValue)
  const animPnl       = useCountUp(Math.abs(r.pnl))
  const has = r.hasPrices

  return (
    <tr className="border-b border-border/50 hover:bg-accent transition-colors">
      <td className="px-4 py-4 font-medium text-foreground whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold bg-muted/50 text-foreground/60">
            {r.meta.icon}
          </span>
          <span>
            {r.meta.label}
            {r.meta.subLabel && (
              <span className="block text-[10px] font-normal text-muted-foreground max-w-[180px] truncate" title={r.meta.subLabel}>
                {r.meta.subLabel}
              </span>
            )}
          </span>
        </span>
      </td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-foreground">{fmtQty(r.quantity, r.meta.unit)}</td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-muted-foreground">{formatCurrency(animAvgCost)}</td>
      {/* Elde kalan miktarın maliyet bazı (satışlarda ort. maliyetle azalır) —
          K/Z bu tutara göre hesaplandığı için fiyat verisinden bağımsız gösterilir. */}
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-foreground">{formatCurrency(animTotalCost)}</td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-muted-foreground">
        {has ? formatCurrency(animPrice) : '—'}
      </td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-foreground">
        {has ? formatCurrency(animValue) : '—'}
      </td>
      <td className={`px-4 py-4 tabular-nums text-sm font-medium ${has ? pnlColor(r.pnl) : 'text-muted-foreground'}`}>
        {has ? ((r.pnl >= 0 ? '+' : '−') + formatCurrency(animPnl)) : '—'}
      </td>
      <td className={`px-4 py-4 tabular-nums text-sm font-medium ${has ? pnlColor(r.pnl) : 'text-muted-foreground'}`}>
        {has ? ((r.pnlPercent >= 0 ? '+' : '') + r.pnlPercent.toFixed(2) + '%') : '—'}
      </td>
    </tr>
  )
}

function SumCard({ label, value, color = 'neutral' }: {
  label: string; value: string; color?: 'ok' | 'danger' | 'neutral'
}) {
  const colorClass = color === 'ok' ? 'text-green-600' : color === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="@container px-4 sm:px-5 py-4">
        <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground block mb-2">
          {label}
        </span>
        <div className={`kpi-value font-normal tabular-nums ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
