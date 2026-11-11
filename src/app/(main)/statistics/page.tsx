'use client'

import { useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { PeriodTabs } from '@/components/ui/PeriodTabs'
import { AccountFilter } from '@/components/ui/AccountFilter'
import { FundGainToggle } from '@/components/dashboard/FundGainToggle'
import { usePeriod } from '@/lib/hooks/usePeriod'
import { allTimeRange } from '@/lib/period'
import { useTransactionStore, useAccountStore, useCategoryStore, useInvestmentStore, useDebtStore, useSettingsStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { excludeFuture } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { DetailedStats } from '@/components/reports/DetailedStats'

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function StatisticsPage() {
  const transactions  = useTransactionStore(s => s.transactions)
  const txsReady      = useTransactionStore(s => s.ready)
  const accountsReady = useAccountStore(s => s.ready)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)
  const debts         = useDebtStore(useShallow(s => s.debts))
  const investTxs     = useInvestmentStore(s => s.transactions)
  const prices        = useInvestmentStore(s => s.prices)
  const fundPrices    = useInvestmentStore(s => s.fundPrices)
  // Dashboard/Raporlar ile paylaşılan kalıcı ayar — "Dönem Toplamı" üçünde de
  // aynı gelir/gideri göstersin (bkz. DetailedStats.period).
  const includeFundGain = useSettingsStore(s => s.includeFundGain)

  const [accountId,  setAccountId]  = useState('all')

  // Sayfalar arası paylaşılan dönem (bkz. ui.store) — Raporlar ile aynı aralık
  const { type: periodType, custom, from: selFrom, to: selTo } = usePeriod()
  const dateRange = useMemo(
    () => (periodType === 'all' && !custom ? allTimeRange(transactions) : { from: selFrom, to: selTo }),
    [periodType, custom, selFrom, selTo, transactions],
  )

  const reportTxs = useMemo(() => collapseInstallments(transactions), [transactions])

  // excludeFuture (isPosted): onay bekleyen/gelecek satırlar dönem gelir/gider
  // analizine girmez — Dashboard/Raporlar akış kapsamıyla aynı (net-varlık geri
  // yürüyüşü tam geçmişi kendi excludeFuture'ıyla ayrıca kullanır, alttaki prop).
  const filteredTxs = useMemo(() =>
    excludeFuture(reportTxs).filter(tx => {
      // slice(0,10): son-gün datetime satırı aralıktan düşmesin (isInRange kuralı)
      const d = tx.date.slice(0, 10)
      if (d < dateRange.from || d > dateRange.to) return false
      if (accountId !== 'all') {
        if (tx.accountId !== accountId && tx.toAccountId !== accountId) return false
      }
      return true
    }),
    [reportTxs, dateRange, accountId],
  )

  /* Effective range: the start date is always the date of the first
     transaction inside the selected period (never the preset's nominal
     start), so day counts / averages / net-worth replay all begin from
     actual activity. */
  const effectiveRange = useMemo(() => {
    let first: string | null = null
    for (const tx of filteredTxs) {
      if (first === null || tx.date < first) first = tx.date
    }
    return first && first > dateRange.from ? { ...dateRange, from: first } : dateRange
  }, [filteredTxs, dateRange])

  const isLoading = !txsReady || !accountsReady

  return (
    <>
      <Header title="İstatistikler" />

      <PeriodTabs rightSlot={<FundGainToggle />} />
      <div className="px-4 lg:px-6 py-2 lg:py-3 border-b border-border/50 bg-card flex flex-wrap items-center gap-3 flex-shrink-0">
        <AccountFilter value={accountId} onChange={setAccountId} />
      </div>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="p-6 flex flex-col gap-6 overflow-auto flex-1">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-2.5 w-40 bg-muted rounded animate-pulse" />
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <DetailedStats
            filteredTxs={filteredTxs}
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            dateRange={effectiveRange}
            accountId={accountId}
            investTxs={investTxs}
            prices={prices}
            fundPrices={fundPrices}
            debts={debts}
            includeFundGain={includeFundGain}
          />
        )}
      </div>
    </>
  )
}
