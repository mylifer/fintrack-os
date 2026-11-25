'use client'

import { useState, useMemo } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { Header }             from '@/components/layout/Header'
import { PeriodTabs }         from '@/components/ui/PeriodTabs'
import { AccountHero }        from '@/components/accounts/AccountHero'
import { AccountInsights }    from '@/components/accounts/AccountInsights'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useAccountStore, useTransactionStore, useUIStore, usePeopleStore, useRecurringStore, useCategoryStore, useSettingsStore } from '@/store'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { useShallow }         from 'zustand/react/shallow'
import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { txHasCategory } from '@/lib/utils/categorySplits'
import { useCountUp }         from '@/lib/hooks/useCountUp'
import { getPeriodRangeAt, formatPeriodLabel, periodOffsetFor, today } from '@/lib/utils/date'
import { useTxFocusStore } from '@/lib/tx-focus'
import { projectPlannedTransactions } from '@/lib/utils/planned'
import { isFutureDate } from '@/components/transactions/views/shared'
import { SelectField }        from '@/components/ui/Select'
import { AccountFormModal }   from '@/components/accounts/AccountFormModal'
import { CardStatementPanel } from '@/components/accounts/CardStatementPanel'
import { DepositPanel } from '@/components/accounts/DepositPanel'
import { TX_SORT_OPTIONS, type TxSortOption } from '@/components/transactions/TransactionList'
import { TxViewsShell } from '@/components/transactions/views/TxViewsShell'
import { DEFAULT_TX_VIEW, type TxViewId } from '@/lib/tx-view'
import { BatchEditDrawer } from '@/components/transactions/BatchEditDrawer'
import { useTxSelection } from '@/lib/hooks/useTxSelection'
import { useWorkspaceSwitchFallback } from '@/lib/hooks/useWorkspaceSwitchFallback'
import type { Account, PersonRole, Transaction } from '@/types'

const TYPE_CHIPS = [
  { value: '',         label: 'Tümü' },
  { value: 'expense',  label: 'Gider' },
  { value: 'income',   label: 'Gelir' },
  { value: 'transfer', label: 'Transfer' },
]

type PersonFilter = { id: string; name: string } | null

