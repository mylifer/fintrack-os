'use client'

import { useState, useMemo } from 'react'
import { Header }          from '@/components/layout/Header'
import { PeriodTabs }      from '@/components/ui/PeriodTabs'
import { TransactionList } from '@/components/transactions/TransactionList'
import { useTransactionStore, useUIStore, usePeopleStore } from '@/store'
import { getPeriodRange }  from '@/lib/utils/date'
import { formatCurrency }  from '@/lib/utils/currency'
import type { TransactionFilters, PersonRole } from '@/types'

type PersonFilter = { id: string; name: string } | null

export default function TransactionsPage() {
  const transactions = useTransactionStore(s => s.transactions)
  const getFiltered  = useTransactionStore(s => s.getFiltered)
  const openModal    = useUIStore(s => s.openModal)
  const periodType   = useUIStore(s => s.periodType)
  const people       = usePeopleStore(s => s.people)

  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [familyFilter, setFamilyFilter] = useState<PersonFilter>(null)
  const [recipientFilter, setRecipientFilter] = useState<PersonFilter>(null)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  const filters: TransactionFilters = {
    search:          search || undefined,
    types:           typeFilter ? [typeFilter as 'expense' | 'income' | 'transfer'] : undefined,
    dateFrom:        from,
    dateTo:          to,
    familyMemberIds: familyFilter    ? [familyFilter.id]    : undefined,
    recipientIds:    recipientFilter ? [recipientFilter.id] : undefined,
  }

  const filtered = useMemo(
    () => getFiltered(filters),
    [transactions, search, typeFilter, from, to, familyFilter, recipientFilter],
  )

  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const totalIncome  = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)

  function handlePersonClick(role: PersonRole, id: string) {
    const person = people.find(p => p.id === id)
    if (!person) return
    if (role === 'family_member') {
      setFamilyFilter(f => f?.id === id ? null : { id, name: person.name })
    } else {
      setRecipientFilter(f => f?.id === id ? null : { id, name: person.name })
    }
  }

  const hasPersonFilter = familyFilter || recipientFilter

  return (
    <>
      <Header title="İşlemler" action={{ label: 'Ekle', onClick: () => openModal('add-transaction') }} />

      <PeriodTabs />

      {/* Filters */}
      <div className="flex items-center gap-2 px-6 py-4 bg-transparent border-b border-line flex-shrink-0">
        <input
          type="text"
          placeholder="İşlem ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-32 text-sm bg-ground px-4 py-2 rounded-xl border border-transparent focus:border-line outline-none placeholder:text-muted/60 text-ink"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-xs border border-line bg-surface text-ink px-3 py-2 rounded-xl focus:outline-none focus:border-accent cursor-pointer"
        >
          <option value="">Tüm Türler</option>
          <option value="expense">Gider</option>
          <option value="income">Gelir</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>

      {/* Active person filter chips */}
      {hasPersonFilter && (
        <div className="flex gap-2 px-6 py-2 bg-surface border-b border-line flex-wrap flex-shrink-0">
          {familyFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full" style={{ background: 'rgba(125,211,252,0.12)', color: '#7DD3FC' }}>
              Aile: {familyFilter.name}
              <button onClick={() => setFamilyFilter(null)} className="ml-0.5 hover:opacity-70 font-bold leading-none">✕</button>
            </span>
          )}
          {recipientFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full" style={{ background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}>
              Alıcı: {recipientFilter.name}
              <button onClick={() => setRecipientFilter(null)} className="ml-0.5 hover:opacity-70 font-bold leading-none">✕</button>
            </span>
          )}
        </div>
      )}

      {/* Summary bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-6 px-6 py-2.5 bg-surface border-b border-line flex-shrink-0">
          <span className="text-2xl font-light tracking-tight tabular-nums text-ok">+{formatCurrency(totalIncome)}</span>
          <span className="text-2xl font-light tracking-tight tabular-nums text-danger">−{formatCurrency(totalExpense)}</span>
          <span className="ml-auto text-muted text-xs">{filtered.length} işlem</span>
        </div>
      )}

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList transactions={filtered} layout="table" onPersonClick={handlePersonClick} />
      </div>
    </>
  )
}
