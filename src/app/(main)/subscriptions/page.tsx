'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { Header }            from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState }        from '@/components/ui/EmptyState'
import { BrandLogo }         from '@/components/subscriptions/BrandLogo'
import { useTransactionStore, useInvestmentStore } from '@/store'
import { summarize }         from '@/lib/utils/subscriptions'
import { formatCurrency }    from '@/lib/utils/currency'
import { formatDate, daysUntil } from '@/lib/utils/date'

/* ── Sort control ──────────────────────────────────────────────────── */

type SortKey = 'cost' | 'date'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'cost', label: 'Tutar' },
  { value: 'date', label: 'Son tarih' },
]

/** "X gün önce" / "bugün" for a charge date. */
function agoLabel(iso: string): string {
  const days = daysUntil(iso)
  if (days >= 0) return days === 0 ? 'bugün' : `${days} gün sonra`
  return `${Math.abs(days)} gün önce`
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function SubscriptionsPage() {
  const transactions = useTransactionStore(useShallow(s => s.transactions))
  // Subscribe to prices so TRY estimates recompute once live FX rates load
  // (toBaseTry reads module-level rates published by the investment store).
  useInvestmentStore(s => s.prices)

  const [sort, setSort] = useState<SortKey>('cost')

  const { groups, serviceCount, monthTotalTry, monthlyEstimateTry } = useMemo(
    () => summarize(transactions),
    [transactions],
  )

  const sorted = useMemo(() => {
    const arr = [...groups]
    if (sort === 'date') arr.sort((a, b) => b.lastDate.localeCompare(a.lastDate))
    else arr.sort((a, b) => b.monthlyEstimateTry - a.monthlyEstimateTry)
    return arr
  }, [groups, sort])

  return (
    <>
      <Header title="Abonelikler" />

      <div className="p-6 flex flex-col gap-6">

        {serviceCount === 0 ? (
          <EmptyState
            icon="↻"
            title="Henüz abonelik yok"
            description="İşlem eklerken gideri 'Abonelik' olarak işaretleyin; Netflix, Spotify gibi düzenli harcamalarınız logolarıyla burada toplansın."
            action={
              <Link
                href="/transactions"
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                İşlemlere git
              </Link>
            }
          />
        ) : (
          <>
            {/* ── Stat row ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Bu ay" value={formatCurrency(monthTotalTry)} accent />
              <StatCard label="Aylık tahmini" value={formatCurrency(monthlyEstimateTry)} />
              <StatCard label="Abonelik sayısı" value={String(serviceCount)} />
            </div>

            {/* ── Sort control ──────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold">
                Abonelikler — {serviceCount}
              </div>
              <div className="flex border border-border rounded-xl overflow-hidden">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSort(opt.value)}
                    className={[
                      'px-3 py-1.5 text-xs font-semibold transition-colors',
                      sort === opt.value
                        ? 'bg-primary/[0.15] text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Subscription list ─────────────────────────────────── */}
            <Card className="gap-0 py-0">
              <CardContent className="p-0 divide-y divide-border">
                {sorted.map(g => (
                  <div key={g.key} className="flex items-center gap-4 px-5 py-4">
                    <BrandLogo brand={g.brand} name={g.name} size={40} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">{g.name}</span>
                        {g.count > 1 && (
                          <span className="text-[11px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-md bg-accent tabular-nums">
                            {g.count} ödeme
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{formatDate(g.lastDate)}</span>
                        <span>·</span>
                        <span>{agoLabel(g.lastDate)}</span>
                        <span>·</span>
                        <span className="tabular-nums">Toplam {formatCurrency(g.totalTry)}</span>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className="font-medium tabular-nums text-lg text-foreground">
                        {formatCurrency(g.latestAmount, g.currency)}
                      </div>
                      <div className="text-[11px] font-medium text-muted-foreground">son ödeme</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  )
}

/* ── Stat card ─────────────────────────────────────────────────────── */

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="py-0">
      <CardContent className="px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold">
          {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? 'text-primary' : 'text-foreground'}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
