'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import {
  useTransactionStore, useAccountStore, useUIStore,
  useInvestmentStore, useBudgetStore, useCategoryStore,
  useDebtStore, useRecurringStore,
} from '@/store'
import { calcNetWorth, calcPeriodFlow, computeTransactionEffect } from '@/lib/utils/calculations'
import { computeHoldings } from '@/store/investment.store'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { getPeriodRange, getPrevPeriodRange, formatDateShort, formatDate, daysUntil, isOverdue, today } from '@/lib/utils/date'
import dynamic from 'next/dynamic'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Header } from '@/components/layout/Header'
import { PeriodTabs } from '@/components/ui/PeriodTabs'
import type { PeriodType } from '@/types'

const CashflowChart = dynamic(
  () => import('@/components/dashboard/CashflowChart').then(m => ({ default: m.CashflowChart })),
  { ssr: false, loading: () => <Card className="h-[360px] animate-pulse bg-muted/30" /> },
)
const NetWorthChart = dynamic(
  () => import('@/components/dashboard/NetWorthChart').then(m => ({ default: m.NetWorthChart })),
  { ssr: false, loading: () => <Card className="h-[360px] animate-pulse bg-muted/30" /> },
)

const PERIOD_LABEL: Record<PeriodType, string> = {
  daily: 'Bugün', weekly: 'Bu Hafta', monthly: 'Bu Ay',
  yearly: 'Bu Yıl', all: 'Tüm Zamanlar',
}

const ACCOUNT_TYPE: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi Kartı', investment: 'Yatırım', loan: 'Kredi',
}

