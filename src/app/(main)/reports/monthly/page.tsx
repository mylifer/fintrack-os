'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { PrintButton } from '@/components/layout/PrintSupport'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { useTransactionStore, useCategoryStore, useBudgetStore, useSettingsStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, formatMonthYear, prevMonth, nextMonth, currentMonthYear, today } from '@/lib/utils/date'
import { enrichBudget, resolveBudgetCategories } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { baseAmount } from '@/lib/utils/fx'
import { pctChange } from '@/lib/utils/period-compare'
import { buildMonthlySummary, type MonthFlow } from '@/lib/utils/monthly-summary'
import type { MonthYear } from '@/types'

/* Aylık Özet — bir ayın tek sayfalık dökümü: gelir/gider/net/tasarruf oranı,
   önceki ay ve geçen yılın aynı ayıyla kıyas, kategoriler, bütçe sonuçları ve en
   büyük giderler. Yazdır / PDF ile arşivlenebilir. Hesap kuralları Raporlar ile
   aynıdır (bkz. buildMonthlySummary). */

/** Ayın ilk haftasında varsayılan geçen ay: "ay sonu özeti" en çok o zaman açılır. */
function defaultMonth(): MonthYear {
  const my = currentMonthYear()
  return new Date().getDate() <= 7 ? prevMonth(my) : my
}

function sameMonth(a: MonthYear, b: MonthYear) {
  return a.month === b.month && a.year === b.year
}

function rangeLabel(f: MonthFlow) {
  const from = formatDate(f.from, 'd'), to = formatDate(f.to, 'd MMMM yyyy')
  return `${from}–${to}`
}

/** % değişim rozeti. `goodWhenUp`: gelir/net için artış iyi, gider için kötü. */
function Delta({ current, prev, goodWhenUp, label }: { current: number; prev: number; goodWhenUp: boolean; label: string }) {
  const pct = pctChange(current, prev)
  if (pct === null) return <div className="text-[11px] text-muted-foreground">{label}: <span className="font-medium">yeni</span></div>
  const rounded = Math.round(pct)
  if (rounded === 0) return <div className="text-[11px] text-muted-foreground">{label}: <span className="font-medium">aynı</span> ({formatCurrency(prev)})</div>
  const tone = (rounded > 0) === goodWhenUp ? 'text-green-600' : 'text-destructive'
  return (
    <div className="text-[11px] text-muted-foreground">
      {label}: <span className={`font-semibold ${tone}`}>{rounded > 0 ? '▲' : '▼'} %{Math.abs(rounded)}</span>
      <span className="ml-1">({formatCurrency(prev)})</span>
    </div>
  )
}

function KpiCard({ title, value, tone, children }: { title: string; value: string; tone?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5 break-inside-avoid">
      <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground">{title}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      {children}
    </div>
  )
}

