'use client'

import { useMemo, useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  format, parseISO, startOfMonth, endOfMonth,
  subMonths, startOfYear, endOfYear,
  differenceInDays, addMonths, addWeeks,
  startOfWeek, endOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header }           from '@/components/layout/Header'
import { useTransactionStore, useAccountStore, useCategoryStore } from '@/store'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { formatCurrency }   from '@/lib/utils/currency'
import { CashFlowBarChart }   from '@/components/reports/CashFlowBarChart'
import { CategoryDonutChart }  from '@/components/reports/CategoryDonutChart'
import { BalanceTrendChart }   from '@/components/reports/BalanceTrendChart'
import { TransactionList }     from '@/components/transactions/TransactionList'
import type { CashFlowPoint } from '@/components/reports/_CashFlowBarChart'
import type { CategorySlice } from '@/components/reports/_CategoryDonutChart'
import type { TrendPoint }    from '@/components/reports/_BalanceTrendChart'
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
  const [selectedCat,  setSelectedCat]  = useState<CategorySlice | null>(null)
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null)

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

  const cashFlowData = useMemo(() => buildCashFlowData(filteredTxs, dateRange),                    [filteredTxs, dateRange])
  const categoryData = useMemo(() => buildCategoryData(filteredTxs, categories),                   [filteredTxs, categories])
  const trendData    = useMemo(() => buildTrendData(accounts, transactions, dateRange, accountId),  [accounts, transactions, dateRange, accountId])

  const catFilteredTxs = useMemo(() => {
    if (!selectedCat) return []
    return filteredTxs.filter(tx => {
      if (tx.type !== 'expense') return false
      return selectedCat.categoryId === null ? !tx.categoryId : tx.categoryId === selectedCat.categoryId
    })
  }, [filteredTxs, selectedCat])

  // Clear selection when filters change
  useEffect(() => {
    setSelectedCat(null)
    setActiveSliceIdx(null)
  }, [preset, customFrom, customTo, accountId])

  const isLoading = !txsReady || !accountsReady

  return (
    <>
      <Header title="Raporlar" />

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 py-3 border-b border-border bg-surface flex flex-wrap items-center gap-3 flex-shrink-0">

        <div className="flex gap-0.5 bg-ground p-1 rounded-xl">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={[
                'px-3 py-1.5 rounded-[10px] text-[11px] font-semibold transition-colors whitespace-nowrap',
                preset === p.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
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
              className="border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface focus:outline-none focus:border-primary"
            />
            <span className="text-muted text-xs">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs text-ink bg-surface focus:outline-none focus:border-primary"
            />
          </div>
        )}

        <select
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          className="ml-auto border border-border rounded-xl px-3 py-2 text-xs text-ink bg-surface focus:outline-none focus:border-primary cursor-pointer"
        >
          <option value="all">Tüm Hesaplar</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      <div className="p-4 lg:p-6 flex flex-col gap-4 overflow-auto flex-1">

        {/* ── KPI Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="px-5 py-4">
                  <div className="h-2.5 w-20 bg-line rounded animate-pulse mb-3" />
                  <div className="h-7 w-32 bg-line rounded animate-pulse" />
                  <div className="h-2 w-16 bg-line rounded animate-pulse mt-2" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <KPICard
                label="Toplam Gelir"
                value={formatCurrency(kpi.income)}
                sub={`${filteredTxs.filter(t => t.type === 'income').length} işlem`}
                color="ok"
              />
              <KPICard
                label="Toplam Gider"
                value={formatCurrency(kpi.expense)}
                sub={`${filteredTxs.filter(t => t.type === 'expense').length} işlem`}
                color="danger"
              />
              <KPICard
                label="Net Tasarruf"
                value={formatCurrency(Math.abs(kpi.net))}
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">Nakit Akışı</span>
              {!isLoading && (
                <span className={`text-[10px] font-mono tabular ${kpi.net >= 0 ? 'text-ok' : 'text-danger'}`}>
                  Net: {kpi.net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(kpi.net))}
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
                <LegendDot color="#16A34A" label="Gelir" />
                <LegendDot color="#DC2626" label="Gider" />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">Kategori Bazlı Giderler</span>
              {selectedCat && (
                <button
                  onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
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
            <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedCat.color }} />
              <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground flex-1">
                {selectedCat.name} — {catFilteredTxs.length} işlem
              </span>
              <span className="text-xs font-semibold tabular text-destructive">
                −{formatCurrency(selectedCat.amount)}
              </span>
              <button
                onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.08] rounded-lg transition-colors text-sm flex-shrink-0"
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

        {/* ── Balance / Net Worth Trend ──────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">
              {accountId === 'all' ? 'Net Varlık Trendi' : 'Hesap Bakiye Trendi'}
            </span>
            {!isLoading && trendData.length > 0 && (
              <span className={`text-[10px] font-mono tabular ${(trendData.at(-1)?.balance ?? 0) >= 0 ? 'text-ok' : 'text-danger'}`}>
                Güncel: {formatCurrency(trendData.at(-1)?.balance ?? 0)}
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
  const cls = color === 'ok' ? 'text-ok' : color === 'danger' ? 'text-danger' : 'text-foreground'
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-[9px] font-semibold tracking-wider uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`text-xl font-black tabular tracking-tight leading-tight ${cls}`}>
          {prefix}{value}
        </div>
        {sub && <div className="text-[9px] text-muted-foreground mt-1.5 font-medium">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 inline-block" style={{ background: color }} />
      <span className="text-[10px] font-mono text-muted uppercase tracking-wide">{label}</span>
    </div>
  )
}

function BarSkeleton() {
  return (
    <div className="flex items-end gap-2 px-4 pb-2 pt-4" style={{ height: 252 }}>
      {[65, 40, 80, 55, 70, 45, 75, 50].map((h, i) => (
        <div key={i} className="flex-1 flex gap-0.5 items-end">
          <div className="flex-1 bg-line animate-pulse rounded-t" style={{ height: `${h}%` }} />
          <div className="flex-1 bg-line animate-pulse rounded-t" style={{ height: `${h * 0.65}%` }} />
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
          <div key={i} className="h-4 bg-line rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

