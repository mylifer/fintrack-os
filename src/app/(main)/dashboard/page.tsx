'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import {
  useTransactionStore, useAccountStore, useUIStore,
  useInvestmentStore, useBudgetStore, useCategoryStore,
  useDebtStore, useRecurringStore, usePeopleStore, useSettingsStore,
} from '@/store'
import { format, parseISO, startOfMonth, subDays, differenceInDays } from 'date-fns'
import { calcNetWorth, calcTotalAssets, calcPeriodFlow, computeTransactionEffect, isPosted, isRealizedInvestmentPnlTx } from '@/lib/utils/calculations'
import { computeHoldings } from '@/store/investment.store'
import { tefasCodesIn } from '@/lib/tefas'
import { calcFundPeriodGain, type FundPricePoint } from '@/lib/utils/fund-period-gain'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { getPeriodRange, getPrevPeriodRange, formatDateShort, formatDate, daysUntil, isOverdue, today } from '@/lib/utils/date'
import { approveRecurring } from '@/lib/utils/recurring-actions'
import dynamic from 'next/dynamic'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Header } from '@/components/layout/Header'
import { PeriodTabs } from '@/components/ui/PeriodTabs'
import { FundGainToggle } from '@/components/dashboard/FundGainToggle'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { TagBadges } from '@/components/transactions/TagBadges'
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

