'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAccountStore, useRecurringStore, useInvestmentStore, useTransactionStore, useDebtStore } from '@/store'
import { assetLabel, computeHoldings, getAssetPrice } from '@/store/investment.store'
import { isTefasAsset } from '@/lib/tefas'
import { buildForecast, type ForecastMode } from '@/lib/utils/forecast'
import { buildBalanceHistory, type InvestEvent } from '@/lib/utils/balance-history'
import { sumBy } from '@/lib/utils/money'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { FORECAST_VIEWS, type ForecastViewId } from '@/components/forecast/board/views'

type Horizon = number | 'all'

const HORIZONS: { key: Horizon; label: string }[] = [
  { key: 3,     label: '3 Ay'  },
  { key: 6,     label: '6 Ay'  },
  { key: 12,    label: '12 Ay' },
  { key: 'all', label: 'Tüm Zamanlar' },
]

// 'Tüm Zamanlar' geçmişin tamamını gösterir; ileri projeksiyon en geniş
// standart ufukla (12 ay) devam eder.
const ALL_TIME_FORWARD_MONTHS = 12

const MODES: { mode: ForecastMode; label: string }[] = [
  { mode: 'total', label: 'Tüm Varlıklar' },
  { mode: 'cash',  label: 'Sadece Nakit' },
]

const VIEW_STORAGE_KEY = 'forecast.viewMode'