export default function AccountDetailClient({
  id,
  initialView = DEFAULT_TX_VIEW,
}: {
  id: string
  /** Sunucuda çerezden okunan işlem listesi görünümü (bkz. lib/tx-view.ts). */
  initialView?: TxViewId
}) {
  const accounts      = useAccountStore(s => s.accounts)
  const accountsReady = useAccountStore(s => s.ready)
  const txsReady      = useTransactionStore(s => s.ready)
  const account       = accounts.find(a => a.id === id)
  const openModal     = useUIStore(s => s.openModal)
  const periodType    = useUIStore(s => s.periodType)
  const people        = usePeopleStore(s => s.people)
  const categories    = useCategoryStore(s => s.categories)
  // Kalıcı tercih (settings.store) — İşlemler sayfasıyla ortak, yenilemede korunur
  const showFuture    = useSettingsStore(s => s.showFutureTxs)
  const setShowFuture = useSettingsStore(s => s.setShowFutureTxs)

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
  const [sortOption, setSortOption]         = useState<TxSortOption>('date-desc')
  const [periodOffset, setPeriodOffset]     = useState(0)
  // Kategori/aile/alıcı/sıralama seçicileri varsayılan kapalı; seçili bir
  // süzgeç varken açılırsa düğmedeki sayı ne kadarının etkin olduğunu söyler.
  const [filtersOpen, setFiltersOpen]       = useState(false)

  const recurring = useRecurringStore(s => s.recurring)

  // Dönem türü değişince gezinti sıfırlanır (Aylık'ta Ağustos'a gidip Yıllık'a
  // geçmek 2027'de bırakmasın). Render sırasında ayarlanır — effect'te
  // sıfırlamak bir kare boyunca eski ofsetle yanlış dönemi çiziyordu.
  const [offsetFor, setOffsetFor] = useState(periodType)
  if (offsetFor !== periodType) {
    setOffsetFor(periodType)
    setPeriodOffset(0)
  }

  const { from, to } = useMemo(
    () => getPeriodRangeAt(periodType, periodOffset),
    [periodType, periodOffset],
  )

  // Bir satıra gidiliyorsa (bkz. lib/tx-focus) o satırın dönemini aç; kaydırma
  // ve vurgu listede yapılır.
  const focusTxId = useTxFocusStore(s => (s.accountId === id ? s.txId : null))
  const focusDate = useMemo(
    () => (focusTxId ? accountTxs.find(t => t.id === focusTxId)?.date.slice(0, 10) ?? null : null),
    [focusTxId, accountTxs],
  )
  // Render sırasında ayarlanır (yukarıdaki ofset sıfırlamasıyla aynı kalıp)
  const [focusSeen, setFocusSeen] = useState<string | null>(null)
  if (focusDate && focusDate !== focusSeen) {
    setFocusSeen(focusDate)
    if (focusDate < from || focusDate > to) setPeriodOffset(periodOffsetFor(periodType, focusDate))
  }

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
      // "Gelecek işlemler" kapalıyken SADECE planlananları elemek yetmez:
      // deftere kaydedilmiş gelecek tarihli işlemler (ileri tarihli fatura,
      // gelecek taksit) de gizlenmeli — kullanıcı kutuyu kaldırdığında listede
      // hiçbir gelecek satır kalmasın.
      if (!showFuture && isFutureDate(t.date)) return false
      if (from && t.date < from) return false
      if (to   && t.date > to)   return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)   return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      if (typeFilter && t.type !== typeFilter) return false
      // Bölünmüş işlem ikincil payının kategorisinde de listelenir
      if (categoryFilter && !txHasCategory(t, categoryFilter)) return false
      if (search && !searchMatcher(t)) return false
      return true
    }),
    [accountTxs, projectedTxs, showFuture, from, to, familyFilter, recipientFilter, typeFilter, categoryFilter, search, searchMatcher],
  )

  // Toplu düzenleme seçimi — filtre/dönem değişince temizlenir
  const sel = useTxSelection(`${from}|${to}|${search}|${typeFilter}|${categoryFilter}|${familyFilter?.id ?? ''}|${recipientFilter?.id ?? ''}|${showFuture}`)

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

  // collapseInstallments: dönem Gelir/Gider Raporlar ile aynı "satın alma ayına
  // toplu yaz" kuralıyla sayılır. calcAvailableCredit (aşağıda) HAM accountTxs
  // okumaya devam eder — kredi limiti taksitlerin gerçek posting tarihine göre
  // bloke olur.
  const reportAccountTxs = useMemo(() => collapseInstallments(accountTxs), [accountTxs])

  // These must be called unconditionally before any early return (Rules of Hooks)
  const { income: periodIncome, expense: periodExpense } =
    account ? calcPeriodFlow(reportAccountTxs, from, to) : { income: 0, expense: 0 }
  const available   = account?.type === 'credit_card' ? calcAvailableCredit(account, accountTxs) : null
  const animBalance = useCountUp(account ? Math.abs(account.balance) : 0)
  const animAvail   = useCountUp(available ?? 0)
  const animLimit   = useCountUp(account?.creditLimit ?? 0)
  const animIncome  = useCountUp(periodIncome)
  const animExpense = useCountUp(periodExpense)

  // Alan değişince bu hesap yeni alanda yoksa: aynı adlı hesaba, yoksa (tercihen
  // aynı türdeki) ilk aktif hesaba, o da yoksa Hesaplar'a geç — 404 yerine.
  const redirecting = useWorkspaceSwitchFallback(account, accountsReady, {
    candidates: accounts.filter(a => !a.isArchived),
    listHref:   '/accounts',
    hrefFor:    a => `/accounts/${a.id}`,
    prefer:     (c, prev) => c.type === prev.type,
    pickFirst:  true,
  })

  if (!accountsReady || !txsReady || redirecting) return null
  if (!account) return notFound()

  const moreFilterCount = [categoryFilter, familyFilter, recipientFilter, sortOption !== 'date-desc'].filter(Boolean).length

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

      {/* Üst bant, ekstre, süzgeçler ve liste sayfayla birlikte kayar (düzen
          min-h-screen; liste görünümleri kendi sabit yükseklikli kutusunda). */}
      <div className="flex-1">
      <AccountHero
        account={account}
        balance={animBalance}
        available={available === null ? null : animAvail}
        limit={animLimit}
        usedPct={usedPct}
        periodLabel={formatPeriodLabel(periodType, periodOffset)}
        income={animIncome}
        expense={animExpense}
        txCount={filteredTxs.length}
        onAddTx={() => openModal('add-transaction', { accountId: id })}
        onReconcile={() => openModal('reconcile-balance', { id })}
        onEdit={() => setEditingAccount(account)}
      />

      {account.type === 'credit_card' && <CardStatementPanel account={account} />}
      {account.type === 'savings' && <DepositPanel account={account} />}

      {/* Arama + tür düğmeleri; seyrek kullanılan süzgeçler "Filtreler" altında */}
      <div className="flex flex-col gap-3 px-6 lg:px-8 py-4 border-b border-border">
        <div className="flex items-center flex-wrap gap-2">
          <label className="flex flex-1 min-w-56 items-center gap-2.5 rounded-full bg-muted/60 px-4 h-10 focus-within:ring-2 focus-within:ring-ring/50">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              placeholder="Ara: açıklama, alıcı, aile üyesi, kategori, not, etiket..."
              aria-label="İşlem ara"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 text-foreground"
            />
          </label>
          <div role="group" aria-label="İşlem türü" className="flex flex-wrap gap-1.5">
            {TYPE_CHIPS.map(c => (
              <button
                key={c.value}
                type="button"
                aria-pressed={typeFilter === c.value}
                onClick={() => setTypeFilter(c.value)}
                className="h-9 rounded-full px-3.5 text-sm font-semibold transition-colors bg-muted/60 text-foreground hover:bg-muted aria-pressed:bg-foreground aria-pressed:text-background"
              >
                {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="account-more-filters"
            onClick={() => setFiltersOpen(o => !o)}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3.5 text-sm font-semibold hover:bg-muted"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filtreler
            {moreFilterCount > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{moreFilterCount}</span>
            )}
          </button>
        </div>
        {filtersOpen && (
          <div id="account-more-filters" className="flex items-center flex-wrap gap-2">
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
        )}
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

      {/* Transaction list — Tablo / Gün Kartı arasında geçilebilir. İkisi de AYNI
          listeyi alır: gerçekleşen + gelecek (planlanan) işlemler. */}
      {/* Geniş ekranda liste + sağ sütun (içgörüler); dar ekranda alt alta */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      <div className="min-w-0">
        <TxViewsShell
          initialView={initialView}
          transactions={filteredTxs}
          account={account}
          projectedIds={projectedIds}
          plannedTxs={projectedTxs}
          sort={sortOption}
          emptyTitle="Bu dönemde işlem yok"
          emptyDescription="Farklı bir dönem seçin veya İşlem Ekle ile kayıt oluşturun."
          onPersonClick={handlePersonClick}
          selectable
          selectedIds={sel.selectedIds}
          onToggleSelect={sel.toggle}
          onSelectMany={sel.selectMany}
        />
      </div>
      <AccountInsights account={account} accountTxs={accountTxs} from={from} to={to} />
      </div>
      </div>

      <BatchEditDrawer selectedIds={sel.list} onClose={sel.clear} />

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