// Gelir kartındaki fon getirisi satırının dönem sıfatı ('Tüm Zamanlar'da
// yalnız gerçekleşmemiş K/Z — satış kârları zaten gelir işlemi olarak sayılır)
const FUND_GAIN_LABEL: Record<PeriodType, string> = {
  daily: 'günlük', weekly: 'bu haftaki', monthly: 'bu ayki',
  yearly: 'bu yılki', all: 'toplam',
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
  const prices       = useInvestmentStore(s => s.prices)
  const fundPrices   = useInvestmentStore(s => s.fundPrices)
  const investTxs    = useInvestmentStore(s => s.transactions)
  const fetchPrices  = useInvestmentStore(s => s.fetchPrices)

  // Yatırımlar sayfasındaki polling'in aynısı: açılıştaki tek fetch sessizce
  // başarısız olursa fon/FX fiyatları dashboard'da da kendini toparlasın
  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 60 * 1000)
    return () => clearInterval(id)
  }, [fetchPrices])
  const holdings     = useMemo(
    () => prices ? computeHoldings(investTxs, prices, fundPrices) : [],
    [investTxs, prices, fundPrices],
  )
  const investValue  = useMemo(() => holdings.reduce((s, h) => s + h.currentValue, 0), [holdings])
  const getBudgets   = useBudgetStore(s => s.getMonthBudgets)
  const getActive    = useDebtStore(s => s.getActive)
  const getDue       = useRecurringStore(s => s.getDue)
  const people       = usePeopleStore(s => s.people)

  // Özel (custom) tarih aralığı — sayfa-yerel; global periodType'a dokunmaz.
  // Raporlar sayfasındaki 'custom' preset ile aynı mantık: girilmemiş uçlar için
  // varsayılan ay başı → bugün. Aktifken PeriodTabs sekmeleri highlight'ı kaybeder.
  const [customActive, setCustomActive] = useState(false)
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')

  const { from, to } = useMemo(() => {
    if (customActive) {
      return {
        from: customFrom || format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        to:   customTo   || today(),
      }
    }
    return getPeriodRange(periodType)
  }, [customActive, customFrom, customTo, periodType])

  // Seçili dönemin TEFAS fon getirisi. Dönem başı kapanışı için fon başına
  // günlük seri bir kez çekilir (kod+dönem anahtarıyla; tarihi veri değişmez).
  // 'Bugün' son iki kapanış farkını, 'Tüm Zamanlar' gerçekleşmemiş K/Z'yi
  // kullandığından ikisi de seri gerektirmez.
  const fundCodes = useMemo(() => tefasCodesIn(investTxs.map(t => t.asset)), [investTxs])
  const [fundHistory, setFundHistory] = useState<Record<string, FundPricePoint[]>>({})
  const histRequested = useRef(new Set<string>())
  useEffect(() => {
    // Özel aralık her zaman sınırlı bir dönemdir → 'daily'/'all' atlamasına takılmaz.
    if (!customActive && (periodType === 'daily' || periodType === 'all')) return
    // Baz fiyat dönem içindeki ilk kapanış; seri yine de 10 gün geriden istenir
    // (fazla noktalar yok sayılır — anahtar `kod:from` olduğundan cache bozulmaz)
    const histFrom = new Date(new Date(from + 'T00:00:00Z').getTime() - 10 * 86_400_000)
      .toISOString().slice(0, 10)
    for (const code of fundCodes) {
      const key = `${code}:${from}`
      if (histRequested.current.has(key)) continue
      histRequested.current.add(key)
      fetch(`/api/prices/history?asset=TEFAS&code=${code}&from=${histFrom}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((pts: FundPricePoint[] | null) => {
          if (Array.isArray(pts) && pts.length) setFundHistory(h => ({ ...h, [key]: pts }))
          else histRequested.current.delete(key)
        })
        .catch(() => histRequested.current.delete(key))
    }
  }, [fundCodes, from, periodType, customActive])

  // Seçili dönemin işaretli fon getirisi (checkbox açıkken Gelir/Net'e eklenir).
  const fundPeriodNet = useMemo(() => {
    const hist: Record<string, FundPricePoint[]> = {}
    for (const code of fundCodes) {
      const pts = fundHistory[`${code}:${from}`]
      if (pts) hist[code] = pts
    }
    return calcFundPeriodGain(investTxs, fundPrices, hist, from, to, !customActive && periodType === 'daily')
  }, [fundCodes, fundHistory, investTxs, fundPrices, from, to, periodType, customActive])
  // "Fon getirileri dahil" (sağ üst checkbox): açıkken dönemin POZİTİF fon getirisi
  // Gelir/Net kartına eklenir, kapalıyken hariç tutulur — kullanıcı isteğine göre
  // fonlu/fonsuz geliri görebilsin. Negatif dönem getirisi gelire yansıtılmaz (gelir
  // nakdin altına inmesin); yalnız bilgi satırında gösterilir.
  const includeFundGain = useSettingsStore(s => s.includeFundGain)
  const fundGain = includeFundGain && fundPeriodNet > 0 ? fundPeriodNet : 0
  // Anahtar KAPALIYKEN gelir/net "fon-sız" olmalı: gerçekleşmemiş fon getirisi
  // (fundGain=0) YANINDA gerçekleşen "… Satış Kârı/Zararı" satırları da akıştan
  // düşülür. Açıkken mevcut davranış (hepsi dahil) korunur.
  const flowTxs = useMemo(
    () => includeFundGain ? transactions : transactions.filter(t => !isRealizedInvestmentPnlTx(t)),
    [transactions, includeFundGain],
  )
  const { income, expense, net } = useMemo(
    () => calcPeriodFlow(flowTxs, from, to),
    [flowTxs, from, to],
  )
  const netWorth    = calcNetWorth(accounts, prices) + investValue
  const totalAssets = calcTotalAssets(accounts, prices) + investValue
  const prefix      = customActive ? 'Seçili Dönem' : PERIOD_LABEL[periodType]
  const fundGainLabel = customActive ? 'seçili dönem' : FUND_GAIN_LABEL[periodType]

  const totalOwed = getActive().filter(d => d.direction === 'owe').reduce((s, d) => s + d.remainingAmount, 0)

  const incomeTotal = income + fundGain
  // Net kartı Gelir kartıyla aynı tabanı kullanır: Gelir fon getirisini içerdiğinde
  // Net de içermeli, aksi halde ekranda Gelir − Gider ≠ Net görünür.
  const netTotal = net + fundGain

  const animExpense     = useCountUp(expense)
  const animIncome      = useCountUp(incomeTotal)
  const animNetWorth    = useCountUp(Math.abs(netWorth))
  const animTotalAssets = useCountUp(totalAssets)
  const animNet         = useCountUp(Math.abs(netTotal))
  const animTotalOwed   = useCountUp(totalOwed)

  // Previous period comparison
  // Özel aralıkta önceki dönem = hemen öncesindeki eşit uzunlukta pencere
  // (Raporlar'daki buildPeriodComparison ile aynı kural).
  const prevRange = useMemo(() => {
    if (customActive) {
      const f    = parseISO(from)
      const days = differenceInDays(parseISO(to), f) + 1
      return { from: format(subDays(f, days), 'yyyy-MM-dd'), to: format(subDays(f, 1), 'yyyy-MM-dd') }
    }
    return getPrevPeriodRange(periodType)
  }, [customActive, from, to, periodType])
  const prevFlow = useMemo(() => {
    if (!prevRange) return null
    // flowTxs: anahtar kapalıyken önceki dönem de fon-sız tabana oturur → trend
    // ('önceki dönemden') farkı aynı temele göre hesaplanır.
    return calcPeriodFlow(flowTxs, prevRange.from, prevRange.to)
  }, [flowTxs, prevRange])
  const prevWorth = useMemo(() => {
    if (!prevRange) return null
    const prevTxs = transactions.filter(t => isPosted(t, prevRange.to))
    const prevAccounts = accounts.map(a => ({
      ...a,
      balance: a.initialBalance + computeTransactionEffect(a, prevTxs),
    }))
    const prevInvestTxs = investTxs.filter(t => t.date <= prevRange.to)
    const prevInvestValue = computeHoldings(prevInvestTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0)
    return {
      netWorth: calcNetWorth(prevAccounts, prices) + prevInvestValue,
      totalAssets: calcTotalAssets(prevAccounts, prices) + prevInvestValue,
    }
  }, [accounts, transactions, investTxs, prices, fundPrices, prevRange])

  // Son eklenenler: işlem tarihinden bağımsız, ekleme zamanına (createdAt) göre
  const recent  = useMemo(
    () => [...transactions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 8),
    [transactions],
  )
  const budgets = useMemo(() => getBudgets(selectedPeriod, transactions).slice(0, 5), [selectedPeriod, transactions, getBudgets])
  // Vadesi yakın olan üstte; vadesiz borçlar listenin sonunda
  const activeDebts = getActive()
    .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'))
  const pending = getDue(today())

  const [generatingId, setGeneratingId] = useState<string | null>(null)

  async function handleGenerate(id: string) {
    const r = pending.find(x => x.id === id)
    if (!r || generatingId) return
    setGeneratingId(id)
    try {
      // Paylaşılan onay mantığı: catch-up (tüm kaçırılan dönemler) + deterministik
      // id'ler — recurring sayfası ve bildirim paneliyle birebir aynı davranış.
      await approveRecurring(r, today())
    } catch (err) {
      console.error('[dashboard:generate]', err)
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <>
      <Header title="Dashboard" action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction') }} />
      <PeriodTabs
        rightSlot={<FundGainToggle />}
        custom={{
          active: customActive,
          from: customFrom,
          to: customTo,
          onActivate: () => setCustomActive(true),
          onExit: () => setCustomActive(false),
          onChange: ({ from: f, to: t }) => {
            if (f !== undefined) setCustomFrom(f)
            if (t !== undefined) setCustomTo(t)
          },
        }}
      />

      <div className="p-6 space-y-6">

        {/* ── Stat Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {((): { label: string; value: string; sub: string; ok: boolean; trendDiff: number | null; betterWhenHigher: boolean }[] => [
            {
              label: `${prefix} · Gider`,
              value: formatCompact(animExpense),
              sub: expense === 0 ? 'işlem yok' : `${formatCompact(incomeTotal)} gelir`,
              ok: false,
              trendDiff: prevFlow ? expense - prevFlow.expense : null,
              betterWhenHigher: false,
            },
            {
              label: `${prefix} · Gelir`,
              value: formatCompact(animIncome),
              // Fon getirisi satırı yalnız toggle açıkken; kapalıyken fon
              // hesaba katılmadığından ham gelir/gider bilgisi gösterilir.
              sub: !includeFundGain
                ? (income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`)
                : fundPeriodNet > 0.005 // yarım kuruş eşiği: float tozu "±₺0" satırı üretmesin
                  ? `${formatCompact(fundPeriodNet)} ${fundGainLabel} fon getirisi dahil`
                  : fundPeriodNet < -0.005
                    ? `−${formatCompact(Math.abs(fundPeriodNet))} ${fundGainLabel} fon değişimi (gelire eklenmedi)`
                    : income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`,
              ok: incomeTotal >= 0,
              trendDiff: prevFlow ? incomeTotal - prevFlow.income : null,
              betterWhenHigher: true,
            },
            {
              label: 'Net Varlık',
              value: (netWorth < 0 ? '−' : '') + formatCompact(animNetWorth),
              sub: `${accounts.length} hesap`,
              ok: netWorth >= 0,
              trendDiff: prevWorth ? netWorth - prevWorth.netWorth : null,
              betterWhenHigher: true,
            },
            {
              label: 'Toplam Varlık',
              value: formatCompact(animTotalAssets),
              sub: investValue > 0 ? `${formatCompact(investValue)} yatırım` : 'hesaplar + yatırımlar',
              ok: true,
              trendDiff: prevWorth ? totalAssets - prevWorth.totalAssets : null,
              betterWhenHigher: true,
            },
            {
              label: `${prefix} · Net`,
              value: (netTotal >= 0 ? '+' : '−') + formatCompact(animNet),
              sub: netTotal > 0 ? 'fazla tasarruf' : netTotal < 0 ? 'bütçe açığı' : 'başabaş',
              ok: netTotal >= 0,
              trendDiff: prevFlow ? netTotal - prevFlow.net : null,
              betterWhenHigher: true,
            },
          ])().map(({ label, value, sub, ok, trendDiff, betterWhenHigher }) => {
            const isPositiveTrend = trendDiff !== null && (betterWhenHigher ? trendDiff >= 0 : trendDiff <= 0)
            return (
              <Card key={label} className="gap-2">
                <CardHeader className="@container px-4 sm:px-6 pb-2">
                  <CardDescription>{label}</CardDescription>
                  <p className={`kpi-value font-normal tabular-nums ${ok ? 'text-green-600' : 'text-destructive'}`}>{value}</p>
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
          <CashflowChart
            periodType={periodType}
            customRange={customActive ? { from, to } : null}
            periodLabel={prefix}
          />
          <NetWorthChart />
        </div>

        {/* ── Accounts + Recent Transactions ──────────────────── */}
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
                        <AccountAvatar account={a} size="sm" />
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
                    const cat       = categories.find(c => c.id === tx.categoryId)
                    const account   = allAccounts.find(a => a.id === tx.accountId)
                    const recipient = tx.recipientId    ? people.find(p => p.id === tx.recipientId)    : null
                    const family    = tx.familyMemberId ? people.find(p => p.id === tx.familyMemberId) : null
                    const person    = recipient ?? family
                    const isIncome   = tx.type === 'income'
                    const isTransfer = tx.type === 'transfer'
                    const isRefund   = tx.type === 'expense' && tx.amount < 0
                    return (
                      <li key={tx.id} className="flex items-center gap-3 px-6 py-3">
                        {person ? (
                          <PersonAvatar person={person} size="sm" className="shrink-0" />
                        ) : cat ? (
                          <span
                            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                            style={{ background: cat.color ? `${cat.color}20` : 'rgba(255,255,255,0.06)' }}
                          >
                            <CategoryIcon icon={cat.icon} color={cat.color} size={15} />
                          </span>
                        ) : (
                          <span className="text-base w-7 text-center shrink-0 select-none">
                            {tx.icon ?? (isTransfer ? '↔' : '·')}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {tx.description}
                            {isRefund && (
                              <span className="ml-1.5 align-middle rounded-sm bg-green-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">
                                İade
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateShort(tx.date)} · {account?.name ?? '—'}
                            {tx.createdAt && <> · eklendi {formatDate(tx.createdAt, 'd MMM HH:mm')}</>}
                          </p>
                          <TagBadges tags={tx.tags} className="mt-1" />
                        </div>
                        <span className={`text-sm tabular-nums shrink-0 font-medium ${isIncome || isRefund ? 'text-green-600' : isTransfer ? 'text-primary' : 'text-foreground'}`}>
                          {isIncome || isRefund ? '+' : isTransfer ? '↔' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
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
                    <li key={r.id} className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-6 py-3">
                      {cat ? (
                        <span
                          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                          style={{ background: cat.color ? `${cat.color}20` : 'rgba(255,255,255,0.06)' }}
                        >
                          <CategoryIcon icon={cat.icon} color={cat.color} size={15} />
                        </span>
                      ) : (
                        <span className="text-base w-7 text-center shrink-0 select-none">↻</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        {account && <p className="text-xs text-muted-foreground truncate">{account.name}</p>}
                      </div>
                      <span className={`text-sm tabular-nums shrink-0 font-medium ${r.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                        {r.type === 'income' ? '+' : '−'}{formatCurrency(r.amount)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => handleGenerate(r.id)} disabled={!!generatingId} className="shrink-0">
                        {generatingId === r.id ? '…' : 'Kaydet'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ── Budget + Debt ───────────────────────────────────── */}
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
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {cat && <CategoryIcon icon={cat.icon} color={cat.color} size={14} />}
                            {cat?.name}
                          </span>
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

          {/* Debt Summary */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Borç Takibi</CardTitle>
                <Link href="/debts" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Tümü →
                </Link>
              </div>
              <CardDescription>Aktif borçlar ve toplam borç</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-normal tabular-nums">{formatCurrency(animTotalOwed)}</span>
                <span className="text-sm text-muted-foreground">toplam borç</span>
              </div>
              <Separator />
              {activeDebts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aktif borç yok.</p>
              ) : (
                <div className="space-y-3">
                  {activeDebts.map(debt => {
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
                          ) : days !== null ? (
                            <Badge variant="default">{days}g</Badge>
                          ) : null}
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
