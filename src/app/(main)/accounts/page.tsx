'use client'

import { useState, useMemo } from 'react'
import { Header }        from '@/components/layout/Header'
import { PeriodTabs }    from '@/components/ui/PeriodTabs'
import { useAccountStore, useUIStore, useTransactionStore, useInvestmentStore, useDebtStore } from '@/store'
import { useShallow }    from 'zustand/react/shallow'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { calcNetWorth, calcDebtBurden } from '@/lib/utils/calculations'
import { getPeriodRange } from '@/lib/utils/date'
import { AccountFormModal } from '@/components/accounts/AccountFormModal'
import { EmptyState }    from '@/components/ui/EmptyState'
import { Button }        from '@/components/ui/button'
import { useCountUp }    from '@/lib/hooks/useCountUp'
import { enrichAccounts } from '@/components/accounts/views/shared'
import { GridView }     from '@/components/accounts/views/GridView'
import { OverviewView } from '@/components/accounts/views/OverviewView'
import type { Account }  from '@/types'

// ─── Alternatif görünümler (kullanıcı seçecek) ──────────────────────────────
const VIEWS = [
  { id: 'grid',     label: 'Izgara' },
  { id: 'overview', label: 'Genel Bakış' },
] as const

type ViewId = typeof VIEWS[number]['id']

export default function AccountsPage() {
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const transactions  = useTransactionStore(s => s.transactions)
  const periodType    = useUIStore(s => s.periodType)
  const investValue   = useInvestmentStore(s => s.getPortfolioValue())
  const prices        = useInvestmentStore(s => s.prices)
  const debts         = useDebtStore(useShallow(s => s.debts))

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  // "toplam net varlık" başlığı borçtan arındırılmıştır (dashboard'daki Net
  // Varlık kartıyla aynı değer olsun diye — bkz. calcDebtBurden).
  const debtBurden = calcDebtBurden(debts)
  const netWorth   = calcNetWorth(accounts, prices)
  const netTotal   = netWorth + investValue - debtBurden

  const animTotal = useCountUp(netTotal)
  const animInvest = useCountUp(investValue)
  const animBurden = useCountUp(debtBurden)

  const [view, setView] = useState<ViewId>('grid')
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
        <span className={`text-3xl font-normal tabular-nums ${netTotal >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCurrency(animTotal)}
        </span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">toplam net varlık</span>
        <span className="ml-auto flex items-baseline gap-3">
          {investValue > 0 && (
            <span className="text-xs text-muted-foreground">
              Yatırım: {formatCompact(animInvest)}
            </span>
          )}
          {debtBurden > 0 && (
            <span className="text-xs text-muted-foreground" title="Kalan borçlar net varlıktan düşüldü">
              Borç: −{formatCompact(animBurden)}
            </span>
          )}
        </span>
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

            {view === 'grid'     && <GridView     rows={rows} onEdit={openEdit} />}
            {view === 'overview' && <OverviewView rows={rows} onEdit={openEdit} />}
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
