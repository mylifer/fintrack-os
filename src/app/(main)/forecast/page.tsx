'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAccountStore, useRecurringStore, useInvestmentStore, useTransactionStore } from '@/store'
import { computeHoldings } from '@/store/investment.store'
import { buildForecast } from '@/lib/utils/forecast'
import { sumBy } from '@/lib/utils/money'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'

const Chart = dynamic(() => import('@/components/forecast/_ForecastChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>
  ),
})

const HORIZONS: { months: number; label: string }[] = [
  { months: 3,  label: '3 Ay'  },
  { months: 6,  label: '6 Ay'  },
  { months: 12, label: '12 Ay' },
]

export default function ForecastPage() {
  const accounts       = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const accountsReady  = useAccountStore(s => s.ready)
  const recurring      = useRecurringStore(s => s.recurring)
  const recurringReady = useRecurringStore(s => s.ready)
  const transactions   = useTransactionStore(s => s.transactions)
  const prices         = useInvestmentStore(s => s.prices)
  const fundPrices     = useInvestmentStore(s => s.fundPrices)
  const investTxs      = useInvestmentStore(s => s.transactions)
  const investmentsTry = useMemo(
    () => prices ? sumBy(computeHoldings(investTxs, prices, fundPrices), h => h.currentValue) : 0,
    [investTxs, prices, fundPrices],
  )

  const [horizonMonths, setHorizonMonths] = useState(6)
  const todayStr = today()

  const forecast = useMemo(
    () => buildForecast({ accounts, recurring, transactions, prices, investmentsTry, horizonMonths, todayStr }),
    [accounts, recurring, transactions, prices, investmentsTry, horizonMonths, todayStr],
  )

  const isLoading = !accountsReady || !recurringReady
  const { points, shortfallDate, totalIncome, totalExpense, net, drivers } = forecast

  const startBalance = points[0]?.balance ?? 0
  const endBalance   = points.at(-1)?.balance ?? startBalance
  const delta        = endBalance - startBalance
  const up           = delta >= 0

  const horizonLabel = HORIZONS.find(h => h.months === horizonMonths)?.label ?? `${horizonMonths} Ay`
  const maxDriver    = drivers[0]?.monthlyEquivTry ?? 0

  return (
    <>
      <Header title="Nakit Akışı Tahmini" />

      <div className="p-6 flex flex-col gap-6">

        {/* ── Horizon selector ──────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Süre</span>
          <div className="flex items-center gap-1">
            {HORIZONS.map(h => (
              <button
                key={h.months}
                onClick={() => setHorizonMonths(h.months)}
                className={[
                  'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                  horizonMonths === h.months
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                ].join(' ')}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="px-5 py-4">
              <div className="h-2.5 w-24 bg-muted rounded animate-pulse mb-3" />
              <div className="h-8 w-40 bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
        ) : drivers.length === 0 && points.length <= 1 ? (
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
                  {horizonLabel} sonra tahmini bakiye
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

            {/* ── Forecast chart ────────────────────────────────────── */}
            <Card className="overflow-hidden gap-0 py-0">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                <span className="text-sm font-semibold text-foreground/90">Bakiye Projeksiyonu</span>
                <span className="text-xs text-muted-foreground">Tahmini bakiye, yatırımlar dahil (₺)</span>
              </div>
              <CardContent className="p-0 py-4">
                <Chart points={points} shortfallDate={shortfallDate} />
              </CardContent>
            </Card>

            {/* ── Horizon summary ───────────────────────────────────── */}
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

            {/* ── Drivers ───────────────────────────────────────────── */}
            <Card className="overflow-hidden gap-0 py-0">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                <span className="text-sm font-semibold text-foreground/90">Aylık Etki</span>
                <span className="text-xs text-muted-foreground">{drivers.length} tekrarlayan işlem</span>
              </div>
              <CardContent className="p-5 flex flex-col gap-0.5">
                {drivers.map(d => {
                  const width  = maxDriver > 0 ? (d.monthlyEquivTry / maxDriver) * 100 : 0
                  const income = d.type === 'income'
                  const barColor = income ? '#00C853' : '#FF1744'
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: barColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] text-foreground/80 truncate">{d.name}</span>
                          <span className={`text-[13px] tabular-nums font-medium flex-shrink-0 ${income ? 'text-green-600' : 'text-destructive'}`}>
                            {income ? '+' : '−'}{formatCompact(d.monthlyEquivTry)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: barColor }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                <p className="text-[11px] text-muted-foreground mt-2">
                  Her işlemin aylığa çevrilmiş ortalama tutarı. Tahmin, işlemlerin gerçek tekrar tarihlerine göre hesaplanır.
                </p>
              </CardContent>
            </Card>
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
