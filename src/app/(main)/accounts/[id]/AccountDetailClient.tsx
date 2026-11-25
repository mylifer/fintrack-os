'use client'

import { useState, useMemo } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { Header }             from '@/components/layout/Header'
import { PeriodTabs }         from '@/components/ui/PeriodTabs'
import { AccountHero }        from '@/components/accounts/AccountHero'
import { AccountFeedPanel, type FeedChip } from '@/components/accounts/indigo/AccountFeedPanel'
import { AccountSideCards, useInstallmentPlans, type WeekRange } from '@/components/accounts/indigo/AccountSideCards'
import { StatementsSheet, PlansSheet, AccountInfoSheet } from '@/components/accounts/indigo/AccountSheets'
import { indigoFont } from '@/components/accounts/indigo/font'
import { TxDetailSheet } from '@/components/transactions/views/TxDetailSheet'
import { useAccountStore, useTransactionStore, useUIStore, usePeopleStore, useRecurringStore, useCategoryStore, useSettingsStore } from '@/store'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { useShallow }         from 'zustand/react/shallow'
import { calcAvailableCredit, calcPeriodFlow } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { txHasCategory } from '@/lib/utils/categorySplits'
import { baseAmount } from '@/lib/utils/fx'
import { useCountUp }         from '@/lib/hooks/useCountUp'
import { getPeriodRangeAt, formatPeriodLabel, periodOffsetFor, today } from '@/lib/utils/date'
import { useTxFocusStore } from '@/lib/tx-focus'
import { projectPlannedTransactions } from '@/lib/utils/planned'
import { isFutureDate } from '@/components/transactions/views/shared'
import { SelectField }        from '@/components/ui/Select'
import { AccountFormModal }   from '@/components/accounts/AccountFormModal'
import { DepositPanel } from '@/components/accounts/DepositPanel'
import { TX_SORT_OPTIONS, type TxSortOption } from '@/components/transactions/TransactionList'
import { TxViewsShell } from '@/components/transactions/views/TxViewsShell'
import { DEFAULT_TX_VIEW, type TxViewId } from '@/lib/tx-view'
import { BatchEditDrawer } from '@/components/transactions/BatchEditDrawer'
import { useTxSelection } from '@/lib/hooks/useTxSelection'
import { useWorkspaceSwitchFallback } from '@/lib/hooks/useWorkspaceSwitchFallback'
import type { Account, PersonRole, Transaction } from '@/types'

/* Hesap detayı — "İndigo" kart ekranı. Üstte renkli bant (bakiye, limit, hızlı
   işlemler), altında iki kolon: solda İşlemler akışı, sağda özet kartları.
   Ekstreler, taksitler ve hesap bilgisi alt panellerde açılır. Veri hazırlığı
   (dönem, süzgeçler, planlanan işlemler, toplu seçim) bu sayfada kalır;
   paneller yalnızca sunar. */

type PersonFilter = { id: string; name: string } | null
type SheetState = 'statements' | 'plans' | 'info' | null

/** "Ödeme ve iadeler": hesaba para giren hareketler */
function isInflow(t: Transaction, accountId: string): boolean {
  return t.type === 'income' || (t.type === 'expense' && t.amount < 0) || (t.type === 'transfer' && t.toAccountId === accountId)
}

