'use client'

import { useState, useMemo } from 'react'
import { Header }        from '@/components/layout/Header'
import { PeriodTabs }    from '@/components/ui/PeriodTabs'
import { useAccountStore, useUIStore, useTransactionStore, useInvestmentStore } from '@/store'
import { useShallow }    from 'zustand/react/shallow'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { calcNetWorth } from '@/lib/utils/calculations'
import { getPeriodRange } from '@/lib/utils/date'
import { AccountFormModal } from '@/components/accounts/AccountFormModal'
import { EmptyState }    from '@/components/ui/EmptyState'
import { Button }        from '@/components/ui/button'
import { useCountUp }    from '@/lib/hooks/useCountUp'
import { enrichAccounts } from '@/components/accounts/views/shared'
import { TableView }   from '@/components/accounts/views/TableView'
import { BentoView }   from '@/components/accounts/views/BentoView'
import { ColumnsView } from '@/components/accounts/views/ColumnsView'
import { TrendView }   from '@/components/accounts/views/TrendView'
import type { Account }  from '@/types'

// ─── Alternatif görünümler (kullanıcı seçecek) ──────────────────────────────
const VIEWS = [
  { id: 'table',   label: 'Tablo' },
  { id: 'bento',   label: 'Bento' },
  { id: 'columns', label: 'Sütunlu' },
  { id: 'trend',   label: 'Trend' },
] as const

type ViewId = typeof VIEWS[number]['id']

export default function AccountsPage() {
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const transactions  = useTransactionStore(s => s.transactions)
  const periodType    = useUIStore(s => s.periodType)
  const investValue   = useInvestmentStore(s => s.getPortfolioValue())
  const prices        = useInvestmentStore(s => s.prices)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  const netWorth = calcNetWorth(accounts, prices)

  const animTotal = useCountUp(netWorth + investValue)
  const animInvest = useCountUp(investValue)

  const [view, setView] = useState<ViewId>('table')
  const [showForm, setShowForm]             = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | undefined>()

  const rows = useMemo(
    () => enrichAccounts(accounts, transactions, from, to),
    [accounts, transactions, from, to],
  )

  const openEdit = (account: Account) => { setEditingAccount(account); setShowForm(true) }

  return (
    <>
      <Header title="Hesaplar" action={{ label: 'Yeni Hesap', onClick: () => setShowForm(true) }} />

      <PeriodTabs />

      {/* Net worth summary */}
      <div className="px-6 lg:px-8 py-5 border-b border-border bg-card flex items-baseline gap-3 flex-shrink-0">
        <span className={`text-3xl font-normal tabular-nums ${(netWorth + investValue) >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCurrency(animTotal)}
        </span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">toplam net varlık</span>
        {investValue > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            Yatırım: {formatCompact(animInvest)}
          </span>
        )}
      </div>

      <div className="p-6 overflow-auto flex-1">
        {accounts.length === 0 ? (
          <EmptyState
            icon="▣"
            title="Henüz hesap yok"
            description="İlk hesabınızı ekleyerek başlayın."
            action={<Button size="sm" onClick={() => setShowForm(true)}>Hesap Ekle</Button>}
          />
        ) : (
          <>
            {/* Görünüm seçici (segmented control) */}
            <div className="flex items-center gap-1 mb-5 p-1 rounded-xl bg-secondary/60 w-fit">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`px-3 h-8 rounded-lg text-xs font-semibold transition-colors ${
                    view === v.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {view === 'table'   && <TableView   rows={rows} onEdit={openEdit} />}
            {view === 'bento'   && <BentoView   rows={rows} onEdit={openEdit} />}
            {view === 'columns' && <ColumnsView rows={rows} onEdit={openEdit} />}
            {view === 'trend'   && <TrendView   rows={rows} transactions={transactions} from={from} to={to} onEdit={openEdit} />}
          </>
        )}
      </div>

      {showForm && (
        <AccountFormModal
          key={editingAccount?.id ?? 'new'}
          open
          account={editingAccount}
          onClose={() => { setShowForm(false); setEditingAccount(undefined) }}
        />
      )}
    </>
  )
}