export default function ForecastPage() {
  const accounts       = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const accountsReady  = useAccountStore(s => s.ready)
  const recurring      = useRecurringStore(s => s.recurring)
  const recurringReady = useRecurringStore(s => s.ready)
  const transactions   = useTransactionStore(s => s.transactions)
  const txReady        = useTransactionStore(s => s.ready)
  const debts          = useDebtStore(s => s.debts)
  const prices         = useInvestmentStore(s => s.prices)
  const pricesError    = useInvestmentStore(s => s.pricesError)
  const fundPricesLoading = useInvestmentStore(s => s.fundPricesLoading)
  const fundPrices     = useInvestmentStore(s => s.fundPrices)
  const investTxs      = useInvestmentStore(s => s.transactions)
  const { investmentsTry, fundsTry } = useMemo(() => {
    if (!prices) return { investmentsTry: 0, fundsTry: 0 }
    const holdings = computeHoldings(investTxs, prices, fundPrices)
    return {
      investmentsTry: sumBy(holdings, h => h.currentValue),
      fundsTry:       sumBy(holdings.filter(h => isTefasAsset(h.asset)), h => h.currentValue),
    }
  }, [investTxs, prices, fundPrices])

  const [horizon, setHorizon] = useState<Horizon>(6)
  const [mode, setMode] = useState<ForecastMode>('total')
  // Düzen tercihi kalıcı (SSR'da 'projection'a düşer).
  const [view, setView] = useState<ForecastViewId>(() => {
    if (typeof window === 'undefined') return 'projection'
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return FORECAST_VIEWS.some(v => v.id === saved) ? (saved as ForecastViewId) : 'projection'
  })
  const todayStr = today()

  function pickView(id: ForecastViewId) {
    setView(id)
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, id) } catch { /* özel pencere: yoksay */ }
  }

  const allTime = horizon === 'all'
  const horizonMonths = allTime ? ALL_TIME_FORWARD_MONTHS : horizon

  const forecast = useMemo(
    () => buildForecast({ accounts, recurring, transactions, debts, prices, investmentsTry, fundsTry, horizonMonths, todayStr, mode }),
    [accounts, recurring, transactions, debts, prices, investmentsTry, fundsTry, horizonMonths, todayStr, mode],
  )

  // Fiyatlar gelmeden (DataProvider açılışta çeker) tahmin portföysüz hesaplanır
  // ve yanlış bir "eksiye düşebilir" uyarısı parlar — fiyat (veya fiyat hatası)
  // ve işlem defteri hazır olana kadar iskelet göster. Hata durumunda beklemeyi
  // bırakırız: eldeki veriyle dürüstçe çizeriz.
  const pricesSettled = prices !== null || pricesError !== null
  const isLoading = !accountsReady || !recurringReady || !txReady || !pricesSettled || fundPricesLoading
  const { points, horizonEnd, shortfallDate, totalIncome, totalExpense, net, drivers, events } = forecast

  // Yatırım defteri satırları, güncel birim fiyatla TRY'ye çevrilmiş halde —
  // geçmiş yürüyüşü de projeksiyon gibi fiyatları sabit tutar.
  const investEvents = useMemo<InvestEvent[]>(() => {
    if (!prices) return []
    return investTxs.map(tx => ({
      date: tx.date.slice(0, 10),
      name: `${assetLabel(tx.asset)} ${tx.type === 'buy' ? 'alımı' : 'satışı'}`,
      type: tx.type === 'buy' ? 'buy' as const : 'sell' as const,
      valueTry: tx.quantity * getAssetPrice(tx.asset, prices, fundPrices),
      isTefas: isTefasAsset(tx.asset),
    }))
  }, [investTxs, prices, fundPrices])

  // 'Tüm Zamanlar': ilk işlem tarihinden bugüne gerçek bakiye geçmişi.
  // Bugünün noktası projeksiyonun ilk noktasıyla aynı değerdir; grafikte
  // teklemesin diye geçmişin son (bugün) noktası atılır.
  const history = useMemo(
    () => allTime
      ? buildBalanceHistory({ accounts, transactions, investEvents, mode, todayStr, endBalance: points[0]?.balance ?? 0 })
      : null,
    [allTime, accounts, transactions, investEvents, mode, todayStr, points],
  )
  const chartPoints = history ? [...history.points.slice(0, -1), ...points] : points
  const chartEvents = history ? [...history.events, ...events] : events

  const startBalance = points[0]?.balance ?? 0
  const endBalance   = points.at(-1)?.balance ?? startBalance
  const delta        = endBalance - startBalance
  const up           = delta >= 0

  const horizonLabel = `${horizonMonths} Ay`
  const ActiveView   = (FORECAST_VIEWS.find(v => v.id === view) ?? FORECAST_VIEWS[0]).Comp

  return (
    <>
      <Header title="Nakit Akışı Tahmini" />

      <div className="p-6 flex flex-col gap-6">

        {/* ── Süre + kapsam + düzen seçicileri ──────────────────────── */}
        <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Süre</span>
            <div className="flex items-center gap-1">
              {HORIZONS.map(h => (
                <button
                  key={h.key}
                  onClick={() => setHorizon(h.key)}
                  className={[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                    horizon === h.key
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                  ].join(' ')}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Kapsam</span>
            <div className="flex items-center gap-1">
              {MODES.map(m => (
                <button
                  key={m.mode}
                  onClick={() => setMode(m.mode)}
                  className={[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                    mode === m.mode
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                  ].join(' ')}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Görünüm</span>
            <div className="flex items-center gap-1">
              {FORECAST_VIEWS.map(v => (
                <button
                  key={v.id}
                  onClick={() => pickView(v.id)}
                  title={v.hint}
                  aria-pressed={view === v.id}
                  className={[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                    view === v.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                  ].join(' ')}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="px-5 py-4">
              <div className="h-2.5 w-24 bg-muted rounded animate-pulse mb-3" />
              <div className="h-8 w-40 bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
        ) : drivers.length === 0 && chartPoints.length <= 1 ? (
          <EmptyState
            icon="📈"
            title="Tahmin için yeterli veri yok"
            description="Nakit akışı tahmini, aktif tekrarlayan gelir ve giderlerinize göre hesaplanır. Önce tekrarlayan işlem ekleyin."
            action={
              <Link
                href="/recurring"
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Tekrarlayan İşlem Ekle
              </Link>
            }
          />
        ) : (
          <>
            {/* ── Projected end balance ─────────────────────────────── */}
            <Card>
              <CardContent className="px-5 py-4">
                <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">
                  {horizonLabel} sonra tahmini {mode === 'cash' ? 'nakit ' : ''}bakiye
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div className={`text-3xl font-semibold tabular-nums ${endBalance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                    {formatCurrency(endBalance)}
                  </div>
                  {delta !== 0 && (
                    <div className={`text-right shrink-0 ${up ? 'text-green-600' : 'text-destructive'}`}>
                      <div className="text-sm font-semibold tabular-nums">
                        {up ? '+' : '−'}{formatCompact(Math.abs(delta))}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">bugüne göre</div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1.5 font-medium tabular-nums">
                  Bugün: {formatCurrency(startBalance)}
                </div>
              </CardContent>
            </Card>

            {/* ── Shortfall warning ─────────────────────────────────── */}
            {shortfallDate && (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
                <span className="text-base leading-none mt-0.5">⚠</span>
                <div className="text-sm">
                  <span className="font-semibold">{formatDate(shortfallDate)}</span>{' '}
                  tarihinde bakiyen eksiye düşebilir.
                  <div className="text-xs opacity-80 mt-0.5">
                    Bu tarihe kadar gelir eklemen veya gideri azaltman gerekebilir.
                  </div>
                </div>
              </div>
            )}

            {/* ── Ufuk toplamları ────────────────────────────────────── */}
            {/* Kokpit kendi ölçü şeridini taşır — üç kartı orada tekrarlamıyoruz. */}
            {view !== 'cockpit' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                <SummaryCard label="Toplam Gelir"  value={formatCurrency(totalIncome)}  color="ok" />
                <SummaryCard label="Toplam Gider"  value={formatCurrency(totalExpense)} color="danger" prefix={totalExpense > 0 ? '−' : ''} />
                <SummaryCard
                  label="Net"
                  value={formatCurrency(Math.abs(net))}
                  color={net >= 0 ? 'ok' : 'danger'}
                  prefix={net >= 0 ? '+' : '−'}
                />
              </div>
            )}

            {/* ── Seçili düzen ───────────────────────────────────────── */}
            <ActiveView
              points={points}
              chartPoints={chartPoints}
              chartEvents={chartEvents}
              events={events}
              drivers={drivers}
              shortfallDate={shortfallDate}
              horizonEnd={horizonEnd}
              todayStr={todayStr}
              mode={mode}
            />
          </>
        )}
      </div>
    </>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function SummaryCard({
  label, value, color, prefix = '',
}: {
  label: string
  value: string
  color: 'ok' | 'danger' | 'neutral'
  prefix?: string
}) {
  const cls = color === 'ok' ? 'text-green-600' : color === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{prefix}{value}</div>
      </CardContent>
    </Card>
  )
}