export default function DashboardPage() {
  const openModal      = useUIStore(s => s.openModal)
  const periodType     = useUIStore(s => s.periodType)
  const selectedPeriod = useUIStore(s => s.selectedPeriod)

  const transactions = useTransactionStore(s => s.transactions)
  const allAccounts  = useAccountStore(s => s.accounts)
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories   = useCategoryStore(s => s.categories)
  const investValue  = useInvestmentStore(s => s.getPortfolioValue())
  const prices       = useInvestmentStore(s => s.prices)
  const investTxs    = useInvestmentStore(s => s.transactions)
  const getBudgets   = useBudgetStore(s => s.getMonthBudgets)
  const getDueSoon   = useDebtStore(s => s.getDueSoon)
  const getActive    = useDebtStore(s => s.getActive)
  const getDue       = useRecurringStore(s => s.getDue)
  const markGenerated  = useRecurringStore(s => s.markGenerated)
  const addTransaction = useTransactionStore(s => s.add)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])
  const { income, expense, net } = useMemo(
    () => calcPeriodFlow(transactions, from, to),
    [transactions, from, to],
  )
  const netWorth = calcNetWorth(accounts, prices) + investValue
  const prefix   = PERIOD_LABEL[periodType]

  const totalOwed = getActive().filter(d => d.direction === 'owe').reduce((s, d) => s + d.remainingAmount, 0)

  const animExpense   = useCountUp(expense)
  const animIncome    = useCountUp(income)
  const animNetWorth  = useCountUp(Math.abs(netWorth))
  const animNet       = useCountUp(Math.abs(net))
  const animTotalOwed = useCountUp(totalOwed)

  // Previous period comparison
  const prevRange = useMemo(() => getPrevPeriodRange(periodType), [periodType])
  const prevFlow = useMemo(() => {
    if (!prevRange) return null
    return calcPeriodFlow(transactions, prevRange.from, prevRange.to)
  }, [transactions, prevRange])
  const prevNetWorth = useMemo(() => {
    if (!prevRange) return null
    const prevTxs = transactions.filter(t => t.date <= prevRange.to)
    const prevAccounts = accounts.map(a => ({
      ...a,
      balance: a.initialBalance + computeTransactionEffect(a.id, prevTxs),
    }))
    const prevInvestTxs = investTxs.filter(t => t.date <= prevRange.to)
    const prevInvestValue = computeHoldings(prevInvestTxs, prices).reduce((s, h) => s + h.currentValue, 0)
    return calcNetWorth(prevAccounts, prices) + prevInvestValue
  }, [accounts, transactions, investTxs, prices, prevRange])

  const recent  = useMemo(() => transactions.slice(0, 8), [transactions])
  const budgets = useMemo(() => getBudgets(selectedPeriod, transactions).slice(0, 5), [selectedPeriod, transactions, getBudgets])
  const dueSoon = getDueSoon(30)
  const pending = getDue(today())

  async function handleGenerate(id: string) {
    const r = pending.find(x => x.id === id)
    if (!r) return
    const now = new Date().toISOString()
    await addTransaction({
      id: crypto.randomUUID(), type: r.type, amount: r.amount, currency: r.currency,
      date: r.nextDueDate, accountId: r.accountId, toAccountId: r.toAccountId,
      categoryId: r.categoryId, description: r.description, notes: r.notes,
      isInstallment: false, familyMemberId: r.familyMemberId, recipientId: r.recipientId,
      createdAt: now, updatedAt: now,
    })
    await markGenerated(id, today())
  }

  return (
    <>
      <Header title="Dashboard" action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction') }} />
      <PeriodTabs />

      <div className="p-6 space-y-6">

        {/* ── Stat Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {((): { label: string; value: string; sub: string; ok: boolean; trendDiff: number | null; betterWhenHigher: boolean }[] => [
            {
              label: `${prefix} · Gider`,
              value: formatCompact(animExpense),
              sub: expense === 0 ? 'işlem yok' : `${formatCompact(income)} gelir`,
              ok: false,
              trendDiff: prevFlow ? expense - prevFlow.expense : null,
              betterWhenHigher: false,
            },
            {
              label: `${prefix} · Gelir`,
              value: formatCompact(animIncome),
              sub: income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`,
              ok: true,
              trendDiff: prevFlow ? income - prevFlow.income : null,
              betterWhenHigher: true,
            },
            {
              label: 'Net Varlık',
              value: (netWorth < 0 ? '−' : '') + formatCompact(animNetWorth),
              sub: `${accounts.length} hesap`,
              ok: netWorth >= 0,
              trendDiff: prevNetWorth !== null ? netWorth - prevNetWorth : null,
              betterWhenHigher: true,
            },
            {
              label: `${prefix} · Net`,
              value: (net >= 0 ? '+' : '−') + formatCompact(animNet),
              sub: net > 0 ? 'fazla tasarruf' : net < 0 ? 'bütçe açığı' : 'başabaş',
              ok: net >= 0,
              trendDiff: prevFlow ? net - prevFlow.net : null,
              betterWhenHigher: true,
            },
          ])().map(({ label, value, sub, ok, trendDiff, betterWhenHigher }) => {
            const isPositiveTrend = trendDiff !== null && (betterWhenHigher ? trendDiff >= 0 : trendDiff <= 0)
            return (
              <Card key={label} className="gap-2">
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <p className={`text-3xl font-normal tabular-nums ${ok ? 'text-green-600' : 'text-destructive'}`}>{value}</p>
                </CardHeader>
                <CardContent className="space-y-1">
                  {trendDiff !== null && trendDiff !== 0 && (
                    <p className={`text-xs font-semibold tabular-nums ${isPositiveTrend ? 'text-green-500' : 'text-destructive'}`}>
                      {trendDiff > 0 ? '▲' : '▼'} {formatCompact(Math.abs(trendDiff))}
                      <span className="font-normal text-muted-foreground ml-1">önceki dönemden</span>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* ── Charts ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CashflowChart />
          <NetWorthChart />
        </div>

        {/* ── Budget + Recent Transactions ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Budget */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Bütçe Durumu</CardTitle>
                <Link href="/budgets" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </div>
              <CardDescription>Bu ay harcama limitleri</CardDescription>
            </CardHeader>
            <CardContent>
              {budgets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bu ay için bütçe tanımlı değil.</p>
              ) : (
                <div className="space-y-4">
                  {budgets.map(b => {
                    const cat = categories.find(c => c.id === b.categoryId)
                    return (
                      <div key={b.id} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{cat?.icon} {cat?.name}</span>
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {formatCurrency(b.spent, 'TRY')} / {formatCurrency(b.amount, 'TRY')}
                          </span>
                        </div>
                        <ProgressBar percent={b.percentUsed} status={b.status} showLabel />
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <Card className="gap-0">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>Son İşlemler</CardTitle>
                <Link href="/transactions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recent.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">Henüz işlem yok.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map(tx => {
                    const cat     = categories.find(c => c.id === tx.categoryId)
                    const account = allAccounts.find(a => a.id === tx.accountId)
                    const isIncome   = tx.type === 'income'
                    const isTransfer = tx.type === 'transfer'
                    return (
                      <li key={tx.id} className="flex items-center gap-3 px-6 py-3">
                        <span className="text-base w-6 text-center shrink-0 select-none">
                          {cat?.icon ?? (isTransfer ? '↔' : '·')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{tx.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateShort(tx.date)} · {account?.name ?? '—'}
                          </p>
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 font-medium ${isIncome ? 'text-green-600' : isTransfer ? 'text-primary' : 'text-foreground'}`}>
                          {isIncome ? '+' : isTransfer ? '↔' : '−'}{formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Pending Recurring ───────────────────────────────── */}
        {pending.length > 0 && (
          <Card className="gap-0">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  Bekleyen Tekrarlayan İşlemler
                  <Badge variant="warning" className="ml-1">{pending.length}</Badge>
                </CardTitle>
                <Link href="/recurring" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {pending.slice(0, 5).map(r => {
                  const cat     = categories.find(c => c.id === r.categoryId)
                  const account = allAccounts.find(a => a.id === r.accountId)
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-6 py-3">
                      <span className="text-base w-6 text-center shrink-0">{cat?.icon ?? '↻'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        {account && <p className="text-xs text-muted-foreground">{account.name}</p>}
                      </div>
                      <span className={`text-sm tabular-nums shrink-0 font-medium ${r.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                        {r.type === 'income' ? '+' : '−'}{formatCurrency(r.amount)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => handleGenerate(r.id)} className="shrink-0">
                        Kaydet
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ── Accounts + Debt ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Accounts */}
          <Card className="gap-0">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle>Hesaplar</CardTitle>
                <Link href="/accounts" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Yönet →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {accounts.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">Henüz hesap yok.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {accounts.map(a => (
                    <li key={a.id}>
                      <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/50 transition-colors">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE[a.type] ?? a.type}</p>
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 ${a.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {formatCurrency(a.balance, a.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Debt Summary */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Borç Takibi</CardTitle>
                <Link href="/debts" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </div>
              <CardDescription>Yaklaşan ödemeler ve toplam borç</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-normal tabular-nums">{formatCurrency(animTotalOwed)}</span>
                <span className="text-sm text-muted-foreground">toplam borç</span>
              </div>
              <Separator />
              {dueSoon.length === 0 ? (
                <p className="text-sm text-muted-foreground">30 gün içinde vadesi gelen ödeme yok.</p>
              ) : (
                <div className="space-y-3">
                  {dueSoon.map(debt => {
                    const overdue = debt.dueDate && isOverdue(debt.dueDate)
                    const days    = debt.dueDate ? daysUntil(debt.dueDate) : null
                    return (
                      <div key={debt.id} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{debt.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {debt.counterparty && `${debt.counterparty} · `}
                            {debt.dueDate && formatDate(debt.dueDate, 'd MMM yyyy')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm tabular-nums font-medium">
                            {formatCurrency(debt.monthlyPayment ?? debt.remainingAmount)}
                          </span>
                          {overdue ? (
                            <Badge variant="danger">Gecikmiş</Badge>
                          ) : days !== null && days <= 7 ? (
                            <Badge variant="warning">{days}g</Badge>
                          ) : (
                            <Badge variant="default">{days}g</Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </>
  )
}
