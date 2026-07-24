'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Header }          from '@/components/layout/Header'
import { PeriodTabs }      from '@/components/ui/PeriodTabs'
import { SelectField }     from '@/components/ui/Select'
import { TransactionList, TX_SORT_OPTIONS, type TxSortOption } from '@/components/transactions/TransactionList'
import { BatchEditDrawer } from '@/components/transactions/BatchEditDrawer'
import { useTransactionStore, useUIStore, usePeopleStore, useCategoryStore, useRecurringStore, useAccountStore } from '@/store'
import { getPeriodRangeAt, formatPeriodLabel, today } from '@/lib/utils/date'
import { sumByType, isFlowTx } from '@/lib/utils/calculations'
import { projectPlannedTransactions } from '@/lib/utils/planned'
import { formatCurrency }  from '@/lib/utils/currency'
import { transactionsToCsvString, downloadCsv } from '@/lib/utils/csv'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { compareCategoriesByName } from '@/lib/utils/categories'
import type { TransactionFilters, PersonRole, Transaction } from '@/types'

type PersonFilter = { id: string; name: string } | null

export default function TransactionsPage() {
  const transactions = useTransactionStore(s => s.transactions)
  const getFiltered  = useTransactionStore(s => s.getFiltered)
  const openModal    = useUIStore(s => s.openModal)
  const periodType   = useUIStore(s => s.periodType)
  const people       = usePeopleStore(s => s.people)
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)

  const recurring = useRecurringStore(s => s.recurring)

  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [accountFilter, setAccountFilter]   = useState<string>('')
  const [familyFilter, setFamilyFilter] = useState<PersonFilter>(null)
  const [recipientFilter, setRecipientFilter] = useState<PersonFilter>(null)
  const [showFuture, setShowFuture] = useState(true)
  const [sortOption, setSortOption] = useState<TxSortOption>('date-desc')
  const [periodOffset, setPeriodOffset] = useState(0)

  // Toplu düzenleme seçim state'i (yalnızca bu sayfa; liste kontrollü seçim alır)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const selectMany = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (selected) next.add(id); else next.delete(id) }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds])

  // Dönem türü değişince gezinti sıfırlanır
  useEffect(() => { setPeriodOffset(0) }, [periodType])

  const { from, to } = useMemo(
    () => getPeriodRangeAt(periodType, periodOffset),
    [periodType, periodOffset],
  )

  const filters: TransactionFilters = {
    search:          search || undefined,
    types:           typeFilter ? [typeFilter as 'expense' | 'income' | 'transfer'] : undefined,
    categoryIds:     categoryFilter ? [categoryFilter] : undefined,
    accountIds:      accountFilter  ? [accountFilter]  : undefined,
    dateFrom:        from,
    dateTo:          to,
    familyMemberIds: familyFilter    ? [familyFilter.id]    : undefined,
    recipientIds:    recipientFilter ? [recipientFilter.id] : undefined,
  }

  // Filtre/dönem değişince seçim sıfırlanır — gizlenen satırları yanlışlıkla
  // toplu düzenlememek için (seçim yalnızca ekranda görünen işlemleri kapsar).
  useEffect(() => { setSelectedIds(new Set()) },
    [search, typeFilter, categoryFilter, accountFilter, familyFilter?.id, recipientFilter?.id, from, to])

  const filtered = useMemo(
    () => getFiltered(filters),
    // people/categories/accounts: arama artık ad eşleşmesi de yaptığı için bağımlı
    [transactions, search, typeFilter, categoryFilter, accountFilter, from, to, familyFilter, recipientFilter, people, categories, accounts],
  )

  const searchMatcher = useMemo(
    () => makeTxSearchMatcher(search, { people, categories, accounts }),
    [search, people, categories, accounts],
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
      if (categoryFilter && t.categoryId !== categoryFilter) return false
      if (accountFilter  && t.accountId  !== accountFilter)  return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)    return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      if (search && !searchMatcher(t)) return false
      return true
    })
  }, [showFuture, recurring, periodType, from, to, transactions, typeFilter, categoryFilter, accountFilter, familyFilter, recipientFilter, search, searchMatcher])

  const projectedIds = useMemo(() => new Set(projectedTxs.map(t => t.id)), [projectedTxs])
  const displayTxs   = useMemo(() => [...filtered, ...projectedTxs], [filtered, projectedTxs])

  // Özet çubuğu ₺ (baz PB) gösterir → TRY-normalize (baseAmount, S2/S3) + kuruş-exact
  // (S8) topla; ham `amount` USD'yi ₺ gibi sayardı. Kapsam Dashboard/Raporlar KPI
  // ile BİREBİR aynı olsun diye tek akış kuralı (isFlowTx) uygulanır: onay bekleyen/
  // gelecek tarihli (isPosted), mutabakat ghost'u ve yatırım anaparası (… Alımı/
  // Satışı) toplama girmez. Bu satırlar listede hâlâ görünür — özet "gerçek akışı"
  // yansıtır, ham liste toplamını değil (aynı ay her sayfada aynı gelir/gideri verir).
  const { expense: totalExpense, income: totalIncome, transfer: totalTransfer } = useMemo(
    () => sumByType(filtered.filter(t => isFlowTx(t))),
    [filtered],
  )
  // Özet çubuğundaki oran çubuğu yalnızca akışı (gelir vs gider) resmeder;
  // transfer akış değil (hesaplar arası taşıma) → çubuğa girmez, sadece sayıda durur.
  const flowTotal = totalIncome + totalExpense
  const incomePct = flowTotal > 0 ? (totalIncome / flowTotal) * 100 : 0

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

  // Filtre alanı seçenekleri
  const categoryOptions = useMemo(() => [
    { value: '', label: 'Tüm Kategoriler' },
    ...[...categories].sort(compareCategoriesByName).map(c => ({ value: c.id, label: c.name })),
  ], [categories])

  const accountOptions = useMemo(() => [
    { value: '', label: 'Tüm Hesaplar' },
    ...accounts.map(a => ({ value: a.id, label: a.name })),
  ], [accounts])

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
      <div className="flex items-center flex-wrap gap-2 px-6 py-4 bg-transparent border-b border-border flex-shrink-0">
        <input
          type="text"
          placeholder="Ara: açıklama, alıcı, aile üyesi, kategori, hesap, not, etiket..."
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
          value={accountFilter}
          onChange={e => setAccountFilter(e.target.value)}
          options={accountOptions}
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

      {/* Summary bar — defter satırı + gelir/gider oran çubuğu */}
      {filtered.length > 0 && (
        <div className="flex flex-col gap-2.5 px-6 py-3 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-6 text-sm">
            <span className="inline-flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Gelir</span>
              <span className="font-semibold tabular-nums text-green-600">+{formatCurrency(totalIncome)}</span>
            </span>
            <span className="inline-flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Gider</span>
              <span className="font-semibold tabular-nums text-destructive">−{formatCurrency(totalExpense)}</span>
            </span>
            <span className="inline-flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Transfer</span>
              <span className="font-semibold tabular-nums text-foreground/70">{formatCurrency(totalTransfer)}</span>
            </span>
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">{filtered.length} işlem</span>
          </div>
          <div
            className="flex h-[5px] rounded-full overflow-hidden bg-foreground/[0.07]"
            title={`Gelir %${Math.round(incomePct)} · Gider %${Math.round(100 - incomePct)}`}
          >
            <span className="block h-full bg-green-600" style={{ width: `${incomePct}%` }} />
            <span className="block h-full bg-destructive" style={{ width: `${flowTotal > 0 ? 100 - incomePct : 0}%` }} />
          </div>
        </div>
      )}

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={displayTxs}
          projectedIds={projectedIds}
          layout="table"
          sort={sortOption}
          onPersonClick={handlePersonClick}
          selectable
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelectMany={selectMany}
        />
      </div>

      {/* Toplu düzenleme paneli (Model B — yan panel); satır seçilince açılır */}
      <BatchEditDrawer selectedIds={selectedIdList} onClose={clearSelection} />
    </>
  )
}
