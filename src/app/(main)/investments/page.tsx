'use client'

import { useEffect, useState, useMemo } from 'react'
import { Header }            from '@/components/layout/Header'
import { BuySellModal }      from '@/components/investments/BuySellModal'
import { PriceHistoryChart, type BuyPoint, type QtyPoint } from '@/components/investments/PriceHistoryChart'
import { useInvestmentStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { formatDate }        from '@/lib/utils/date'
import { useCountUp }        from '@/lib/hooks/useCountUp'
import { AnimatedNumber }    from '@/components/ui/AnimatedNumber'
import type { InvestmentAsset } from '@/types'

type AssetGroup = 'GOLD' | 'USD' | 'EUR' | 'GBP'
const GOLD_ASSETS: InvestmentAsset[] = ['GOLD_GRAM', 'GOLD_QUARTER', 'GOLD_HALF', 'GOLD_FULL', 'GOLD_OZ']

// How many grams each gold unit represents
const GRAM_MULT: Partial<Record<InvestmentAsset, number>> = {
  GOLD_GRAM:    1,
  GOLD_QUARTER: 1.75,
  GOLD_HALF:    3.5,
  GOLD_FULL:    7.0,
  GOLD_OZ:      31.1035,
}

/* ── Asset metadata ──────────────────────────────────────────────── */

const ASSET_META: Record<InvestmentAsset, { label: string; icon: string; unit: string }> = {
  GOLD_GRAM:    { label: 'Gram Altın',       icon: 'Au', unit: 'gr' },
  GOLD_QUARTER: { label: 'Çeyrek Altın',     icon: 'Au', unit: 'adet' },
  GOLD_HALF:    { label: 'Yarım Altın',      icon: 'Au', unit: 'adet' },
  GOLD_FULL:    { label: 'Tam Altın',        icon: 'Au', unit: 'adet' },
  GOLD_OZ:      { label: 'Ons Altın',        icon: 'Au', unit: 'oz' },
  USD:          { label: 'ABD Doları',       icon: '$',  unit: '$' },
  EUR:          { label: 'Euro',             icon: '€',  unit: '€' },
  GBP:          { label: 'İngiliz Sterlini', icon: '£',  unit: '£' },
}

function pnlColor(pnl: number) {
  return pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-destructive' : 'text-muted-foreground'
}

function fmtQty(qty: number, unit: string) {
  const dec = unit === 'adet' ? 0 : unit === 'oz' ? 4 : 4
  return qty.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: dec }) + ' ' + unit
}

/* ── Page ───────────────────────────────────────────────────────── */

