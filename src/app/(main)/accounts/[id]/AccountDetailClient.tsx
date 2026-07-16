'use client'

import { useState, useMemo, useEffect } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { Header }             from '@/components/layout/Header'
import { PeriodTabs }         from '@/components/ui/PeriodTabs'
import { AccountAvatar }      from '@/components/accounts/AccountAvatar'
import { useAccountStore, useTransactionStore, useUIStore, usePeopleStore, useRecurringStore, useCategoryStore } from '@/store'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { useShallow }         from 'zustand/react/shallow'
import { formatCurrency }     from '@/lib/utils/currency'
import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { useCountUp }         from '@/lib/hooks/useCountUp'
import { getPeriodRangeAt, formatPeriodLabel, today } from '@/lib/utils/date'
import { projectPlannedTransactions } from '@/lib/utils/planned'
import { Badge }              from '@/components/ui/Badge'
import { Button }             from '@/components/ui/button'
import { SelectField }        from '@/components/ui/Select'
import { AccountFormModal }   from '@/components/accounts/AccountFormModal'
import { TransactionList, TX_SORT_OPTIONS, type TxSortOption } from '@/components/transactions/TransactionList'
import type { Account, PersonRole, Transaction } from '@/types'

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
  const categories    = useCategoryStore(s => s.categories)

  const accountTxs = useTransactionStore(useShallow(s =>
    s.transactions.filter(t => t.accountId === id || t.toAccountId === id)
  ))

  const router = useRouter()

  const [editingAccount, setEditingAccount] = useState<Account | undefined>()
  const [familyFilter, setFamilyFilter]     = useState<PersonFilter>(null)
  const [recipientFilter, setRecipientFilter] = useState<PersonFilter>(null)
  const [search, setSearch]                 = useState('')
  const [typeFilter, setTypeFilter]         = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showFuture, setShowFuture]         = useState(true)
  const [sortOption, setSortOption]         = useState<TxSortOption>('date-desc')
  const [periodOffset, setPeriodOffset]     = useState(0)

  const recurring = useRecurringStore(s => s.recurring)

  // Dönem türü değişince gezinti sıfırlanır (Aylık'ta Ağustos'a gidip Yıllık'a
  // geçmek 2027'de bırakmasın).
  useEffect(() => { setPeriodOffset(0) }, [periodType])

  const { from, to } = useMemo(
    () => getPeriodRangeAt(periodType, periodOffset),
    [periodType, periodOffset],
  )

  // Planlanan gelecek işlemler — bu hesaba dokunan şablonlardan (bkz. planned.ts)
  const projectedTxs = useMemo(() => {
    if (!showFuture) return [] as Transaction[]
    return projectPlannedTransactions({
      recurring,
      periodType,
      periodEnd:   to,
      todayStr:    today(),
      existingIds: new Set(accountTxs.map(t => t.id)),
      accountId:   id,
    })
  }, [showFuture, recurring, id, periodType, to, accountTxs])

  const projectedIds = useMemo(() => new Set(projectedTxs.map(t => t.id)), [projectedTxs])

  // Tüm alanlarda arama — kişi/kategori/hesap adları dahil (bkz. txSearch.ts)
  const searchMatcher = useMemo(
    () => makeTxSearchMatcher(search, { people, categories, accounts }),
    [search, people, categories, accounts],
  )

  // Transactions filtered by period + person + search + type + category (planlananlar dahil)
  const filteredTxs = useMemo(
    () => [...accountTxs, ...projectedTxs].filter(t => {
      if (from && t.date < from) return false
      if (to   && t.date > to)   return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)   return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      if (typeFilter && t.type !== typeFilter) return false
      if (categoryFilter && t.categoryId !== categoryFilter) return false
      if (search && !searchMatcher(t)) return false
      return true
    }),
    [accountTxs, projectedTxs, from, to, familyFilter, recipientFilter, typeFilter, categoryFilter, search, searchMatcher],
  )

  // Filtre alanı seçenekleri
  const categoryOptions = useMemo(() => [
    { value: '', label: 'Tüm Kategoriler' },
    ...[...categories].sort(compareCategoriesByName).map(c => ({ value: c.id, label: c.name })),
  ], [categories])

  const familyOptions = useMemo(() => [
    { value: '', label: 'Tüm Aile Üyeleri' },
    ...people.filter(p => p.role === 'family_member' && !p.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(p => ({ value: p.id, label: p.name })),
  ], [people])

  const recipientOptions = useMemo(() => [
    { value: '', label: 'Tüm Alıcılar' },
    ...people.filter(p => p.role === 'recipient' && !p.isArchived)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(p => ({ value: p.id, label: p.name })),
  ], [people])

  function selectPerson(setter: (f: PersonFilter) => void, pid: string) {
    const person = people.find(p => p.id === pid)
    setter(person ? { id: person.id, name: person.name } : null)
  }

  function handlePersonClick(role: PersonRole, pid: string) {
    const person = people.find(p => p.id === pid)
    if (!person) return
    if (role === 'family_member') {
      setFamilyFilter(f => f?.id === pid ? null : { id: pid, name: person.name })
    } else {
      setRecipientFilter(f => f?.id === pid ? null : { id: pid, name: person.name })
    }
  }

  // These must be called unconditionally before any early return (Rules of Hooks)
  const { income: periodIncome, expense: periodExpense } =
    account ? calcPeriodFlow(accountTxs, from, to) : { income: 0, expense: 0 }
  const available   = account?.type === 'credit_card' ? calcAvailableCredit(account) : null
  const animBalance = useCountUp(account ? Math.abs(account.balance) : 0)
  const animAvail   = useCountUp(available ?? 0)
  const animLimit   = useCountUp(account?.creditLimit ?? 0)
  const animIncome  = useCountUp(periodIncome)
  const animExpense = useCountUp(periodExpense)

  if (!accountsReady || !txsReady) return null
  if (!account) return notFound()

  const usedPct = account.creditLimit && available !== null
    ? ((account.creditLimit - available) / account.creditLimit) * 100
    : 0

  return (
    <>
      <Header
        title={account.name}
        action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction', { accountId: id }) }}
      />

      <PeriodTabs
        nav={{
          offset:   periodOffset,
          label:    formatPeriodLabel(periodType, periodOffset),
          onChange: setPeriodOffset,
        }}
        rightSlot={
          <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={showFuture}
              onChange={e => setShowFuture(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
            />
            <span className="text-xs font-medium text-muted-foreground">Gelecek işlemler</span>
          </label>
        }
      />

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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openModal('reconcile-balance', { id })}
            >
              Bakiyeyi Eşitle
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditingAccount(account)}
            >
              Düzenle
            </Button>
          </div>
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

      {/* Search + filters */}
      <div className="flex items-center flex-wrap gap-2 px-6 py-3 border-b border-border flex-shrink-0">
        <input
          type="text"
          placeholder="Ara: açıklama, alıcı, aile üyesi, kategori, not, etiket..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
        />
        <SelectField
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: '',         label: 'Tüm Türler' },
            { value: 'expense',  label: 'Gider' },
            { value: 'income',   label: 'Gelir' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          className="w-fit bg-card text-xs"
        />
        <SelectField
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          options={categoryOptions}
          className="w-fit bg-card text-xs"
        />
        <SelectField
          value={familyFilter?.id ?? ''}
          onChange={e => selectPerson(setFamilyFilter, e.target.value)}
          options={familyOptions}
          className="w-fit bg-card text-xs"
        />
        <SelectField
          value={recipientFilter?.id ?? ''}
          onChange={e => selectPerson(setRecipientFilter, e.target.value)}
          options={recipientOptions}
          className="w-fit bg-card text-xs"
        />
        <SelectField
          value={sortOption}
          onChange={e => setSortOption(e.target.value as TxSortOption)}
          options={TX_SORT_OPTIONS}
          className="w-fit bg-card text-xs"
        />
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

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={filteredTxs}
          projectedIds={projectedIds}
          layout="table"
          sort={sortOption}
          showAccount={false}
          primaryAccountId={id}
          emptyTitle="Bu dönemde işlem yok"
          emptyDescription="Farklı bir dönem seçin veya İşlem Ekle ile kayıt oluşturun."
          onPersonClick={handlePersonClick}
        />
      </div>

      {editingAccount && (
        <AccountFormModal
          key={editingAccount.id}
          open
          account={editingAccount}
          onClose={() => setEditingAccount(undefined)}
          onDeleted={() => router.push('/accounts')}
        />
      )}
    </>
  )
}
