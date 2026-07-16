'use client'

import { useState, useMemo, useEffect } from 'react'
import { Header }          from '@/components/layout/Header'
import { PeriodTabs }      from '@/components/ui/PeriodTabs'
import { SelectField }     from '@/components/ui/Select'
import { TransactionList } from '@/components/transactions/TransactionList'
import { useTransactionStore, useUIStore, usePeopleStore, useCategoryStore, useRecurringStore } from '@/store'
import { getPeriodRangeAt, formatPeriodLabel, today } from '@/lib/utils/date'
import { projectPlannedTransactions } from '@/lib/utils/planned'
import { formatCurrency }  from '@/lib/utils/currency'
import { transactionsToCsvString, downloadCsv } from '@/lib/utils/csv'
import type { TransactionFilters, PersonRole, Transaction } from '@/types'

type PersonFilter = { id: string; name: string } | null

export default function TransactionsPage() {
  const transactions = useTransactionStore(s => s.transactions)
  const getFiltered  = useTransactionStore(s => s.getFiltered)
  const openModal    = useUIStore(s => s.openModal)
  const periodType   = useUIStore(s => s.periodType)
  const people       = usePeopleStore(s => s.people)
  const categories   = useCategoryStore(s => s.categories)

  const recurring = useRecurringStore(s => s.recurring)

  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [familyFilter, setFamilyFilter] = useState<PersonFilter>(null)
  const [recipientFilter, setRecipientFilter] = useState<PersonFilter>(null)
  const [showFuture, setShowFuture] = useState(true)
  const [periodOffset, setPeriodOffset] = useState(0)

  // Dönem türü değişince gezinti sıfırlanır
  useEffect(() => { setPeriodOffset(0) }, [periodType])

  const { from, to } = useMemo(
    () => getPeriodRangeAt(periodType, periodOffset),
    [periodType, periodOffset],
  )

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

  // Planlanan gelecek işlemler (tüm hesaplar) — aktif filtrelerden geçirilir,
  // böylece gerçek işlemlerle aynı arama/tür/kişi/dönem kısıtlarına uyarlar.
  const projectedTxs = useMemo(() => {
    if (!showFuture) return [] as Transaction[]
    return projectPlannedTransactions({
      recurring,
      periodType,
      periodEnd:   to,
      todayStr:    today(),
      existingIds: new Set(transactions.map(t => t.id)),
    }).filter(t => {
      if (from && t.date < from) return false
      if (to   && t.date > to)   return false
      if (typeFilter && t.type !== typeFilter) return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)    return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [showFuture, recurring, periodType, from, to, transactions, typeFilter, familyFilter, recipientFilter, search])

  const projectedIds = useMemo(() => new Set(projectedTxs.map(t => t.id)), [projectedTxs])
  const displayTxs   = useMemo(() => [...filtered, ...projectedTxs], [filtered, projectedTxs])

  // Tek geçişte gider, gelir ve transfer toplamı (eskiden render başına 4 tam tarama).
  const { totalExpense, totalIncome, totalTransfer } = useMemo(() => {
    let expense = 0, income = 0, transfer = 0
    for (const t of filtered) {
      if (t.type === 'expense') expense += t.amount
      else if (t.type === 'income') income += t.amount
      else if (t.type === 'transfer') transfer += t.amount
    }
    return { totalExpense: expense, totalIncome: income, totalTransfer: transfer }
  }, [filtered])

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

  function handleExportCsv() {
    const csv = transactionsToCsvString(filtered, categories)
    const date = new Date().toISOString().slice(0, 10)
    downloadCsv(csv, `islemler-${date}.csv`)
  }

  return (
    <>
      <Header title="İşlemler" action={{ label: 'Ekle', onClick: () => openModal('add-transaction') }} />

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

      {/* Filters */}
      <div className="flex items-center gap-2 px-6 py-4 bg-transparent border-b border-border flex-shrink-0">
        <input
          type="text"
          placeholder="İşlem ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-32 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
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
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          title="İşlemleri Dışa Aktar (CSV)"
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ↓ CSV
        </button>
      </div>

      {/* Active person filter chips */}
      {hasPersonFilter && (
        <div className="flex gap-2 px-6 py-2 bg-card border-b border-border flex-wrap flex-shrink-0">
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
        <div className="flex items-center gap-6 px-6 py-2.5 bg-card border-b border-border flex-shrink-0">
          <span className="text-3xl font-normal tabular-nums text-green-600">+{formatCurrency(totalIncome)}</span>
          <span className="text-3xl font-normal tabular-nums text-destructive">−{formatCurrency(totalExpense)}</span>
          <span className="text-3xl font-normal tabular-nums text-foreground/50">↔{formatCurrency(totalTransfer)}</span>
          <span className="ml-auto text-muted-foreground text-xs">{filtered.length} işlem</span>
        </div>
      )}

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList transactions={displayTxs} projectedIds={projectedIds} layout="table" onPersonClick={handlePersonClick} />
      </div>
    </>
  )
}
