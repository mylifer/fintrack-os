'use client'

import { useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns'
import { Header } from '@/components/layout/Header'
import { SelectField } from '@/components/ui/Select'
import { useTransactionStore, useAccountStore, useCategoryStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { excludeFuture } from '@/lib/utils/calculations'
import { DetailedStats } from '@/components/reports/DetailedStats'

/* ── Types & period helpers (same semantics as the Reports page) ──────── */

type Preset = 'this-month' | 'last-month' | '3-months' | 'this-year' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this-month', label: 'Bu Ay' },
  { key: 'last-month', label: 'Geçen Ay' },
  { key: '3-months',   label: 'Son 3 Ay' },
  { key: 'this-year',  label: 'Bu Yıl' },
  { key: 'custom',     label: 'Özel' },
]

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

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function StatisticsPage() {
  const transactions  = useTransactionStore(s => s.transactions)
  const txsReady      = useTransactionStore(s => s.ready)
  const accountsReady = useAccountStore(s => s.ready)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)
  const investTxs     = useInvestmentStore(s => s.transactions)
  const prices        = useInvestmentStore(s => s.prices)
  const fundPrices    = useInvestmentStore(s => s.fundPrices)

  const [preset,     setPreset]     = useState<Preset>('this-month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [accountId,  setAccountId]  = useState('all')

  const dateRange = useMemo(
    () => getPresetRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  )

  // excludeFuture (isPosted): onay bekleyen/gelecek satırlar dönem gelir/gider
  // analizine girmez — Dashboard/Raporlar akış kapsamıyla aynı (net-varlık geri
  // yürüyüşü tam geçmişi kendi excludeFuture'ıyla ayrıca kullanır, alttaki prop).
  const filteredTxs = useMemo(() =>
    excludeFuture(transactions).filter(tx => {
      // slice(0,10): son-gün datetime satırı aralıktan düşmesin (isInRange kuralı)
      const d = tx.date.slice(0, 10)
      if (d < dateRange.from || d > dateRange.to) return false
      if (accountId !== 'all') {
        if (tx.accountId !== accountId && tx.toAccountId !== accountId) return false
      }
      return true
    }),
    [transactions, dateRange, accountId],
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

        <SelectField
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          options={[
            { value: 'all', label: 'Tüm Hesaplar' },
            ...accounts.map(a => ({ value: a.id, label: a.name })),
          ]}
          className="ml-auto w-fit bg-card text-xs"
        />
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
          />
        )}
      </div>
    </>
  )
}
