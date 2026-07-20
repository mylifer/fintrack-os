'use client'

/* ────────────────────────────────────────────────────────────────────────
   DetailedStats — "Detaylı İstatistikler"

   Read-only analytical layer derived entirely from the local Zustand/Dexie
   stores (transactions, categories, accounts). It touches no schema, no
   Supabase RPCs — it only reads what the Reports page already has in memory.

   All aggregation is memoised and strictly respects the Reports page's
   active period + account filter (passed in via `filteredTxs` / `dateRange`
   / `accountId`). The full `transactions` list is only used to establish the
   net-worth baseline entering the period.
──────────────────────────────────────────────────────────────────────── */

import { useMemo, useState } from 'react'
import { parseISO, differenceInDays } from 'date-fns'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { isReconciliation } from '@/lib/utils/reconciliation'
import { isInvestmentPrincipalTx } from '@/lib/utils/calculations'
import { baseAmount, toBaseTry } from '@/lib/utils/fx'
import { toMinor, toMajor, sumBy } from '@/lib/utils/money'
import type { Account, Category, Transaction } from '@/types'

/* Percentages: TR formatting with a decimal comma, e.g. 41.58 → "41,58%". */
const PCT_FMT = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${PCT_FMT.format(value)}%`
}

/* Resolve a full category path ("Ulaşım > Kiralama/Kredi") by walking
   parentId. Guards against a deleted parent (keeps the partial path) and
   against cycles (bounded depth + visited set), so it never crashes. */
function resolveCategoryPath(
  categoryId: string,
  catMap: Map<string, Category>,
): string {
  const start = catMap.get(categoryId)
  if (!start) return 'Kategorisiz' // category itself was deleted/archived away

  const names: string[] = [start.name]
  const seen = new Set<string>([start.id])
  let cur: Category | undefined = start
  let depth = 0
  while (cur?.parentId && depth < 5) {
    const parent = catMap.get(cur.parentId)
    if (!parent || seen.has(parent.id)) break // deleted parent or cycle → stop gracefully
    names.unshift(parent.name)
    seen.add(parent.id)
    cur = parent
    depth++
  }
  return names.join(' > ')
}

/* Net effect of a single transaction on the net worth of the selected
   account set. Transfers between two selected accounts net to zero. */
function netDelta(tx: Transaction, selectedIds: Set<string>): number {
  const amt = baseAmount(tx)
  if (tx.type === 'transfer') {
    let d = 0
    if (selectedIds.has(tx.accountId)) d -= amt
    if (tx.toAccountId && selectedIds.has(tx.toAccountId)) d += amt
    return d
  }
  if (selectedIds.has(tx.accountId)) {
    return tx.type === 'income' ? amt : -amt
  }
  return 0
}

type RankItem = { key: string; name: string; color: string; amount: number; pct: number }

/* ── Props ────────────────────────────────────────────────────────────── */

interface DetailedStatsProps {
  filteredTxs:  Transaction[]              // already period + account filtered
  transactions: Transaction[]              // full history (net-worth baseline)
  categories:   Category[]
  accounts:     Account[]                  // non-archived
  dateRange:    { from: string; to: string }
  accountId:    string                     // 'all' | account id
}

/* ── Component ────────────────────────────────────────────────────────── */

export function DetailedStats({
  filteredTxs,
  transactions,
  categories,
  accounts,
  dateRange,
  accountId,
}: DetailedStatsProps) {
  const [open, setOpen] = useState(true)

  const catMap = useMemo(
    () => new Map(categories.map(c => [c.id, c])),
    [categories],
  )

  /* Ghosting: balance-reconciliation entries are real ledger transactions that
     correct the raw account balance, but they must NEVER inflate income/expense
     analytics (counts, averages, top categories, merchants). Strip them here so
     every aggregate below is computed from genuine activity only. Net-worth math
     (further down) deliberately keeps them — it reflects the raw balance. */
  const analyticTxs = useMemo(
    () => filteredTxs.filter(t => !isReconciliation(t)),
    [filteredTxs],
  )

  /* Transaction counts by type within the period. Refunds are modelled as
     negative `expense` transactions (Negative-Expense architecture), so we
     split them out from gross expense counts and report them distinctly. */
  const counts = useMemo(() => {
    let expense = 0, income = 0, transfer = 0, refund = 0
    for (const t of analyticTxs) {
      if (t.type === 'expense') {
        if (t.amount < 0) refund++
        else expense++
      }
      else if (t.type === 'income') income++
      else if (t.type === 'transfer') transfer++
    }
    return {
      expense,
      income,
      transfer,
      balanceAdjustment: 0,
      refund,
      total: analyticTxs.length,
    }
  }, [analyticTxs])

  /* Period info + averages. */
  const period = useMemo(() => {
    const days = Math.max(
      1,
      differenceInDays(parseISO(dateRange.to), parseISO(dateRange.from)) + 1,
    )
    // Yatırım anapara satırları (… Alımı/… Satışı) gelir/gider ortalamalarına
    // girmez — dashboard/rapor KPI kartlarıyla aynı kapsam (yalnızca gerçek K/Z).
    const expenseTotal = sumBy(analyticTxs.filter(t => t.type === 'expense' && !isInvestmentPrincipalTx(t)), baseAmount)
    const incomeTotal  = sumBy(analyticTxs.filter(t => t.type === 'income'  && !isInvestmentPrincipalTx(t)), baseAmount)

    /* Real averages over the elapsed period — total divided by how many
       months/years the period actually spans (floored at 1 so a short
       period can never produce an "average" above its own total). */
    const avg = (total: number) => ({
      total,
      daily:   total / days,
      monthly: total / Math.max(1, days / 30.44),
      yearly:  total / Math.max(1, days / 365),
    })

    return { days, expense: avg(expenseTotal), income: avg(incomeTotal) }
  }, [analyticTxs, dateRange])

  /* Top 5 categories (expense + income), full paths, % of scope total. */
  const topCategories = useMemo(() => {
    const build = (scope: 'expense' | 'income', total: number): RankItem[] => {
      const groups = new Map<string, number>()   // accumulate in minor units (S8)
      for (const t of analyticTxs) {
        if (t.type !== scope) continue
        const key = t.categoryId ?? '__none__'
        groups.set(key, (groups.get(key) ?? 0) + toMinor(baseAmount(t)))
      }
      return [...groups.entries()]
        .map(([key, minor]) => {
          const amount = toMajor(minor)
          const cat = key === '__none__' ? undefined : catMap.get(key)
          return {
            key,
            name:  key === '__none__' ? 'Kategorisiz' : resolveCategoryPath(key, catMap),
            color: cat?.color ?? '#8C8C8C',
            amount,
            pct:   total > 0 ? (amount / total) * 100 : 0,
          }
        })
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    }
    return {
      expense: build('expense', period.expense.total),
      income:  build('income',  period.income.total),
    }
  }, [analyticTxs, catMap, period])

  /* Top 5 merchants (expense + income), % of scope total. */
  const topMerchants = useMemo(() => {
    const build = (scope: 'expense' | 'income', total: number): RankItem[] => {
      const groups = new Map<string, number>()   // accumulate in minor units (S8)
      for (const t of analyticTxs) {
        if (t.type !== scope) continue
        const name = t.merchant?.trim()
        if (!name) continue
        groups.set(name, (groups.get(name) ?? 0) + toMinor(baseAmount(t)))
      }
      return [...groups.entries()]
        .map(([name, minor]) => ({
          key: name,
          name,
          color: '#8C8C8C',
          amount: toMajor(minor),
          pct: total > 0 ? (toMajor(minor) / total) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    }
    return {
      expense: build('expense', period.expense.total),
      income:  build('income',  period.income.total),
    }
  }, [analyticTxs, period])

  /* Net worth: current (at period end), max & min with exact dates.
     Baseline = opening net worth entering the period; then we replay the
     period's day-by-day changes and track the running high/low. */
  const netWorth = useMemo(() => {
    const selectedIds = new Set(
      accountId === 'all' ? accounts.map(a => a.id) : [accountId],
    )
    const inScope = accounts.filter(a => selectedIds.has(a.id))

    // Opening net worth (TRY): initial balances converted to base currency,
    // plus every effect strictly before the period. Accumulated in minor units.
    let baselineMinor = inScope.reduce((s, a) => s + toMinor(toBaseTry(a.initialBalance, a.currency)), 0)
    const byDateMinor = new Map<string, number>()
    for (const t of transactions) {
      if (t.date < dateRange.from) {
        baselineMinor += toMinor(netDelta(t, selectedIds))
      } else if (t.date <= dateRange.to) {
        byDateMinor.set(t.date, (byDateMinor.get(t.date) ?? 0) + toMinor(netDelta(t, selectedIds)))
      }
    }

    let runningMinor = baselineMinor
    let max = { value: toMajor(runningMinor), date: dateRange.from }
    let min = { value: toMajor(runningMinor), date: dateRange.from }
    for (const date of [...byDateMinor.keys()].sort()) {
      runningMinor += byDateMinor.get(date)!
      const value = toMajor(runningMinor)
      if (value > max.value) max = { value, date }
      if (value < min.value) min = { value, date }
    }

    return { current: toMajor(runningMinor), max, min }
  }, [transactions, accounts, accountId, dateRange])

  const hasExpense = period.expense.total > 0
  const hasIncome  = period.income.total > 0

  return (
    <Card className="overflow-hidden gap-0 py-0">
      {/* Collapsible header */}
      <CardHeader className="px-5 py-4 border-b border-border/50">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center justify-between w-full text-left"
          aria-expanded={open}
        >
          <span className="text-sm font-semibold text-foreground/90">Detaylı İstatistikler</span>
          <span className={`text-muted-foreground text-xs transition-transform ${open ? 'rotate-180' : ''}`}>
            ▾
          </span>
        </button>
      </CardHeader>

      {open && (
        <CardContent className="p-0">
          {/* Counts + Period */}
          <TwoCol>
            <Panel title="Toplam İşlem Sayısı">
              <StatLine label="Giderler"             value={String(counts.expense)} />
              <StatLine label="Gelirler"             value={String(counts.income)} />
              <StatLine label="Bakiye Düzeltmeleri"  value={String(counts.balanceAdjustment)} />
              <StatLine label="Transferler"          value={String(counts.transfer)} />
              <StatLine label="İadeler"              value={String(counts.refund)} />
              <StatLine label="Toplam" value={String(counts.total)} strong />
            </Panel>
            <Panel title="Dönem">
              <StatLine label="Başlangıç Tarihi" value={formatDate(dateRange.from)} />
              <StatLine label="Bitiş Tarihi"     value={formatDate(dateRange.to)} />
              <StatLine label="Gün Sayısı"       value={`${period.days} gün`} strong />
            </Panel>
          </TwoCol>

          <Divider />

          {/* Averages */}
          <TwoCol>
            <Panel title="Giderler (Ortalamalar)">
              {hasExpense ? (
                <>
                  <StatLine label="Dönem Toplamı"    value={formatCurrency(period.expense.total)}   valueClass="text-destructive" strong />
                  <StatLine label="Günlük Ortalama"  value={formatCurrency(period.expense.daily)} />
                  <StatLine label="Aylık Ortalama"   value={formatCurrency(period.expense.monthly)} />
                  <StatLine label="Yıllık Ortalama"  value={formatCurrency(period.expense.yearly)} />
                </>
              ) : <Empty />}
            </Panel>
            <Panel title="Gelirler (Ortalamalar)">
              {hasIncome ? (
                <>
                  <StatLine label="Dönem Toplamı"    value={formatCurrency(period.income.total)}   valueClass="text-green-600" strong />
                  <StatLine label="Günlük Ortalama"  value={formatCurrency(period.income.daily)} />
                  <StatLine label="Aylık Ortalama"   value={formatCurrency(period.income.monthly)} />
                  <StatLine label="Yıllık Ortalama"  value={formatCurrency(period.income.yearly)} />
                </>
              ) : <Empty />}
            </Panel>
          </TwoCol>

          <Divider />

          {/* Net worth */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
            <NetWorthCell
              title="Varsayılan Net Değer"
              amount={netWorth.current}
              sub="Dönem sonu"
            />
            <NetWorthCell
              title="En Yüksek Net Değer"
              amount={netWorth.max.value}
              sub={formatDate(netWorth.max.date)}
            />
            <NetWorthCell
              title="En Düşük Net Değer"
              amount={netWorth.min.value}
              sub={formatDate(netWorth.min.date)}
            />
          </div>

          <Divider />

          {/* Top categories */}
          <TwoCol>
            <Panel title="En Büyük 5 Gider Kategorisi">
              <RankList items={topCategories.expense} amountClass="text-destructive" />
            </Panel>
            <Panel title="En Büyük 5 Gelir Kategorisi">
              <RankList items={topCategories.income} amountClass="text-green-600" />
            </Panel>
          </TwoCol>

          <Divider />

          {/* Top merchants */}
          <TwoCol>
            <Panel title="Giderlere Göre En Büyük 5 Müşteri">
              <RankList items={topMerchants.expense} amountClass="text-destructive" showDot={false} />
            </Panel>
            <Panel title="Gelirlere Göre En Büyük 5 Müşteri">
              <RankList items={topMerchants.income} amountClass="text-green-600" showDot={false} />
            </Panel>
          </TwoCol>
        </CardContent>
      )}
    </Card>
  )
}

/* ── Sub-components ───────────────────────────────────────────────────── */

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="border-t border-border/50" />
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function StatLine({
  label, value, valueClass, strong,
}: {
  label: string
  value: string
  valueClass?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[13px] text-foreground/70">{label}</span>
      <span
        className={[
          'text-[13px] tabular-nums text-right',
          strong ? 'font-semibold' : 'font-medium',
          valueClass ?? 'text-foreground/90',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function RankList({
  items, amountClass, showDot = true,
}: {
  items: RankItem[]
  amountClass: string
  showDot?: boolean
}) {
  if (items.length === 0) return <Empty />
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div
          key={item.key}
          className="flex items-center gap-2.5 py-1.5 border-b border-border/40 last:border-0"
        >
          <span className="w-3 text-[11px] tabular-nums text-muted-foreground text-right flex-shrink-0">
            {i + 1}
          </span>
          {showDot && (
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: item.color }} />
          )}
          <span className="text-[13px] text-foreground/80 flex-1 truncate min-w-0">{item.name}</span>
          <span className={`text-[13px] tabular-nums font-medium text-right ${amountClass}`}>
            {formatCurrency(item.amount)}
          </span>
          <span className="w-16 text-[12px] tabular-nums text-muted-foreground text-right flex-shrink-0">
            {formatPct(item.pct)}
          </span>
        </div>
      ))}
    </div>
  )
}

function NetWorthCell({
  title, amount, sub,
}: {
  title: string
  amount: number
  sub: string
}) {
  const cls = amount >= 0 ? 'text-foreground' : 'text-destructive'
  return (
    <div className="p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </div>
      <div className={`text-2xl font-normal tabular-nums ${cls}`}>
        {formatCurrency(amount)}
      </div>
      <div className="text-xs text-muted-foreground mt-1.5 font-medium tabular-nums">{sub}</div>
    </div>
  )
}

function Empty() {
  return (
    <div className="py-6 text-[13px] text-muted-foreground">Yok</div>
  )
}
