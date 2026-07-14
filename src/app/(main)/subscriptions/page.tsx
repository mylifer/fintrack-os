'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { Header }            from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState }        from '@/components/ui/EmptyState'
import { CategoryIcon }      from '@/components/categories/CategoryIcon'
import { useRecurringStore, useCategoryStore, useInvestmentStore } from '@/store'
import { summarize, monthlyEquivalentTry } from '@/lib/utils/subscriptions'
import { formatCurrency }    from '@/lib/utils/currency'
import { formatDate, daysUntil, today } from '@/lib/utils/date'
import type { RecurringTransaction, RecurringFrequency } from '@/types'

/* ── Constants ─────────────────────────────────────────────────────── */

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  daily:   'Günlük',
  weekly:  'Haftalık',
  monthly: 'Aylık',
  yearly:  'Yıllık',
}

type SortKey = 'cost' | 'renewal'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'cost',    label: 'Aylık maliyet' },
  { value: 'renewal', label: 'Yenilenme tarihi' },
]

const RENEWAL_WINDOW_DAYS = 30

/* ── Helpers ───────────────────────────────────────────────────────── */

function renewalLabel(days: number): string {
  if (days < 0)  return `${Math.abs(days)} gün gecikti`
  if (days === 0) return 'Bugün'
  if (days === 1) return 'Yarın'
  return `${days} gün sonra`
}

/* ── Page ──────────────────────────────────────────────────────────── */

export default function SubscriptionsPage() {
  const recurring  = useRecurringStore(useShallow(s => s.recurring))
  const categories = useCategoryStore(useShallow(s => s.categories))
  // Subscribe to prices so monthly-equivalent recomputes once live FX rates load
  // (toBaseTry reads module-level rates published by the investment store).
  useInvestmentStore(s => s.prices)

  const [sort, setSort] = useState<SortKey>('cost')

  const { subs, monthlyTotal, annualTotal, count } = useMemo(
    () => summarize(recurring),
    [recurring],
  )

  const sorted = useMemo(() => {
    const arr = [...subs]
    if (sort === 'cost') {
      arr.sort((a, b) => monthlyEquivalentTry(b) - monthlyEquivalentTry(a))
    } else {
      arr.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
    }
    return arr
  }, [subs, sort])

  const upcoming = useMemo(() => {
    const todayStr = today()
    return subs
      .filter(r => {
        const d = daysUntil(r.nextDueDate)
        return r.nextDueDate >= todayStr && d <= RENEWAL_WINDOW_DAYS
      })
      .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
  }, [subs])

  const catOf = (id?: string) => categories.find(c => c.id === id)

  return (
    <>
      <Header title="Abonelikler" />

      <div className="p-6 flex flex-col gap-6">

        {count === 0 ? (
          <EmptyState
            icon="↻"
            title="Aktif abonelik yok"
            description="Netflix, kira, faturalar gibi düzenli giderlerinizi tekrarlayan işlem olarak ekleyin; burada aylık ve yıllık yükünüzü görün."
            action={
              <Link
                href="/recurring"
                className="inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Tekrarlayan işlem ekle
              </Link>
            }
          />
        ) : (
          <>
            {/* ── Stat row ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label="Aylık toplam" value={formatCurrency(monthlyTotal)} accent />
              <StatCard label="Yıllık toplam" value={formatCurrency(annualTotal)} />
              <StatCard label="Abonelik sayısı" value={String(count)} />
            </div>

            {/* ── Sort control ──────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold">
                Abonelikler — {count}
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
                {sorted.map(r => {
                  const cat     = catOf(r.categoryId)
                  const monthly = monthlyEquivalentTry(r)
                  const share   = monthlyTotal > 0 ? (monthly / monthlyTotal) * 100 : 0
                  const days    = daysUntil(r.nextDueDate)
                  return (
                    <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                      <CategoryIcon icon={cat?.icon ?? 'refresh'} color={cat?.color ?? '#8B5CF6'} size={18} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
                          <span className="text-[11px] font-medium text-muted-foreground px-1.5 py-0.5 rounded-md bg-accent">
                            {FREQ_LABEL[r.frequency]}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="tabular-nums">{formatCurrency(r.amount, r.currency)}</span>
                          <span>·</span>
                          <span>{formatDate(r.nextDueDate)}</span>
                          <span>·</span>
                          <span>{renewalLabel(days)}</span>
                        </div>
                        {/* Share bar */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 max-w-[180px] rounded-full bg-accent overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(share, 100)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                            %{share.toFixed(1)}
                          </span>
                        </div>
                      </div>

                      <div className="flex-shrink-0 text-right">
                        <div className="font-medium tabular-nums text-lg text-foreground">
                          {formatCurrency(monthly)}
                        </div>
                        <div className="text-[11px] font-medium text-muted-foreground">/ay</div>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* ── Upcoming renewals (30 days) ───────────────────────── */}
            <section>
              <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold mb-2">
                Yaklaşan yenilemeler (30 gün) — {upcoming.length}
              </div>
              {upcoming.length === 0 ? (
                <Card className="py-0">
                  <CardContent className="px-5 py-6 text-sm text-muted-foreground text-center">
                    Önümüzdeki 30 gün içinde yenilenecek abonelik yok.
                  </CardContent>
                </Card>
              ) : (
                <Card className="gap-0 py-0">
                  <CardContent className="p-0 divide-y divide-border">
                    {upcoming.map(r => {
                      const cat  = catOf(r.categoryId)
                      const days = daysUntil(r.nextDueDate)
                      return (
                        <div key={r.id} className="flex items-center gap-4 px-5 py-3">
                          <CategoryIcon icon={cat?.icon ?? 'refresh'} color={cat?.color ?? '#8B5CF6'} size={16} />
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
                            <div className="text-xs font-medium text-muted-foreground mt-0.5">
                              {formatDate(r.nextDueDate)}
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="text-sm font-semibold text-foreground tabular-nums">
                              {formatCurrency(r.amount, r.currency)}
                            </div>
                            <div className="text-[11px] font-medium text-orange-500">
                              {renewalLabel(days)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              )}
            </section>
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