/** Kategori simgesi; silinmiş/kategorisiz satırda renkli nokta. */
function CatMark({ icon, color }: { icon?: string; color?: string }) {
  if (icon) return <CategoryIcon icon={icon} color={color} size={14} />
  return <span className="inline-block w-6 h-6 flex-shrink-0 rounded-md" style={{ background: color ?? '#8C8C8C', opacity: 0.35 }} aria-hidden />
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 break-inside-avoid">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-xs font-medium tracking-wide uppercase text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default function MonthlySummaryPage() {
  const [my, setMy] = useState<MonthYear>(defaultMonth)
  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)
  const budgets      = useBudgetStore(useShallow(s => s.budgets))
  const includePnl   = useSettingsStore(s => s.includeFundGain)

  const summary = useMemo(
    () => buildMonthlySummary(transactions, my, categories, { includeRealizedPnl: includePnl, asOf: today() }),
    [transactions, my, categories, includePnl],
  )

  const monthBudgets = useMemo(() => {
    const ledger = collapseInstallments(transactions)
    return budgets
      .filter(b => b.period === 'monthly')
      .map(b => enrichBudget(b, ledger, my, categories))
      .sort((a, b) => b.percentUsed - a.percentUsed)
  }, [budgets, transactions, my, categories])

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const isFuture = my.year * 12 + my.month > currentMonthYear().year * 12 + currentMonthYear().month
  const { current: cur, previous: prev, lastYear: ly } = summary
  const exceeded = monthBudgets.filter(b => b.status === 'exceeded').length
  const topTotal = summary.categories.reduce((s, c) => s + c.amount, 0)

  return (
    <>
      <Header title="Aylık Özet" />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border/50">
        <button onClick={() => setMy(prevMonth(my))} aria-label="Önceki ay" className="print:hidden text-muted-foreground hover:text-foreground text-sm px-1">←</button>
        <span className="text-sm font-semibold text-foreground min-w-28 text-center capitalize">{formatMonthYear(my)}</span>
        <button onClick={() => setMy(nextMonth(my))} aria-label="Sonraki ay" disabled={sameMonth(my, currentMonthYear()) || isFuture}
          className="print:hidden text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground text-sm px-1">→</button>
        {summary.partial && (
          <span className="text-[11px] rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5">
            Ay sürüyor · {summary.daysCounted}/{summary.daysInMonth} gün — kıyaslar ayın ilk {summary.daysCounted} günüyle
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link href="/reports" className="print:hidden text-xs text-muted-foreground hover:text-foreground">Raporlar →</Link>
          <PrintButton />
        </div>
      </div>

      <div className="p-6 flex flex-col gap-5 max-w-5xl print:p-0">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard title="Gelir" value={formatCurrency(cur.income)} tone="text-green-600">
            <Delta current={cur.income} prev={prev.income} goodWhenUp label="Önceki ay" />
            <Delta current={cur.income} prev={ly.income} goodWhenUp label="Geçen yıl" />
          </KpiCard>
          <KpiCard title="Gider" value={formatCurrency(cur.expense)} tone="text-destructive">
            <Delta current={cur.expense} prev={prev.expense} goodWhenUp={false} label="Önceki ay" />
            <Delta current={cur.expense} prev={ly.expense} goodWhenUp={false} label="Geçen yıl" />
          </KpiCard>
          <KpiCard title="Net" value={formatCurrency(cur.net)} tone={cur.net < 0 ? 'text-destructive' : undefined}>
            <div className="text-[11px] text-muted-foreground">Önceki ay: <span className="font-medium">{formatCurrency(prev.net)}</span></div>
            <div className="text-[11px] text-muted-foreground">Geçen yıl: <span className="font-medium">{formatCurrency(ly.net)}</span></div>
          </KpiCard>
          <KpiCard
            title="Tasarruf oranı"
            value={cur.savingsRate === null ? '—' : `%${Math.round(cur.savingsRate)}`}
            tone={cur.savingsRate !== null && cur.savingsRate < 0 ? 'text-destructive' : undefined}
          >
            <div className="text-[11px] text-muted-foreground">
              Önceki ay: <span className="font-medium">{prev.savingsRate === null ? '—' : `%${Math.round(prev.savingsRate)}`}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Günlük ort. gider: <span className="font-medium">{formatCurrency(summary.dailyAvgExpense)}</span>
            </div>
          </KpiCard>
        </div>

        <div className="text-[11px] text-muted-foreground -mt-2">
          {rangeLabel(cur)} · {summary.txCount} işlem · kıyas: {rangeLabel(prev)} ve {rangeLabel(ly)}
        </div>

        {summary.increases.length > 0 && (
          <Section title="Dikkat çekenler">
            <ul className="flex flex-col gap-2 text-sm">
              {summary.increases.map(c => (
                <li key={c.categoryId ?? 'none'} className="flex items-center gap-2">
                  <span className="text-destructive">▲</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">
                    önceki aya göre {formatCurrency(c.amount - c.prevAmount)} fazla
                    {c.change !== null && <> (%{Math.round(c.change)})</>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Kategoriler" aside={<span className="text-[11px] text-muted-foreground">Gider · önceki ay · geçen yıl</span>}>
          {summary.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu ay gider yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr><th>Kategori</th><th>Bu ay</th><th>Önceki ay</th><th>Değişim</th><th>Geçen yıl</th></tr>
              </thead>
              <tbody>
                {summary.categories.map(c => {
                  const cat = c.categoryId ? catById.get(c.categoryId) : undefined
                  const share = topTotal > 0 ? (c.amount / topTotal) * 100 : 0
                  const change = c.change === null ? null : Math.round(c.change)
                  return (
                    <tr key={c.categoryId ?? 'none'} className="border-t border-border/50 first:border-t-0">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <CatMark icon={cat?.icon} color={c.color} />
                          <span className="truncate">{c.name}</span>
                          <span className="text-[11px] text-muted-foreground">%{Math.round(share)}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums whitespace-nowrap">{formatCurrency(c.amount)}</td>
                      <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell print:table-cell">{formatCurrency(c.prevAmount)}</td>
                      <td className={`py-2 pr-3 text-right text-xs tabular-nums whitespace-nowrap ${change === null || change === 0 ? 'text-muted-foreground' : change > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        {change === null ? 'yeni' : change === 0 ? '=' : `${change > 0 ? '▲' : '▼'} %${Math.abs(change)}`}
                      </td>
                      <td className="py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden md:table-cell print:table-cell">{formatCurrency(c.yearAmount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Section>

        {monthBudgets.length > 0 && (
          <Section
            title="Bütçeler"
            aside={
              <span className={`text-[11px] font-medium ${exceeded ? 'text-destructive' : 'text-green-600'}`}>
                {monthBudgets.length - exceeded}/{monthBudgets.length} limit içinde
              </span>
            }
          >
            <ul className="flex flex-col gap-3">
              {monthBudgets.map(b => (
                <li key={b.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{resolveBudgetCategories(b, categories).label}</span>
                    <span className="tabular-nums whitespace-nowrap text-xs text-muted-foreground">
                      <span className={b.status === 'exceeded' ? 'text-destructive font-semibold' : 'text-foreground font-medium'}>{formatCurrency(b.spent)}</span>
                      {' / '}{formatCurrency(b.limit)}
                    </span>
                  </div>
                  <ProgressBar percent={b.percentUsed} status={b.status} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {summary.largestExpenses.length > 0 && (
          <Section title="En büyük giderler">
            <ul className="flex flex-col">
              {summary.largestExpenses.map(t => {
                const cat = t.categoryId ? catById.get(t.categoryId) : undefined
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2 border-t border-border/50 first:border-t-0 text-sm">
                    <CatMark icon={cat?.icon} color={cat?.color} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{t.description || cat?.name || 'Gider'}</div>
                      <div className="text-[11px] text-muted-foreground">{formatDate(t.date.slice(0, 10), 'd MMMM')}{cat ? ` · ${cat.name}` : ''}</div>
                    </div>
                    <span className="font-semibold tabular-nums whitespace-nowrap">{formatCurrency(baseAmount(t))}</span>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
      </div>
    </>
  )
}