export default function InvestmentsPage() {
  const { load, transactions, prices, pricesLoading, pricesError, fetchPrices, getHoldings, removeTransaction } =
    useInvestmentStore()
  const accounts = useAccountStore(useShallow(s => s.accounts))

  const [modalOpen,    setModalOpen]    = useState(false)
  const [modalType,    setModalType]    = useState<'buy' | 'sell'>('buy')
  const [editingTx,    setEditingTx]    = useState<typeof transactions[number] | null>(null)
  const [confirmDeleteId, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    load()
    fetchPrices()
    const id = setInterval(fetchPrices, 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const holdings = getHoldings()
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0)
  const totalCost  = holdings.reduce((s, h) => s + h.totalCost, 0)
  const totalPnl   = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  const animTotalValue = useCountUp(totalValue)
  const animTotalCost  = useCountUp(totalCost)
  const animTotalPnl   = useCountUp(Math.abs(totalPnl))

  // Chart groups: one per price family.
  // Charts remain visible even after all units are sold (currentValue = 0).
  // qtyTimeline tracks cumulative quantity at each transaction date so the portfolio
  // line correctly reflects stepwise increases from multiple purchases.
  const chartGroups = useMemo<{
    key: AssetGroup; label: string
    currentValue?: number; currentPrice?: number
    buyPoints: BuyPoint[]; qtyTimeline: QtyPoint[]
  }[]>(() => {
    if (!transactions.length) return []
    const groups: {
      key: AssetGroup; label: string
      currentValue?: number; currentPrice?: number
      buyPoints: BuyPoint[]; qtyTimeline: QtyPoint[]
    }[] = []

    // ── Gold — aggregate all gold types into gram equivalents ─────────
    const goldTxs = transactions.filter(t => GOLD_ASSETS.includes(t.asset))
    const goldBuyTxs = goldTxs.filter(t => t.type === 'buy')
    if (goldBuyTxs.length) {
      const goldCurrentValue = holdings
        .filter(h => GOLD_ASSETS.includes(h.asset))
        .reduce((s, h) => s + h.currentValue, 0)
      const buyPoints: BuyPoint[] = goldBuyTxs.map(t => ({
        date: t.date,
        description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${ASSET_META[t.asset].label}`,
        totalCost: t.quantity * t.pricePerUnit,
      }))

      // Build gram-quantity timeline from all gold txs (buys + sells)
      const sortedGold = [...goldTxs].sort((a, b) => a.date.localeCompare(b.date))
      let cumGrams = 0
      const goldQtyTimeline: QtyPoint[] = sortedGold.map(t => {
        const mult = GRAM_MULT[t.asset] ?? 1
        cumGrams = Math.max(0, cumGrams + (t.type === 'buy' ? t.quantity * mult : -(t.quantity * mult)))
        return { date: t.date, qty: cumGrams }
      })

      groups.push({
        key: 'GOLD', label: 'Altın Portföyü',
        currentValue: prices ? goldCurrentValue : undefined,
        currentPrice: prices?.goldGramTry,
        buyPoints,
        qtyTimeline: goldQtyTimeline,
      })
    }

    // ── Currencies ───────────────────────────────────────────────────
    for (const [a, lbl] of [['USD', 'USD Portföyü'], ['EUR', 'EUR Portföyü'], ['GBP', 'GBP Portföyü']] as const) {
      const assetTxs = transactions.filter(t => t.asset === (a as InvestmentAsset))
      const buyTxs   = assetTxs.filter(t => t.type === 'buy')
      if (!buyTxs.length) continue

      const cp      = a === 'USD' ? prices?.usdTry : a === 'EUR' ? prices?.eurTry : prices?.gbpTry
      const holding = holdings.find(h => h.asset === a)
      const buyPoints: BuyPoint[] = buyTxs.map(t => ({
        date: t.date,
        description: `${t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${a}`,
        totalCost: t.quantity * t.pricePerUnit,
      }))

      const sortedTxs = [...assetTxs].sort((a, b) => a.date.localeCompare(b.date))
      let cumQty = 0
      const qtyTimeline: QtyPoint[] = sortedTxs.map(t => {
        cumQty = Math.max(0, cumQty + (t.type === 'buy' ? t.quantity : -t.quantity))
        return { date: t.date, qty: cumQty }
      })

      groups.push({
        key: a as AssetGroup, label: lbl,
        currentValue: prices ? (holding?.currentValue ?? 0) : undefined,
        currentPrice: cp,
        buyPoints,
        qtyTimeline,
      })
    }

    return groups
  }, [transactions, prices, holdings])

  const updatedAt = prices?.updatedAt
    ? new Date(prices.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null

  function openBuy()  { setEditingTx(null); setModalType('buy');  setModalOpen(true) }
  function openSell() { setEditingTx(null); setModalType('sell'); setModalOpen(true) }
  function openEdit(tx: typeof transactions[number]) { setEditingTx(tx); setModalOpen(true) }

  return (
    <>
      <Header
        title="Yatırımlar"
        action={{ label: 'İşlem Ekle', onClick: openBuy }}
      />

      {/* Live price ticker */}
      <div className="px-6 py-3 border-b border-border/50 bg-card flex items-center gap-6 overflow-x-auto flex-shrink-0">
        {prices ? (
          <>
            <Ticker label="USD/TRY"  value={prices.usdTry.toFixed(2)}  current={prices.usdTry}      previous={prices.prevUsdTry} />
            <Ticker label="EUR/TRY"  value={prices.eurTry.toFixed(2)}  current={prices.eurTry}      previous={prices.prevEurTry} />
            <Ticker label="GBP/TRY"  value={prices.gbpTry.toFixed(2)}  current={prices.gbpTry}      previous={prices.prevGbpTry} />
            <Ticker label="Altın/gr" value={`₺${prices.goldGramTry.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`} current={prices.goldGramTry} previous={prices.prevGoldGramTry} />
            <div className="ml-auto flex items-center gap-3 flex-shrink-0">
              {pricesError && (
                <span className="text-xs text-destructive font-medium">{pricesError}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {pricesLoading ? 'Güncelleniyor...' : updatedAt ? `Son: ${updatedAt}` : ''}
              </span>
              <button
                onClick={fetchPrices}
                disabled={pricesLoading}
                className="text-xs text-primary font-semibold hover:text-primary/80 disabled:opacity-40 transition-colors"
              >
                {pricesLoading ? '...' : 'Yenile'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {pricesLoading ? 'Fiyatlar yükleniyor...' : pricesError ? `Fiyatlar alınamadı: ${pricesError}` : 'Fiyat verisi yok'}
            </span>
            {!pricesLoading && (
              <button
                onClick={fetchPrices}
                className="text-xs text-primary font-semibold hover:text-primary/80 transition-colors"
              >
                Tekrar Dene
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col gap-6 overflow-auto flex-1">

        {/* Summary cards */}
        {(holdings.length > 0 || totalCost > 0) && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            <SumCard label="Toplam Değer"  value={formatCompact(animTotalValue)} />
            <SumCard label="Toplam Maliyet" value={formatCompact(animTotalCost)} />
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

        {/* Price history charts */}
        {chartGroups.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {chartGroups.map(g => (
              <PriceHistoryChart
                key={g.key}
                asset={g.key}
                label={g.label}
                currentValue={g.currentValue}
                currentPrice={g.currentPrice}
                buyPoints={g.buyPoints}
                qtyTimeline={g.qtyTimeline}
              />
            ))}
          </div>
        )}

        {/* Holdings */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">Portföy</span>
            <div className="flex gap-2">
              <button
                onClick={openBuy}
                className="px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-600/80 transition-colors"
              >Al</button>
              <button
                onClick={openSell}
                className="px-3 py-1.5 rounded-xl bg-destructive text-white text-xs font-semibold hover:bg-destructive/80 transition-colors"
              >Sat</button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
          {holdings.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Portföyde varlık yok. Yatırım işlemi ekleyin.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    {['Varlık', 'Miktar', 'Ort. Maliyet', 'Güncel Fiyat', 'Değer', 'K/Z', 'K/Z%'].map(h => (
                      <th key={h} className="px-4 py-4 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map(h => <HoldingRow key={h.asset} h={h} hasPrices={!!prices} />)}
                </tbody>
              </table>
            </div>
          )}
          </CardContent>
        </Card>

        {/* Transaction history */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">İşlem Geçmişi</span>
          </CardHeader>

          <CardContent className="p-0">
          {transactions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Henüz işlem yok.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {transactions.map(tx => {
                const meta = ASSET_META[tx.asset]
                const total = tx.quantity * tx.pricePerUnit
                const isBuy = tx.type === 'buy'
                const isConfirm = confirmDeleteId === tx.id
                const linkedAccount = isBuy
                  ? (tx.sourceAccountId ? accounts.find(a => a.id === tx.sourceAccountId) : null)
                  : (tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null)

                return (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-4 hover:bg-accent group transition-colors">
                    {/* Asset icon — color indicates buy (green) / sell (red) */}
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0 ${isBuy ? 'bg-green-600/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
                      {meta.icon}
                    </div>

                    {/* Asset + buy/sell pill + date + linked account */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        {meta.label}
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${isBuy ? 'bg-green-600/10 text-green-600' : 'bg-destructive/10 text-destructive'}`}>
                          {isBuy ? 'AL' : 'SAT'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{formatDate(tx.date)}</span>
                        {tx.note && <span>· {tx.note}</span>}
                        {linkedAccount
                          ? <span className="flex items-center gap-1">·
                              <span
                                className="w-1.5 h-1.5 rounded-full inline-block"
                                style={{ background: linkedAccount.color ?? '#00E5FF' }}
                              />
                              {linkedAccount.name}
                            </span>
                          : null
                        }
                      </div>
                    </div>

                    {/* Quantity */}
                    <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                      {fmtQty(tx.quantity, meta.unit)}
                    </span>

                    {/* Price per unit */}
                    <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                      {formatCurrency(tx.pricePerUnit)}/birim
                    </span>

                    {/* Total */}
                    <span className={`text-sm font-medium tabular-nums flex-shrink-0 ${isBuy ? 'text-destructive' : 'text-green-600'}`}>
                      {isBuy ? '−' : '+'}{formatCurrency(total)}
                    </span>

                    {/* Edit + Delete */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEdit(tx)}
                        className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs"
                        title="Düzenle"
                      >✏️</button>
                      {isConfirm ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { removeTransaction(tx.id); setConfirmDelete(null) }}
                            className="px-2 h-6 rounded-xl bg-destructive text-white text-xs font-semibold"
                          >Sil</button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="w-6 h-6 rounded-xl border border-border text-muted-foreground text-xs"
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(tx.id)}
                          className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-accent transition-colors text-base"
                        >×</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          </CardContent>
        </Card>
      </div>

      <BuySellModal
        open={modalOpen}
        defaultType={modalType}
        editingTx={editingTx}
        onClose={() => { setModalOpen(false); setEditingTx(null) }}
      />
    </>
  )
}

/* ── Sub-components ──────────────────────────────────────────────── */

function Ticker({ label, value, current, previous }: {
  label: string
  value: string
  current: number
  previous?: number
}) {
  const pct = previous && previous > 0
    ? ((current - previous) / previous) * 100
    : null

  return (
    <div className="flex-shrink-0">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-0.5">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium tabular-nums text-foreground">{value}</span>
        {pct !== null && (
          <span className={[
            'text-xs font-medium tabular-nums flex items-center gap-0.5',
            pct > 0 ? 'text-green-600' : pct < 0 ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}>
            {pct > 0 ? '▲' : pct < 0 ? '▼' : ''}
            {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}

type Holding = { asset: InvestmentAsset; quantity: number; avgCostPerUnit: number; currentPrice: number; currentValue: number; pnl: number; pnlPercent: number }

function HoldingRow({ h, hasPrices }: { h: Holding; hasPrices: boolean }) {
  const meta        = ASSET_META[h.asset]
  const animAvgCost = useCountUp(h.avgCostPerUnit)
  const animPrice   = useCountUp(h.currentPrice)
  const animValue   = useCountUp(h.currentValue)
  const animPnl     = useCountUp(Math.abs(h.pnl))
  return (
    <tr className="border-b border-border/50 hover:bg-accent transition-colors">
      <td className="px-4 py-4 font-medium text-foreground whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold bg-muted/50 text-foreground/60">{meta.icon}</span>
          {meta.label}
        </span>
      </td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-foreground">{fmtQty(h.quantity, meta.unit)}</td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-muted-foreground">{formatCurrency(animAvgCost)}</td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-muted-foreground">
        {hasPrices ? formatCurrency(animPrice) : '—'}
      </td>
      <td className="px-4 py-4 tabular-nums text-sm font-medium text-foreground">
        {hasPrices ? formatCurrency(animValue) : '—'}
      </td>
      <td className={`px-4 py-4 tabular-nums text-sm font-medium ${hasPrices ? pnlColor(h.pnl) : 'text-muted-foreground'}`}>
        {hasPrices ? ((h.pnl >= 0 ? '+' : '−') + formatCurrency(animPnl)) : '—'}
      </td>
      <td className={`px-4 py-4 tabular-nums text-sm font-medium ${hasPrices ? pnlColor(h.pnl) : 'text-muted-foreground'}`}>
        {hasPrices ? ((h.pnlPercent >= 0 ? '+' : '') + h.pnlPercent.toFixed(2) + '%') : '—'}
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
      <CardContent className="px-5 py-4">
        <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground block mb-2">
          {label}
        </span>
        <div className={`text-3xl font-normal tabular-nums ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
