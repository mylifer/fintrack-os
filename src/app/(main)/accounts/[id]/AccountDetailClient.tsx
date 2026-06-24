'use client'

import { useState, useMemo } from 'react'
import { notFound }           from 'next/navigation'
import { Header }             from '@/components/layout/Header'
import { PeriodTabs }         from '@/components/ui/PeriodTabs'
import { AccountAvatar }      from '@/components/accounts/AccountAvatar'
import { useAccountStore, useTransactionStore, useUIStore, usePeopleStore } from '@/store'
import { useShallow }         from 'zustand/react/shallow'
import { formatCurrency }     from '@/lib/utils/currency'
import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { useCountUp }         from '@/lib/hooks/useCountUp'
import { getPeriodRange }     from '@/lib/utils/date'
import { Badge }              from '@/components/ui/Badge'
import { AccountFormModal }   from '@/components/accounts/AccountFormModal'
import { TransactionList }    from '@/components/transactions/TransactionList'
import type { Account, PersonRole } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi Kartı', investment: 'Yatırım', loan: 'Kredi',
}

type PersonFilter = { id: string; name: string } | null

export default function AccountDetailClient({ id }: { id: string }) {
  const accounts      = useAccountStore(s => s.accounts)
  const accountsReady = useAccountStore(s => s.ready)
  const txsReady      = useTransactionStore(s => s.ready)
  const account       = accounts.find(a => a.id === id)
  const openModal     = useUIStore(s => s.openModal)
  const periodType    = useUIStore(s => s.periodType)
  const people        = usePeopleStore(s => s.people)

  const accountTxs = useTransactionStore(useShallow(s =>
    s.transactions.filter(t => t.accountId === id || t.toAccountId === id)
  ))

  const [editingAccount, setEditingAccount] = useState<Account | undefined>()
  const [familyFilter, setFamilyFilter]     = useState<PersonFilter>(null)
  const [recipientFilter, setRecipientFilter] = useState<PersonFilter>(null)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  // Transactions filtered by period + active person filters
  const filteredTxs = useMemo(
    () => accountTxs.filter(t => {
      if (from && t.date < from) return false
      if (to   && t.date > to)   return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)   return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      return true
    }),
    [accountTxs, from, to, familyFilter, recipientFilter],
  )

  function handlePersonClick(role: PersonRole, pid: string) {
    const person = people.find(p => p.id === pid)
    if (!person) return
    if (role === 'family_member') {
      setFamilyFilter(f => f?.id === pid ? null : { id: pid, name: person.name })
    } else {
      setRecipientFilter(f => f?.id === pid ? null : { id: pid, name: person.name })
    }
  }

  if (!accountsReady || !txsReady) return null
  if (!account) return notFound()

  const { income: periodIncome, expense: periodExpense } = calcPeriodFlow(accountTxs, from, to)

  const available = account.type === 'credit_card' ? calcAvailableCredit(account) : null
  const usedPct   = account.creditLimit && available !== null
    ? ((account.creditLimit - available) / account.creditLimit) * 100
    : 0

  const animBalance  = useCountUp(Math.abs(account.balance))
  const animAvail    = useCountUp(available ?? 0)
  const animLimit    = useCountUp(account.creditLimit ?? 0)
  const animIncome   = useCountUp(periodIncome)
  const animExpense  = useCountUp(periodExpense)

  return (
    <>
      <Header
        title={account.name}
        action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction', { accountId: id }) }}
      />

      <PeriodTabs />

      {/* Account summary */}
      <div className="px-6 lg:px-8 py-5 border-b border-border bg-card flex-shrink-0">
        {/* Top row: avatar + type badge + edit */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <AccountAvatar account={account} size="lg" />
            <div className="flex flex-col gap-1.5">
              <div className="text-base font-semibold text-foreground">{account.name}</div>
              <Badge variant="default">{TYPE_LABELS[account.type]}</Badge>
            </div>
          </div>
          <button
            onClick={() => setEditingAccount(account)}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors mt-1"
          >✎</button>
        </div>

        {/* Balance */}
        <div className={`text-3xl font-normal tabular-nums mb-4 ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
          {account.balance < 0 ? '−' : ''}{formatCurrency(animBalance, account.currency)}
        </div>

        {/* Credit card utilisation bar */}
        {account.type === 'credit_card' && account.creditLimit && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Kullanılabilir: {formatCurrency(animAvail, account.currency)}</span>
              <span>Limit: {formatCurrency(animLimit, account.currency)}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usedPct > 80 ? 'bg-destructive' : usedPct > 60 ? 'bg-orange-500' : 'bg-green-600'}`}
                style={{ width: `${Math.min(usedPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Period stats */}
        <div className="flex gap-6 pt-4 border-t border-border">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gelir</div>
            <div className="text-sm font-medium tabular-nums text-green-600">+{formatCurrency(animIncome, account.currency)}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gider</div>
            <div className="text-sm font-medium tabular-nums text-destructive">−{formatCurrency(animExpense, account.currency)}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">İşlem</div>
            <div className="text-sm font-medium tabular-nums text-foreground">{filteredTxs.length}</div>
          </div>
        </div>
      </div>

      {/* Active person filter chips */}
      {(familyFilter || recipientFilter) && (
        <div className="flex gap-2 px-6 py-2 bg-card border-b border-border flex-wrap flex-shrink-0">
          {familyFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded" style={{ background: 'rgba(125,211,252,0.12)', color: '#7DD3FC' }}>
              Aile: {familyFilter.name}
              <button onClick={() => setFamilyFilter(null)} className="ml-0.5 hover:opacity-70 font-bold leading-none">✕</button>
            </span>
          )}
          {recipientFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded" style={{ background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}>
              Alıcı: {recipientFilter.name}
              <button onClick={() => setRecipientFilter(null)} className="ml-0.5 hover:opacity-70 font-bold leading-none">✕</button>
            </span>
          )}
        </div>
      )}

      {/* Transaction list filtered by selected period */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={filteredTxs}
          layout="table"
          showAccount={false}
          emptyTitle="Bu dönemde işlem yok"
          emptyDescription="Farklı bir dönem seçin veya İşlem Ekle ile kayıt oluşturun."
          onPersonClick={handlePersonClick}
        />
      </div>

      <AccountFormModal
        key={editingAccount?.id ?? 'none'}
        open={!!editingAccount}
        account={editingAccount}
        onClose={() => setEditingAccount(undefined)}
      />
    </>
  )
}
