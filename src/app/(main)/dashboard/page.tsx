'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import {
  useTransactionStore, useAccountStore, useUIStore,
  useInvestmentStore, useBudgetStore, useCategoryStore,
  useDebtStore, useRecurringStore,
} from '@/store'
import { calcNetWorth, calcPeriodFlow } from '@/lib/utils/calculations'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { getPeriodRange, formatDateShort, formatDate, daysUntil, isOverdue, today } from '@/lib/utils/date'
import dynamic from 'next/dynamic'
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Header } from '@/components/layout/Header'
import { PeriodTabs } from '@/components/ui/PeriodTabs'
import type { PeriodType } from '@/types'

const CashflowChart = dynamic(
  () => import('@/components/dashboard/CashflowChart').then(m => ({ default: m.CashflowChart })),
  { ssr: false, loading: () => <Card className="h-60 animate-pulse bg-muted/30" /> },
)
const NetWorthChart = dynamic(
  () => import('@/components/dashboard/NetWorthChart').then(m => ({ default: m.NetWorthChart })),
  { ssr: false, loading: () => <Card className="h-60 animate-pulse bg-muted/30" /> },
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

  const recent  = useMemo(() => transactions.slice(0, 8), [transactions])
  const budgets = useMemo(() => getBudgets(selectedPeriod, transactions).slice(0, 5), [selectedPeriod, transactions, getBudgets])
  const dueSoon = getDueSoon(30)
  const totalOwed = getActive().filter(d => d.direction === 'owe').reduce((s, d) => s + d.remainingAmount, 0)
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

      <div className="p-6 lg:p-8 space-y-6 lg:space-y-8">

        {/* ── Stat Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: `${prefix} · Gider`,  value: formatCompact(expense),  sub: expense === 0 ? 'işlem yok' : `${formatCompact(income)} gelir`,     ok: false },
            { label: `${prefix} · Gelir`,  value: formatCompact(income),   sub: income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`,     ok: true  },
            { label: 'Net Varlık',          value: formatCompact(netWorth), sub: `${accounts.length} hesap`,                                         ok: netWorth >= 0 },
            { label: `${prefix} · Net`,     value: (net >= 0 ? '+' : '') + formatCompact(net), sub: net > 0 ? 'fazla tasarruf' : net < 0 ? 'bütçe açığı' : 'başabaş', ok: net >= 0 },
          ].map(({ label, value, sub, ok }) => (
            <Card key={label}>
              <CardContent className="pt-6">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                <p className={`mt-2 text-3xl font-light tracking-tight tabular-nums ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Charts ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <CashflowChart />
          <NetWorthChart />
        </div>

        {/* ── Budget + Recent Transactions ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Budget */}
          <Card>
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-sm font-semibold">Bütçe Durumu</CardTitle>
              <CardAction>
                <Link href="/budgets" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </CardAction>
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
          <Card>
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-sm font-semibold">Son İşlemler</CardTitle>
              <CardAction>
                <Link href="/transactions" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </CardAction>
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
                      <li key={tx.id} className="flex items-center gap-3 px-6 py-3.5">
                        <span className="text-base w-6 text-center shrink-0 select-none">
                          {cat?.icon ?? (isTransfer ? '↔' : '·')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{tx.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateShort(tx.date)} · {account?.name ?? '—'}
                          </p>
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 font-medium ${isIncome ? 'text-emerald-400' : isTransfer ? 'text-sky-400' : 'text-foreground'}`}>
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
          <Card>
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Bekleyen Tekrarlayan İşlemler
                <Badge variant="warning" className="ml-1">{pending.length}</Badge>
              </CardTitle>
              <CardAction>
                <Link href="/recurring" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {pending.slice(0, 5).map(r => {
                  const cat     = categories.find(c => c.id === r.categoryId)
                  const account = allAccounts.find(a => a.id === r.accountId)
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-6 py-3.5">
                      <span className="text-base w-6 text-center shrink-0">{cat?.icon ?? '↻'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        {account && (
                          <p className="text-xs text-muted-foreground">{account.name}</p>
                        )}
                      </div>
                      <span className={`text-sm tabular-nums shrink-0 font-medium ${r.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {r.type === 'income' ? '+' : '−'}{formatCurrency(r.amount)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerate(r.id)}
                        className="shrink-0 rounded-xl"
                      >
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Accounts */}
          <Card>
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-sm font-semibold">Hesaplar</CardTitle>
              <CardAction>
                <Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Yönet →
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              {accounts.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">Henüz hesap yok.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {accounts.map(a => (
                    <li key={a.id}>
                      <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/50 transition-colors">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE[a.type] ?? a.type}</p>
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 ${a.balance < 0 ? 'text-rose-400' : 'text-foreground'}`}>
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
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-sm font-semibold">Borç Takibi</CardTitle>
              <CardAction>
                <Link href="/debts" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-light tracking-tight tabular-nums">{formatCurrency(totalOwed)}</span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">toplam borç</span>
              </div>
              <Separator className="mb-4" />
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
