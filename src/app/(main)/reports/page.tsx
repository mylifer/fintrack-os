'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { useShallow } from 'zustand/react/shallow'
import {
  format, parseISO, startOfMonth, endOfMonth,
  subMonths, subDays, startOfYear, endOfYear,
  differenceInDays, addMonths, addWeeks,
  startOfWeek, endOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header }           from '@/components/layout/Header'
import { useTransactionStore, useAccountStore, useCategoryStore } from '@/store'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { normalizeTag, tagKey, tagColor } from '@/lib/utils/tags'
import { CashFlowBarChart }   from '@/components/reports/CashFlowBarChart'
import { CategoryDonutChart }  from '@/components/reports/CategoryDonutChart'
import { BalanceTrendChart }   from '@/components/reports/BalanceTrendChart'
import { CategoryTrendChart }  from '@/components/reports/CategoryTrendChart'
import { DetailedStats }       from '@/components/reports/DetailedStats'
import { TransactionList }     from '@/components/transactions/TransactionList'
import type { CashFlowPoint }       from '@/components/reports/_CashFlowBarChart'
import type { CategorySlice }       from '@/components/reports/_CategoryDonutChart'
import type { TrendPoint }          from '@/components/reports/_BalanceTrendChart'
import type { CategoryTrendPoint }  from '@/components/reports/_CategoryTrendChart'
import type { Account, Transaction } from '@/types'

/* ── Types ────────────────────────────────────────────────────────── */

type Preset = 'this-month' | 'last-month' | '3-months' | 'this-year' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this-month', label: 'Bu Ay' },
  { key: 'last-month', label: 'Geçen Ay' },
  { key: '3-months',   label: 'Son 3 Ay' },
  { key: 'this-year',  label: 'Bu Yıl' },
  { key: 'custom',     label: 'Özel' },
]

/* ── Data helpers ─────────────────────────────────────────────────── */

function getPresetRange(preset: Preset, customFrom: string, customTo: string) {
  const now = new Date()
  switch (preset) {
    case 'this-month':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'last-month': {
      const lm = subMonths(now, 1)
      return { from: format(startOfMonth(lm), 'yyyy-MM-dd'), to: format(endOfMonth(lm), 'yyyy-MM-dd') }
    }
    case '3-months':
      return {
        from: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'),
        to:   format(endOfMonth(now), 'yyyy-MM-dd'),
      }
    case 'this-year':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'custom':
      return {
        from: customFrom || format(startOfMonth(now), 'yyyy-MM-dd'),
        to:   customTo   || format(endOfMonth(now),   'yyyy-MM-dd'),
      }
  }
}

function buildCashFlowData(
  transactions: Transaction[],
  dateRange: { from: string; to: string },
): CashFlowPoint[] {
  const from = parseISO(dateRange.from)
  const to   = parseISO(dateRange.to)
  const days = differenceInDays(to, from) + 1
  const pts: CashFlowPoint[] = []

  const income  = (pFrom: string, pTo: string) =>
    transactions.filter(t => t.type === 'income'  && t.date >= pFrom && t.date <= pTo).reduce((s, t) => s + t.amount, 0)
  const expense = (pFrom: string, pTo: string) =>
    transactions.filter(t => t.type === 'expense' && t.date >= pFrom && t.date <= pTo).reduce((s, t) => s + t.amount, 0)

  if (days <= 45) {
    let wStart = startOfWeek(from, { locale: tr })
    while (wStart <= to) {
      const wEnd  = endOfWeek(wStart, { locale: tr })
      const pFrom = format(wStart < from ? from : wStart, 'yyyy-MM-dd')
      const pTo   = format(wEnd   > to   ? to   : wEnd,   'yyyy-MM-dd')
      pts.push({ label: format(wStart < from ? from : wStart, 'd MMM', { locale: tr }), income: income(pFrom, pTo), expense: expense(pFrom, pTo) })
      wStart = addWeeks(wStart, 1)
    }
  } else {
    let mStart = startOfMonth(from)
    while (mStart <= to) {
      const mEnd  = endOfMonth(mStart)
      const pFrom = format(mStart < from ? from : mStart, 'yyyy-MM-dd')
      const pTo   = format(mEnd   > to   ? to   : mEnd,   'yyyy-MM-dd')
      pts.push({ label: format(mStart, 'MMM yy', { locale: tr }), income: income(pFrom, pTo), expense: expense(pFrom, pTo) })
      mStart = addMonths(mStart, 1)
    }
  }
  return pts
}

