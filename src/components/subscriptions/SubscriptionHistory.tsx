'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Transaction } from '@/types'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { BrandLogo } from './BrandLogo'
import { useInvestmentStore } from '@/store'
import { subscriptionMonthlyHistory } from '@/lib/utils/subscriptions'
import { formatCurrency, formatSigned } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { sumBy, subMoney, roundMoney } from '@/lib/utils/money'

const SubscriptionMonthlyChart = dynamic(
  () => import('./_SubscriptionMonthlyChart').then(m => ({ default: m.SubscriptionMonthlyChartInner })),
  { ssr: false, loading: () => <div className="h-[200px] rounded-lg bg-muted/40 animate-pulse" /> },
)

type RangeKey = 6 | 12 | 'all'

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 6,     label: '6 Ay' },
  { value: 12,    label: '12 Ay' },
  { value: 'all', label: 'Tümü' },
]

const monthName = (month: string) => formatDate(`${month}-01`, 'MMMM yyyy')

/** Geçmiş aylardaki abonelik harcaması: aylık çubuk grafik + seçilen ayın
 *  servis dökümü. Grafikteki bir aya tıklamak ya da oklarla gezinmek dökümü
 *  değiştirir; oklar her ayın değerine hover'a gerek kalmadan ulaştırır. */
export function SubscriptionHistory({ transactions }: { transactions: readonly Transaction[] }) {
  const [range, setRange]   = useState<RangeKey>(12)
  const [picked, setPicked] = useState<string | null>(null)
  // toBaseTry modül düzeyindeki kurları okur: canlı kurlar gelince yeniden hesapla.
  const prices = useInvestmentStore(s => s.prices)

  const history = useMemo(
    () => subscriptionMonthlyHistory(transactions, { months: range }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, range, prices],
  )

  const periodTotal = useMemo(() => sumBy(history, m => m.totalTry), [history])
  const average     = history.length ? roundMoney(periodTotal / history.length) : 0

  // Seçim yoksa ya da aralık daralınca dışarıda kaldıysa en son aya düş.
  // Dışarıda kalan seçim unutulur; yoksa aralık yeniden genişleyince eski
  // aya geri atlardı.
  const found    = picked ? history.findIndex(m => m.month === picked) : -1
  if (picked && found < 0) setPicked(null)
  const selIdx   = found >= 0 ? found : history.length - 1
  const selected = history[selIdx]
  const prev     = selIdx > 0 ? history[selIdx - 1] : undefined
  const delta    = selected && prev ? subMoney(selected.totalTry, prev.totalTry) : null
  const isCurrent = selected?.month === today().slice(0, 7)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/50">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground/90">Aylık harcama</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Dönem toplamı {formatCurrency(periodTotal)} · ortalama {formatCurrency(average)}/ay
          </div>
        </div>
        <div className="flex border border-border rounded-xl overflow-hidden">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setRange(opt.value)}
              aria-pressed={range === opt.value}
              className={[
                'px-3 py-1.5 text-xs font-semibold transition-colors',
                range === opt.value
                  ? 'bg-primary/[0.15] text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {!selected ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Geçmiş aylarda abonelik ödemesi yok.
          </div>
        ) : (
          <>
            <div className="px-3 sm:px-4 pt-4 pb-2">
              <SubscriptionMonthlyChart data={history} selected={selected.month} onSelect={setPicked} />
            </div>

            {/* ── Seçilen ay ─────────────────────────────────────────── */}
            <div className="border-t border-border/50">
              <div className="flex items-center gap-2 px-3 sm:px-4 py-3">
                <MonthStep
                  label="Önceki ay"
                  disabled={selIdx === 0}
                  onClick={() => setPicked(history[selIdx - 1].month)}
                >
                  <ChevronLeft size={16} />
                </MonthStep>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="truncate">{monthName(selected.month)}</span>
                    {isCurrent && (
                      <span className="text-[11px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-md bg-accent whitespace-nowrap">
                        devam ediyor
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                    {selected.count} ödeme
                    {delta !== null && (
                      delta === 0 ? ' · önceki ayla aynı' : (
                        <>
                          {' · '}
                          <span className={`tabular-nums ${delta > 0 ? 'text-destructive' : 'text-green-600'}`}>
                            {formatSigned(delta)}
                          </span>
                          {' önceki aya göre'}
                        </>
                      )
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 text-base font-semibold tabular-nums text-foreground">
                  {formatCurrency(selected.totalTry)}
                </div>

                <MonthStep
                  label="Sonraki ay"
                  disabled={selIdx === history.length - 1}
                  onClick={() => setPicked(history[selIdx + 1].month)}
                >
                  <ChevronRight size={16} />
                </MonthStep>
              </div>

              {selected.services.length === 0 ? (
                <div className="px-5 pb-5 text-sm text-muted-foreground">Bu ayda abonelik ödemesi yok.</div>
              ) : (
                <div className="divide-y divide-border/60 border-t border-border/50">
                  {selected.services.map(s => (
                    <Link
                      key={s.key}
                      href={`/subscriptions/${encodeURIComponent(s.key)}`}
                      className="flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-accent/50 transition-colors"
                    >
                      <BrandLogo brand={s.brand} name={s.name} size={28} />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                        {s.count > 1 && (
                          <span className="text-[11px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-md bg-accent tabular-nums whitespace-nowrap">
                            {s.count} ödeme
                          </span>
                        )}
                      </div>
                      <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums w-10 text-right">
                        %{selected.totalTry > 0 ? Math.round((s.totalTry / selected.totalTry) * 100) : 0}
                      </span>
                      <span className="text-sm font-medium tabular-nums text-foreground w-24 text-right">
                        {formatCurrency(s.totalTry)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MonthStep({ label, disabled, onClick, children }: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  )
}
