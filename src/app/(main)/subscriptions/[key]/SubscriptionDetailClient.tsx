'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTransactionStore, useInvestmentStore } from '@/store'
import { TransactionList } from '@/components/transactions/TransactionList'
import { BrandLogo } from '@/components/subscriptions/BrandLogo'
import { findSubscriptionGroup } from '@/lib/utils/subscriptions'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'

interface Props { groupKey: string }

/** Back header — shared by both the resolved and "not found" states. */
function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Abonelikler
      </button>
    </div>
  )
}

/** A single stat in the summary row. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-medium tabular-nums text-foreground">{value}</div>
    </div>
  )
}

export default function SubscriptionDetailClient({ groupKey }: Props) {
  const router       = useRouter()
  const transactions = useTransactionStore(s => s.transactions)
  const txsReady     = useTransactionStore(s => s.ready)
  // Subscribe to prices so TRY figures recompute once live FX rates load
  // (toBaseTry reads module-level rates published by the investment store).
  useInvestmentStore(s => s.prices)

  const group = useMemo(
    () => findSubscriptionGroup(transactions, groupKey),
    [transactions, groupKey],
  )

  // Wait for the store before deciding a subscription can't be found.
  if (!txsReady) return null

  // Stale link / no matching subscription — friendly empty state, no crash.
  if (!group) {
    return (
      <div className="flex flex-col h-full">
        <BackHeader onBack={() => router.push('/subscriptions')} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="text-base font-semibold text-foreground">Bu abonelik bulunamadı</div>
          <div className="text-sm text-muted-foreground max-w-sm">
            Aradığınız abonelik artık mevcut değil — muhtemelen işlemler değişti.
          </div>
          <button
            onClick={() => router.push('/subscriptions')}
            className="mt-2 inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Aboneliklere dön
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Back header */}
      <BackHeader onBack={() => router.push('/subscriptions')} />

      {/* Subscription summary */}
      <div className="px-6 py-5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <BrandLogo brand={group.brand} name={group.name} size={40} />
          <div className="min-w-0">
            <div className="text-base font-semibold text-foreground truncate">{group.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Abonelik</div>
          </div>
        </div>

        <div className="flex gap-6 pt-4 border-t border-border flex-wrap">
          <Stat label="Son ödeme"      value={formatCurrency(group.latestAmount, group.currency)} />
          <Stat label="Aylık tahmini"  value={formatCurrency(group.monthlyEstimateTry)} />
          <Stat label="Toplam"         value={formatCurrency(group.totalTry)} />
          <Stat label="Ödeme sayısı"   value={String(group.count)} />
          <Stat label="Son tarih"      value={formatDate(group.lastDate)} />
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={group.txs}
          layout="table"
          showAccount
          emptyTitle="İşlem yok"
          emptyDescription="Bu aboneliğe ait işlem bulunamadı."
        />
      </div>
    </div>
  )
}