function buildCategoryData(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
): CategorySlice[] {
  const catMap = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.type !== 'expense') continue
    if (tx.icon) continue  // investment-linked expense — skip
    const key = tx.categoryId ?? '__none__'
    catMap.set(key, (catMap.get(key) ?? 0) + tx.amount)
  }
  const total = [...catMap.values()].reduce((s, v) => s + v, 0)
  if (total === 0) return []
  return [...catMap.entries()]
    .map(([key, amount]) => {
      const cat        = categories.find(c => c.id === key)
      const categoryId = key === '__none__' ? null : key
      return { categoryId, name: cat?.name ?? 'Kategorisiz', amount, percent: (amount / total) * 100, color: cat?.color ?? '#8C8C8C' }
    })
    .sort((a, b) => b.amount - a.amount)
}

/* ── Tag distribution (expenses) ──────────────────────────────────────
   Attributes each tagged expense's full amount to EVERY tag it carries
   (multi-tag transactions are counted once per tag). Untagged and
   investment-linked expenses are excluded. Colors use the same
   deterministic tagColor logic as the TagBadges so tags read consistently
   across the app. `percent` is relative to the summed tag volume.
 ─────────────────────────────────────────────────────────────────────── */

function buildTagExpenseData(transactions: Transaction[]): CategorySlice[] {
  const map = new Map<string, { amount: number; casings: Map<string, number> }>()

  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.icon) continue
    if (!tx.tags?.length) continue
    const seen = new Set<string>()
    for (const raw of tx.tags) {
      const norm = normalizeTag(raw)
      if (!norm) continue
      const key = tagKey(norm)
      if (seen.has(key)) continue
      seen.add(key)
      let entry = map.get(key)
      if (!entry) { entry = { amount: 0, casings: new Map() }; map.set(key, entry) }
      entry.amount += tx.amount
      entry.casings.set(norm, (entry.casings.get(norm) ?? 0) + 1)
    }
  }

  const total = [...map.values()].reduce((s, e) => s + e.amount, 0)
  if (total === 0) return []

  return [...map.entries()]
    .map(([key, entry]) => {
      // Canonical display casing = most frequent (ties → first-seen).
      let best = '', bestN = -1
      for (const [casing, n] of entry.casings) if (n > bestN) { bestN = n; best = casing }
      return {
        categoryId: key,  // tag key reused as the slice id
        name:       best,
        amount:     entry.amount,
        percent:    (entry.amount / total) * 100,
        color:      tagColor(key),
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

function buildTrendData(
  accounts: Account[],
  allTransactions: Transaction[],
  dateRange: { from: string; to: string },
  selectedAccountId: string,
): TrendPoint[] {
  const targets = selectedAccountId === 'all'
    ? accounts.filter(a => !a.isArchived)
    : accounts.filter(a => a.id === selectedAccountId)
  if (targets.length === 0) return []

  const from  = parseISO(dateRange.from)
  const to    = parseISO(dateRange.to)
  const pts: TrendPoint[] = []

  let mStart = startOfMonth(from)
  while (mStart <= to) {
    const snap = format(endOfMonth(mStart) > to ? to : endOfMonth(mStart), 'yyyy-MM-dd')

    const balance = targets.reduce((sum, account) => {
      let bal = account.balance
      for (const tx of allTransactions) {
        if (tx.date <= snap) continue
        if (tx.type === 'income'   && tx.accountId === account.id)   bal -= tx.amount
        if (tx.type === 'expense'  && tx.accountId === account.id)   bal += tx.amount
        if (tx.type === 'transfer' && tx.accountId === account.id)   bal += tx.amount
        if (tx.type === 'transfer' && tx.toAccountId === account.id) bal -= tx.amount
      }
      return sum + bal
    }, 0)

    pts.push({ label: format(mStart, 'MMM yy', { locale: tr }), balance })
    mStart = addMonths(mStart, 1)
  }
  return pts
}

/* ── amountTry helper ─────────────────────────────────────────────
   Uses amountTry if present (future field) for consistent TRY
   comparisons across multi-currency transactions; falls back to amount.
 ─────────────────────────────────────────────────────────────────── */

function getTryAmount(tx: Transaction): number {
  return (tx as any).amountTry ?? tx.amount
}

/* ── Period comparison ────────────────────────────────────────────── */

type ComparisonRow = {
  categoryId: string | null
  name: string
  color: string
  current: number
  prev: number
  pct: number
}

function buildPeriodComparison(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
  dateRange: { from: string; to: string },
  accountId: string,
): ComparisonRow[] {
  const from = parseISO(dateRange.from)
  const to   = parseISO(dateRange.to)
  const days = differenceInDays(to, from) + 1
  const prevTo   = format(subDays(from, 1),    'yyyy-MM-dd')
  const prevFrom = format(subDays(from, days), 'yyyy-MM-dd')

  const catMap = new Map<string, { current: number; prev: number }>()

  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.icon) continue
    if (accountId !== 'all' && tx.accountId !== accountId) continue
    const key = tx.categoryId ?? '__none__'
    if (!catMap.has(key)) catMap.set(key, { current: 0, prev: 0 })
    const entry = catMap.get(key)!
    const amt = getTryAmount(tx)
    if (tx.date >= dateRange.from && tx.date <= dateRange.to) {
      entry.current += amt
    } else if (tx.date >= prevFrom && tx.date <= prevTo) {
      entry.prev += amt
    }
  }

  return [...catMap.entries()]
    .map(([key, { current, prev }]) => {
      const cat = categories.find(c => c.id === key)
      const pct = prev > 0 ? ((current - prev) / prev) * 100 : current > 0 ? 100 : 0
      return {
        categoryId: key === '__none__' ? null : key,
        name:       cat?.name  ?? 'Kategorisiz',
        color:      cat?.color ?? '#8C8C8C',
        current,
        prev,
        pct,
      }
    })
    .filter(r => r.current > 0 || r.prev > 0)
    .sort((a, b) => b.current - a.current)
    .slice(0, 6)
}

/* ── Category 6-month trend ───────────────────────────────────────── */

function buildCategoryTrendData(
  transactions: Transaction[],
  categoryId: string | null,
): CategoryTrendPoint[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const mDate = subMonths(now, 5 - i)
    const mFrom = format(startOfMonth(mDate), 'yyyy-MM-dd')
    const mTo   = format(endOfMonth(mDate),   'yyyy-MM-dd')
    const amount = transactions
      .filter(tx => {
        if (tx.type !== 'expense' || tx.icon) return false
        if (tx.date < mFrom || tx.date > mTo) return false
        return categoryId === null ? !tx.categoryId : tx.categoryId === categoryId
      })
      .reduce((s, tx) => s + getTryAmount(tx), 0)
    return { label: format(mDate, 'MMM yy', { locale: tr }), amount }
  })
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function ReportsPage() {
  const transactions  = useTransactionStore(s => s.transactions)
  const txsReady      = useTransactionStore(s => s.ready)
  const accountsReady = useAccountStore(s => s.ready)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)

  const [preset,       setPreset]       = useState<Preset>('this-month')
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')
  const [accountId,    setAccountId]    = useState('all')
  const [selectedCat,   setSelectedCat]   = useState<CategorySlice | null>(null)
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null)
  const [tagSliceIdx,   setTagSliceIdx]   = useState<number | null>(null)
  const [trendCatKey,   setTrendCatKey]   = useState<string>('')  // '' = auto (first in comparison list)

  const dateRange = useMemo(
    () => getPresetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  const filteredTxs = useMemo(() =>
    transactions.filter(tx => {
      if (tx.date < dateRange.from || tx.date > dateRange.to) return false
      if (accountId !== 'all') {
        if (tx.accountId !== accountId && tx.toAccountId !== accountId) return false
      }
      return true
    }),
    [transactions, dateRange, accountId],
  )

  const kpi = useMemo(() => {
    const income  = filteredTxs.filter(t => t.type === 'income').reduce( (s, t) => s + t.amount, 0)
    const expense = filteredTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const net     = income - expense
    const rate    = income > 0 ? (net / income) * 100 : 0
    return { income, expense, net, rate }
  }, [filteredTxs])

  const cashFlowData    = useMemo(() => buildCashFlowData(filteredTxs, dateRange),                    [filteredTxs, dateRange])
  const categoryData    = useMemo(() => buildCategoryData(filteredTxs, categories),                   [filteredTxs, categories])
  const tagData         = useMemo(() => buildTagExpenseData(filteredTxs),                             [filteredTxs])
  const topTags         = useMemo(() => tagData.slice(0, 8),                                          [tagData])
  const trendData       = useMemo(() => buildTrendData(accounts, transactions, dateRange, accountId),  [accounts, transactions, dateRange, accountId])
  const comparisonData  = useMemo(() => buildPeriodComparison(transactions, categories, dateRange, accountId), [transactions, categories, dateRange, accountId])

  const activeTrendCat  = useMemo(() => {
    if (!trendCatKey) return comparisonData[0] ?? null
    return comparisonData.find(r => (r.categoryId ?? '__none__') === trendCatKey) ?? comparisonData[0] ?? null
  }, [trendCatKey, comparisonData])

  const catTrendData    = useMemo(
    () => activeTrendCat ? buildCategoryTrendData(transactions, activeTrendCat.categoryId) : [],
    [transactions, activeTrendCat],
  )

  const prevPeriodLabel = useMemo(() => {
    const from  = parseISO(dateRange.from)
    const days  = differenceInDays(parseISO(dateRange.to), from) + 1
    const pFrom = subDays(from, days)
    const pTo   = subDays(from, 1)
    return `${format(pFrom, 'd MMM', { locale: tr })} – ${format(pTo, 'd MMM yy', { locale: tr })}`
  }, [dateRange])

  const catFilteredTxs = useMemo(() => {
    if (!selectedCat) return []
    return filteredTxs.filter(tx => {
      if (tx.type !== 'expense') return false
      return selectedCat.categoryId === null ? !tx.categoryId : tx.categoryId === selectedCat.categoryId
    })
  }, [filteredTxs, selectedCat])

  useEffect(() => {
    setSelectedCat(null)
    setActiveSliceIdx(null)
    setTagSliceIdx(null)
    setTrendCatKey('')
  }, [preset, customFrom, customTo, accountId])

  const isLoading = !txsReady || !accountsReady

  const animIncome  = useCountUp(kpi.income)
  const animExpense = useCountUp(kpi.expense)
  const animNet     = useCountUp(Math.abs(kpi.net))
  const animTrend   = useCountUp(trendData.at(-1)?.balance ?? 0)

  return (
    <>
      <Header title="Raporlar" />

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border/50 bg-card flex flex-wrap items-center gap-3 flex-shrink-0">

        <div className="flex gap-0.5 bg-background p-1 rounded-xl">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap',
                preset === p.key ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground rounded-xl',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
            />
          </div>
        )}

        <select
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          className="ml-auto border border-border rounded-xl px-3 py-2 text-xs text-foreground bg-card focus:outline-none focus:border-primary cursor-pointer"
        >
          <option value="all">Tüm Hesaplar</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="p-6 flex flex-col gap-6 overflow-auto flex-1">

        {/* ── KPI Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="px-5 py-4">
                  <div className="h-2.5 w-20 bg-muted rounded animate-pulse mb-3" />
                  <div className="h-7 w-32 bg-muted rounded animate-pulse" />
                  <div className="h-2 w-16 bg-muted rounded animate-pulse mt-2" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <KPICard
                label="Toplam Gelir"
                value={formatCurrency(animIncome)}
                sub={`${filteredTxs.filter(t => t.type === 'income').length} işlem`}
                color="ok"
              />
              <KPICard
                label="Toplam Gider"
                value={formatCurrency(animExpense)}
                sub={`${filteredTxs.filter(t => t.type === 'expense').length} işlem`}
                color="danger"
              />
              <KPICard
                label="Net Tasarruf"
                value={formatCurrency(animNet)}
                sub={kpi.net >= 0 ? 'Pozitif birikim' : 'Açık var'}
                prefix={kpi.net >= 0 ? '+' : '−'}
                color={kpi.net >= 0 ? 'ok' : 'danger'}
              />
              <KPICard
                label="Tasarruf Oranı"
                value={`${Math.abs(kpi.rate).toFixed(1)}%`}
                sub={kpi.rate >= 20 ? 'Hedefin üstünde' : kpi.rate > 0 ? 'Geliştirilebilir' : 'Gelir eksik'}
                prefix={kpi.rate < 0 ? '−' : ''}
                color={kpi.rate >= 20 ? 'ok' : kpi.rate >= 0 ? 'neutral' : 'danger'}
              />
            </>
          )}
        </div>

        {/* ── Charts row 1: Cash Flow + Category ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Nakit Akışı</span>
              {!isLoading && (
                <span className={`text-xs font-medium tabular-nums ${kpi.net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  Net: {kpi.net >= 0 ? '+' : '−'}{formatCurrency(animNet)}
                </span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <BarSkeleton /> : <CashFlowBarChart data={cashFlowData} />}
                </div>
              </div>
              <div className="px-5 pb-4 flex gap-4">
                <LegendDot color="#00E676" label="Gelir" />
                <LegendDot color="#FF1744" label="Gider" />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Kategori Bazlı Giderler</span>
              {selectedCat && (
                <button
                  onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: selectedCat.color }} />
                  {selectedCat.name}
                  <span className="ml-1 opacity-50">✕</span>
                </button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <DonutSkeleton /> : (
                    <CategoryDonutChart
                      data={categoryData}
                      activeIndex={activeSliceIdx}
                      onSliceClick={(slice, idx) => {
                        if (activeSliceIdx === idx) {
                          setSelectedCat(null)
                          setActiveSliceIdx(null)
                        } else {
                          setSelectedCat(slice)
                          setActiveSliceIdx(idx)
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* ── Category drill-down ───────────────────────────────────── */}
        {selectedCat && !isLoading && (
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border/50">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedCat.color }} />
              <span className="text-sm font-semibold text-foreground/90 flex-1">
                {selectedCat.name} — {catFilteredTxs.length} işlem
              </span>
              <span className="text-sm font-medium tabular-nums text-destructive">
                −{formatCurrency(selectedCat.amount)}
              </span>
              <button
                onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm flex-shrink-0"
                title="Kapat"
              >✕</button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto" style={{ maxHeight: 440 }}>
                <TransactionList
                  transactions={catFilteredTxs}
                  showAccount
                  emptyTitle="İşlem bulunamadı"
                  emptyDescription="Seçili dönemde bu kategoride gider yok."
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Tag Analytics: distribution + top tags ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Etiket Dağılımı */}
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Etiket Dağılımı</span>
              {!isLoading && tagData.length > 0 && (
                <span className="text-xs text-muted-foreground">{tagData.length} etiket</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <DonutSkeleton /> : tagData.length === 0 ? (
                    <TagEmptyState />
                  ) : (
                    <CategoryDonutChart
                      data={tagData}
                      activeIndex={tagSliceIdx}
                      onSliceClick={(_slice, idx) => setTagSliceIdx(prev => prev === idx ? null : idx)}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* En Aktif Etiketler */}
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">En Aktif Etiketler</span>
              {!isLoading && topTags.length > 0 && (
                <span className="text-xs text-muted-foreground">Gider hacmi</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <AdvancedSkeleton />
              ) : topTags.length === 0 ? (
                <TagEmptyState />
              ) : (
                <div className="p-5 flex flex-col gap-0.5">
                  {topTags.map((t, i) => {
                    const width = topTags[0].amount > 0 ? (t.amount / topTags[0].amount) * 100 : 0
                    return (
                      <Link
                        key={t.categoryId}
                        href={`/tags/${encodeURIComponent(t.name)}`}
                        className="group flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors"
                      >
                        <span className="text-[11px] tabular-nums text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: t.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] text-foreground/80 truncate group-hover:text-primary transition-colors">
                              #{t.name}
                            </span>
                            <span className="text-[13px] tabular-nums font-medium text-foreground/70 flex-shrink-0">
                              {formatCompact(t.amount)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: t.color }} />
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* ── Balance / Net Worth Trend ──────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">
              {accountId === 'all' ? 'Net Varlık Trendi' : 'Hesap Bakiye Trendi'}
            </span>
            {!isLoading && trendData.length > 0 && (
              <span className={`text-xs font-medium tabular-nums ${(trendData.at(-1)?.balance ?? 0) >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                Güncel: {formatCurrency(animTrend)}
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                {isLoading ? <BarSkeleton /> : <BalanceTrendChart data={trendData} />}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Advanced Analytics ────────────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">Gelişmiş Analiz</span>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                Önceki dönem: {prevPeriodLabel}
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                <AdvancedSkeleton />
                <AdvancedSkeleton />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">

                {/* Period comparison table */}
                <div className="p-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Dönem Karşılaştırması
                  </div>
                  {comparisonData.length === 0 ? (
                    <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
                      Gider verisi bulunamadı
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {comparisonData.map((row, idx) => {
                        const key = row.categoryId ?? '__none__'
                        const isActive = trendCatKey ? trendCatKey === key : idx === 0
                        return (
                          <button
                            key={key}
                            onClick={() => setTrendCatKey(isActive && !!trendCatKey ? '' : key)}
                            className={[
                              'flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors w-full',
                              isActive ? 'bg-muted' : 'hover:bg-accent',
                            ].join(' ')}
                          >
                            <span
                              className="w-2 h-2 rounded-sm flex-shrink-0"
                              style={{ background: row.color }}
                            />
                            <span className="text-[13px] text-foreground/80 flex-1 truncate min-w-0">
                              {row.name}
                            </span>
                            <span className="text-[13px] tabular-nums text-foreground/70 font-medium">
                              {formatCompact(row.current)}
                            </span>
                            <PctBadge pct={row.pct} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 6-month category trend */}
                <div className="p-5">
                  {activeTrendCat ? (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: activeTrendCat.color }}
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Son 6 Ay — {activeTrendCat.name}
                        </span>
                      </div>
                      <CategoryTrendChart data={catTrendData} color={activeTrendCat.color} />
                    </>
                  ) : (
                    <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
                      Kategori seçin
                    </div>
                  )}
                </div>

              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Detailed statistics ───────────────────────────────────── */}
        {!isLoading && (
          <DetailedStats
            filteredTxs={filteredTxs}
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            dateRange={dateRange}
            accountId={accountId}
          />
        )}

      </div>
    </>
  )
}

/* ── Sub-components ───────────────────────────────────────────────── */

function KPICard({
  label, value, sub, prefix = '', color = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  prefix?: string
  color?: 'ok' | 'danger' | 'neutral'
}) {
  const cls = color === 'ok' ? 'text-green-600' : color === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`text-3xl font-normal tabular-nums ${cls}`}>
          {prefix}{value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function TagEmptyState() {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground/60 text-xl font-bold select-none">
        #
      </div>
      <p className="text-sm text-muted-foreground">Bu dönemde etiketli işlem bulunmuyor</p>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 inline-block" style={{ background: color }} />
      <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
    </div>
  )
}

function BarSkeleton() {
  return (
    <div className="flex items-end gap-2 px-4 pb-2 pt-4" style={{ height: 252 }}>
      {[65, 40, 80, 55, 70, 45, 75, 50].map((h, i) => (
        <div key={i} className="flex-1 flex gap-0.5 items-end">
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h}%` }} />
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h * 0.65}%` }} />
        </div>
      ))}
    </div>
  )
}

function DonutSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-6" style={{ minHeight: 340 }}>
      <div className="w-44 h-44 rounded-full border-[20px] border-border animate-pulse" />
      <div className="grid grid-cols-2 gap-2 px-6 w-full">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 bg-muted rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function AdvancedSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-2">
      <div className="h-2.5 w-28 bg-muted rounded animate-pulse mb-2" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-9 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

function PctBadge({ pct }: { pct: number }) {
  if (!isFinite(pct) || Math.abs(pct) < 0.5) {
    return <span className="text-[11px] text-muted-foreground tabular-nums w-12 text-right">—</span>
  }
  const up = pct > 0
  return (
    <span className={['text-[11px] font-semibold tabular-nums w-12 text-right', up ? 'text-destructive' : 'text-green-600'].join(' ')}>
      {up ? '+' : ''}{pct.toFixed(0)}%
    </span>
  )
}
