'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useBudgetStore, useTransactionStore, useCategoryStore } from '@/store'
import { ProgressBar }     from '@/components/ui/ProgressBar'
import { TransactionList } from '@/components/transactions/TransactionList'
import { formatCurrency }  from '@/lib/utils/currency'
import {
  formatMonthYear, prevMonth, nextMonth, currentMonthYear, lastNMonths, monthRange,
} from '@/lib/utils/date'
import {
  getBudgetCategoryIds, enrichBudget, calcBudgetSpent,
} from '@/lib/utils/calculations'
import type { MonthYear } from '@/types'

const TR_MONTHS_SHORT = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
function shortLabel(my: MonthYear) {
  return `${TR_MONTHS_SHORT[my.month - 1]} '${String(my.year).slice(2)}`
}

const ChevronLeft = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={15} height={15}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
  </svg>
)

export default function BudgetDetailClient({ id }: { id: string }) {
  const router       = useRouter()
  const budget       = useBudgetStore(s => s.budgets.find(b => b.id === id))
  const loading      = useBudgetStore(s => s.loading)
  const transactions = useTransactionStore(s => s.transactions)
  const categories   = useCategoryStore(s => s.categories)

  // ── UI state ─────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('')
  const [selectedMonth, setSelectedMonth] = useState<MonthYear>(currentMonthYear())
  const [allTime,       setAllTime]       = useState(false)
  const [catFilter,     setCatFilter]     = useState<string | null>(null)

  // ── Derived (all before conditional returns — Rules of Hooks) ─────────────
  const budgetCatIds = useMemo(
    () => budget ? getBudgetCategoryIds(budget) : [],
    [budget],
  )

  const activeCatIds = catFilter ? [catFilter] : budgetCatIds

  const { from, to } = monthRange(selectedMonth)

  const enriched = useMemo(
    () => budget ? enrichBudget(budget, transactions, selectedMonth) : null,
    [budget, transactions, selectedMonth],
  )

  const history = useMemo(() => {
    if (!budget) return []
    return lastNMonths(6).map(my => {
      const spent = calcBudgetSpent(budget, transactions, my)
      const pct   = budget.amount > 0 ? Math.min(100, (spent / budget.amount) * 100) : 0
      const status =
        pct >= 100                    ? 'exceeded' as const
        : pct >= budget.alertThreshold ? 'warning'  as const
        : 'ok'                                       as const
      const isSelected =
        !allTime &&
        my.month === selectedMonth.month &&
        my.year  === selectedMonth.year
      return { my, label: shortLabel(my), spent, pct, status, isSelected }
    })
  }, [budget, transactions, selectedMonth, allTime])

  const filtered = useMemo(() => {
    if (!budget) return []
    return transactions.filter(tx => {
      if (tx.type !== 'expense') return false
      if (!tx.categoryId || !activeCatIds.includes(tx.categoryId)) return false
      if (!allTime && (tx.date < from || tx.date > to)) return false
      if (search && !tx.description.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [budget, transactions, activeCatIds, allTime, from, to, search])

  // ── Conditional returns (after all hooks) ─────────────────────────────────
  if (loading && !budget) return null

  if (!budget) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
          <button
            onClick={() => router.push('/budgets')}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm"
          >
            <ChevronLeft /> Bütçeler
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Bütçe bulunamadı.
        </div>
      </div>
    )
  }

  const cats      = budgetCatIds.map(cid => categories.find(c => c.id === cid)).filter(Boolean)
  const title     = cats.map(c => c!.name).join(', ')
  const totalSpent = filtered.reduce((s, t) => s + t.amount, 0)

  function navigatePrev() { setAllTime(false); setSelectedMonth(m => prevMonth(m)) }
  function navigateNext() { setAllTime(false); setSelectedMonth(m => nextMonth(m)) }

  return (
    <div className="flex flex-col h-full">

      {/* ── Custom header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0">
        <button
          onClick={() => router.push('/budgets')}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm flex-shrink-0"
        >
          <ChevronLeft /> Bütçeler
        </button>
        <span className="text-muted-foreground/40 select-none">/</span>
        <span className="text-sm font-semibold text-foreground truncate">{title}</span>
      </div>

      {/* ── Budget summary ─────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border bg-card flex-shrink-0">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          {allTime ? 'Tüm Zamanlar' : formatMonthYear(selectedMonth)}
        </div>

        <div className="flex items-baseline gap-1.5 mb-3">
          <span className={`text-3xl font-normal tabular-nums ${
            !allTime && enriched?.status === 'exceeded' ? 'text-destructive'
            : !allTime && enriched?.status === 'warning' ? 'text-orange-500'
            : 'text-foreground'
          }`}>
            {formatCurrency(allTime ? totalSpent : (enriched?.spent ?? 0))}
          </span>
          <span className="text-sm text-muted-foreground">
            / {formatCurrency(budget.amount)}
          </span>
        </div>

        {!allTime && enriched && (
          <>
            <ProgressBar percent={enriched.percentUsed} status={enriched.status} showLabel />
            <div className="mt-2 text-xs text-muted-foreground">
              {enriched.status === 'exceeded'
                ? `${formatCurrency(enriched.spent - budget.amount)} aşım`
                : `${formatCurrency(enriched.remaining)} kaldı`}
            </div>
          </>
        )}

        {/* Clickable mini bar chart — last 6 months */}
        <div className="mt-4 flex items-end gap-1.5 h-14">
          {history.map(row => (
            <button
              key={`${row.my.year}-${row.my.month}`}
              onClick={() => { setSelectedMonth(row.my); setAllTime(false) }}
              title={`${row.label}: ${formatCurrency(row.spent)}`}
              className="flex-1 flex flex-col items-center gap-1 group"
            >
              <div className="w-full bg-muted rounded-sm overflow-hidden flex-1 relative">
                <div
                  className={`absolute bottom-0 left-0 right-0 rounded-sm transition-all duration-300 ${
                    row.status === 'exceeded' ? 'bg-destructive'
                    : row.status === 'warning' ? 'bg-orange-500'
                    : row.isSelected ? 'bg-primary' : 'bg-primary/40 group-hover:bg-primary/65'
                  }`}
                  style={{ height: `${Math.max(row.pct, row.spent > 0 ? 4 : 0)}%` }}
                />
              </div>
              <span className={`text-[9px] leading-none ${
                row.isSelected ? 'text-foreground font-semibold' : 'text-muted-foreground'
              }`}>
                {row.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Category chips (multi-category budgets) ────────────────────────── */}
      {cats.length > 1 && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border bg-background flex-shrink-0 flex-wrap">
          <button
            onClick={() => setCatFilter(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !catFilter
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Hepsi
          </button>
          {cats.map(cat => (
            <button
              key={cat!.id}
              onClick={() => setCatFilter(catFilter === cat!.id ? null : cat!.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                catFilter === cat!.id
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat!.icon} {cat!.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Search + month nav ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-background flex-shrink-0">
        <input
          type="text"
          placeholder="İşlem ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-0 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
        />

        {/* Month nav */}
        <div className="flex items-center border border-border rounded-xl overflow-hidden flex-shrink-0">
          <button
            onClick={navigatePrev}
            className="px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-sm"
          >
            ←
          </button>
          <button
            onClick={() => setAllTime(a => !a)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-x border-border ${
              allTime
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent'
            }`}
          >
            {allTime ? 'Tüm Zamanlar' : formatMonthYear(selectedMonth)}
          </button>
          <button
            onClick={navigateNext}
            className="px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-sm"
          >
            →
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-2.5 bg-card border-b border-border flex-shrink-0">
          <span className="text-xl font-normal tabular-nums text-destructive">
            −{formatCurrency(totalSpent)}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} işlem
          </span>
        </div>
      )}

      {/* ── Transaction list ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={filtered}
          layout="table"
          emptyTitle="İşlem bulunamadı"
          emptyDescription={
            search
              ? `"${search}" ile eşleşen işlem yok.`
              : 'Bu bütçeye ait gider kaydı bulunmuyor.'
          }
        />
      </div>
    </div>
  )
}