export default function AccountDetailClient({
  id,
  initialView = DEFAULT_TX_VIEW,
}: {
  id: string
  /** Sunucuda çerezden okunan işlem listesi görünümü — yalnız "Tablo" modunda kullanılır. */
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
  const [chip, setChip]                     = useState<FeedChip>('all')
  const [week, setWeek]                     = useState<WeekRange | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sortOption, setSortOption]         = useState<TxSortOption>('date-desc')
  const [periodOffset, setPeriodOffset]     = useState(0)
  const [sheet, setSheet]                   = useState<SheetState>(null)
  const [sheetTx, setSheetTx]               = useState<Transaction | null>(null)

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

  // Dönem değişince haftalık süzgeç düşer (başka döneme ait bir hafta kalmasın)
  const [weekFor, setWeekFor] = useState(`${from}|${to}`)
  if (weekFor !== `${from}|${to}`) {
    setWeekFor(`${from}|${to}`)
    setWeek(null)
  }

  // Bir satıra gidiliyorsa (bkz. lib/tx-focus) o satırın dönemini aç
  const focusTxId = useTxFocusStore(s => (s.accountId === id ? s.txId : null))
  const focusDate = useMemo(
    () => (focusTxId ? accountTxs.find(t => t.id === focusTxId)?.date.slice(0, 10) ?? null : null),
    [focusTxId, accountTxs],
  )
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

  // Dönem + kişi + arama + süzgeç düğmesi + hafta + kategori (planlananlar dahil)
  const filteredTxs = useMemo(
    () => [...accountTxs, ...projectedTxs].filter(t => {
      // "Gelecek işlemler" kapalıyken deftere kaydedilmiş gelecek tarihli
      // işlemler (ileri tarihli fatura, gelecek taksit) de gizlenir.
      if (!showFuture && isFutureDate(t.date)) return false
      const d = t.date.slice(0, 10)
      if (from && d < from) return false
      if (to   && d > to)   return false
      if (week && (d < week.from || d > week.to)) return false
      if (familyFilter    && t.familyMemberId !== familyFilter.id)   return false
      if (recipientFilter && t.recipientId    !== recipientFilter.id) return false
      if (chip === 'inst' && !(t.isInstallment || t.installGroupId)) return false
      if (chip === 'big'  && !(t.type === 'expense' && baseAmount(t) >= 2000)) return false
      if (chip === 'pay'  && !isInflow(t, id)) return false
      // Bölünmüş işlem ikincil payının kategorisinde de listelenir
      if (categoryFilter && !txHasCategory(t, categoryFilter)) return false
      if (search && !searchMatcher(t)) return false
      return true
    }),
    [accountTxs, projectedTxs, showFuture, from, to, week, familyFilter, recipientFilter, chip, id, categoryFilter, search, searchMatcher],
  )

  // Toplu düzenleme seçimi — süzgeç/dönem değişince temizlenir
  const sel = useTxSelection(`${from}|${to}|${search}|${chip}|${week?.from ?? ''}|${categoryFilter}|${familyFilter?.id ?? ''}|${recipientFilter?.id ?? ''}|${showFuture}`)

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
  // toplu yaz" kuralıyla sayılır. calcAvailableCredit HAM accountTxs okur —
  // kredi limiti taksitlerin gerçek posting tarihine göre bloke olur.
  const reportAccountTxs = useMemo(() => collapseInstallments(accountTxs), [accountTxs])
  const plans = useInstallmentPlans(id, accountTxs)

  // These must be called unconditionally before any early return (Rules of Hooks)
  const { income: periodIncome, expense: periodExpense } =
    account ? calcPeriodFlow(reportAccountTxs, from, to) : { income: 0, expense: 0 }
  const available   = account?.type === 'credit_card' ? calcAvailableCredit(account, accountTxs) : null
  const animBalance = useCountUp(account ? Math.abs(account.balance) : 0)
  const animAvail   = useCountUp(available ?? 0)
  const animLimit   = useCountUp(account?.creditLimit ?? 0)

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
  const periodLabel = formatPeriodLabel(periodType, periodOffset)

  return (
    <>
      <Header
        title={account.name}
        action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction', { accountId: id }) }}
      />

      <PeriodTabs
        nav={{
          offset:   periodOffset,
          label:    periodLabel,
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

      <div className={`indigo-page ${indigoFont.className} flex-1`}>
        <AccountHero
          account={account}
          balance={animBalance}
          available={available === null ? null : animAvail}
          limit={animLimit}
          usedPct={usedPct}
          onAddTx={() => openModal('add-transaction', { accountId: id })}
          onOpenStatements={() => setSheet('statements')}
          onOpenPlans={plans.length ? () => setSheet('plans') : undefined}
          onOpenCard={() => setSheet('info')}
        />

        <div className="px-4 sm:px-6 pt-7 pb-[72px]">
          <div className="mx-auto max-w-[1160px]">
            {account.type === 'savings' && (
              <div className="mb-6 overflow-hidden rounded-3xl border border-[var(--ip-line)]"><DepositPanel account={account} /></div>
            )}
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <AccountFeedPanel
                account={account}
                transactions={filteredTxs}
                projectedIds={projectedIds}
                sort={sortOption}
                search={search}
                onSearch={setSearch}
                chip={chip}
                onChip={setChip}
                weekLabel={week?.label ?? null}
                onClearWeek={() => setWeek(null)}
                filterCount={moreFilterCount}
                filtersSlot={
                  <>
                    <SelectField value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={categoryOptions} className="w-fit bg-card text-xs" />
                    <SelectField value={familyFilter?.id ?? ''} onChange={e => selectPerson(setFamilyFilter, e.target.value)} options={familyOptions} className="w-fit bg-card text-xs" />
                    <SelectField value={recipientFilter?.id ?? ''} onChange={e => selectPerson(setRecipientFilter, e.target.value)} options={recipientOptions} className="w-fit bg-card text-xs" />
                    <SelectField value={sortOption} onChange={e => setSortOption(e.target.value as TxSortOption)} options={TX_SORT_OPTIONS} className="w-fit bg-card text-xs" />
                  </>
                }
                tableSlot={
                  <TxViewsShell
                    initialView={initialView === 'feed' ? 'table' : initialView}
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
                }
                selectedIds={sel.selectedIds}
                onToggleSelect={sel.toggle}
                onSelectMany={sel.selectMany}
              />
              <AccountSideCards
                account={account}
                accountTxs={accountTxs}
                from={from}
                to={to}
                periodLabel={periodLabel}
                income={periodIncome}
                expense={periodExpense}
                week={week}
                onWeek={setWeek}
                plans={plans}
                onOpenTx={setSheetTx}
                onOpenPlans={() => setSheet('plans')}
              />
            </div>
          </div>
        </div>
      </div>

      {sheet === 'statements' && account.type === 'credit_card' && (
        <StatementsSheet account={account} onClose={() => setSheet(null)} />
      )}
      {sheet === 'plans' && (
        <PlansSheet account={account} plans={plans} onClose={() => setSheet(null)}
          onOpenTx={t => { setSheet(null); setSheetTx(t) }} />
      )}
      {sheet === 'info' && (
        <AccountInfoSheet
          account={account}
          available={available}
          onClose={() => setSheet(null)}
          onEdit={() => setEditingAccount(account)}
          onReconcile={() => openModal('reconcile-balance', { id })}
        />
      )}
      {sheetTx && (
        <TxDetailSheet tx={sheetTx} account={account} projected={projectedIds.has(sheetTx.id)} onClose={() => setSheetTx(null)} />
      )}

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
