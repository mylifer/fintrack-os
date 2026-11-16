'use client'

import { useRef, useMemo } from 'react'
import { useUIStore, useAccountStore, useCategoryStore, useTransactionStore, usePeopleStore, useDebtStore, useRecurringStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { DateStepperInput } from '@/components/ui/DateStepperInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'
import type { Transaction, CurrencyCode, RecurringTransaction, Category } from '@/types'
import { useShallow } from 'zustand/react/shallow'
import { X, Trash2 } from 'lucide-react'
import { DeleteConfirmDialog } from '@/components/transactions/TransactionList'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { suggestCategoryIcon } from '@/lib/category-icon-suggest'
import { TagInput } from '@/components/transactions/TagInput'
import { ReceiptField } from '@/components/transactions/ReceiptField'
import { TransactionHistoryPanel } from '@/components/transactions/TransactionHistoryPanel'
import { useTags } from '@/lib/hooks/useTags'
import { dedupeTags } from '@/lib/utils/tags'
import { isSubscriptionTag } from '@/lib/subscriptions/brands'
import { CategorySplitField } from '@/components/transactions/CategorySplitField'
import { distributeSplits } from '@/lib/utils/categorySplits'
import { TABS, buildSuggestions, rememberKeepOpen, type Suggestion, type TxForm } from '@/components/transactions/form/form-model'
import { Field, AppSelect, PersonField } from '@/components/transactions/form/fields'
import { DescriptionAutocomplete } from '@/components/transactions/form/DescriptionAutocomplete'
import { AmountHero } from '@/components/transactions/form/AmountHero'
import { TransferTargetField } from '@/components/transactions/form/TransferTargetField'
import { CategoryField } from '@/components/transactions/form/CategoryField'
import { IncomeModeToggle, CollectionField, InterestTaxSection, ReceivableSummary } from '@/components/transactions/form/IncomeFields'
import { RecurringNameField, RecurrenceScheduleFields } from '@/components/transactions/form/RecurrenceFields'
import { PaymentTypeSection } from '@/components/transactions/form/PaymentTypeSection'
import { SessionList } from '@/components/transactions/form/SessionList'
import { useTransactionFormState } from '@/components/transactions/form/useTransactionFormState'
import { useSelectOpenGuard } from '@/components/transactions/form/useSelectOpenGuard'
import { useCollectionAndInterest } from '@/components/transactions/form/useCollectionAndInterest'
import { useCrossWorkspaceTransfer } from '@/components/transactions/form/useCrossWorkspaceTransfer'
import { useSessionRows } from '@/components/transactions/form/useSessionRows'
import { useAutoCategory } from '@/components/transactions/form/useAutoCategory'
import { useCategorySplitActions } from '@/components/transactions/form/useCategorySplitActions'
import { usePaymentType } from '@/components/transactions/form/usePaymentType'
import { useTransactionSubmit } from '@/components/transactions/form/useTransactionSubmit'

// İşlem / tekrarlayan şablon formu. Bu dosya orkestratördür: durum, türetilmiş
// veriler ve kaydetme akışları form/ altındaki hook'larda; form bölümleri
// form/ altındaki bileşenlerde; saf model ve yardımcılar form/form-model.ts'te.

// ── Main modal ────────────────────────────────────────────────────────────────

export function TransactionFormModal() {
  const modal        = useUIStore(s => s.modal)
  const modalPayload = useUIStore(s => s.modalPayload)
  const closeModal   = useUIStore(s => s.closeModal)
  const accounts   = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories = useCategoryStore(s => s.categories)
  const addCategory = useCategoryStore(s => s.add)
  const transactions = useTransactionStore(s => s.transactions)
  const removeTx     = useTransactionStore(s => s.remove)
  const allPeople    = usePeopleStore(s => s.people)
  const activeDebts  = useDebtStore(useShallow(s => s.debts.filter(d => !d.isSettled && d.direction === 'owe')))
  // Alacaklar (bana borçlu olunanlar) — gelir sekmesindeki "Alacak" modu.
  // Kapanmış alacak listede yoktur; ama düzenlenen tahsilat onu kapatmış
  // olabilir, o yüzden düzenlenen satırın kendi alacağı her zaman listededir.
  const allDebts     = useDebtStore(s => s.debts)
  const recurring    = useRecurringStore(s => s.recurring)
  const tags         = useTags()

  const open = modal === 'add-transaction' || modal === 'edit-transaction'
    || modal === 'add-recurring' || modal === 'edit-recurring'
  const isRecurring = modal === 'add-recurring' || modal === 'edit-recurring'
  const isEdit = modal === 'edit-transaction' || modal === 'edit-recurring'

  const editingTx: Transaction | undefined = modal === 'edit-transaction' && modalPayload?.id
    ? (modalPayload.plannedTx ?? transactions.find(t => t.id === modalPayload.id))
    : undefined
  // Planlanan (henüz üretilmemiş) bir tekrarlayan oluşumu düzenliyoruz: kayıt
  // "update" değil "create"tir — SADECE bu oluşum, deterministik id'siyle
  // (recur:<şablonId>:<orijinal tarih>) gerçek bir işlem olarak doğar. Şablonun
  // nextDueDate'i kasıtlı olarak dokunulmaz: vadesi geldiğinde normal onay akışı
  // (approveRecurring) bu id zaten var diye tekrar üretmez, sadece imleci ilerletir.
  const isPlannedEdit = modal === 'edit-transaction' && !!modalPayload?.plannedTx
  const editingRec: RecurringTransaction | undefined = modal === 'edit-recurring' && modalPayload?.id
    ? recurring.find(r => r.id === modalPayload.id)
    : undefined

  // Taksitli bir işlem düzenleniyorsa grubun TÜM satırları (installIndex sırasıyla).
  // 'İlk giriş' görünümü bundan beslenir: toplam tutar, taksit sayısı ve her
  // taksitin tutarı. Grup yoksa boş — tekil işlem normal akıştan gider.
  const installGroup = useMemo(() =>
    editingTx?.isInstallment && editingTx.installGroupId
      ? transactions
          .filter(t => t.installGroupId === editingTx.installGroupId)
          .sort((a, b) => (a.installIndex ?? 0) - (b.installIndex ?? 0))
      : [],
    [editingTx, transactions])

  const {
    tab, setTab, form, setForm, rec, setRec, amountStr, setAmountStr, amountSign, setAmountSign,
    interestMode, setInterestMode, interestRateStr, setInterestRateStr, installments, setInstallments,
    manualAmounts, setManualAmounts, splits, setSplits, autoCategory, setAutoCategory,
    loading, setLoading, errors, setErrors, keepOpen, setKeepOpen, session, setSession,
    sessionEditId, setSessionEditId,
  } = useTransactionFormState({ isEdit, editingTx, editingRec, modalPayload, installGroup })

  const amountInputRef    = useRef<HTMLInputElement>(null)

  // Track Select open state to prevent dialog from closing while a dropdown is open.
  // Radix DismissableLayer defers dialog's onInteractOutside to the "click" event,
  // by which time the Select has already closed. Snapshot the state on pointerdown
  // (capture phase, before any bubbling handler fires) for reliable detection.
  const { selectWasOpenRef, onSelectOpen } = useSelectOpenGuard()

  // Autocomplete suggestions — en son kaydedilen/düzenlenen satır kazanır (bkz. buildSuggestions).
  const suggestions = useMemo<Suggestion[]>(() => buildSuggestions(transactions, tab, accounts), [transactions, tab, accounts])

  const filteredCategories = useMemo(() => categories.filter(c => c.scope === tab), [categories, tab])

  const {
    receivables, isCollection, canCollect, selectedReceivable, receivableRemaining,
    linkedTaxTx, isInterest, interestAccount, defaultTaxRate, taxRate, interestSplit,
  } = useCollectionAndInterest({
    tab, form, amountStr, isEdit, isRecurring, isPlannedEdit, sessionEditId, editingTx, splits,
    allDebts, transactions, categories, accounts, interestMode, interestRateStr,
  })
  const accountOptions     = useMemo(
    () => accounts.map(a => ({ value: a.id, label: a.name, icon: <AccountAvatar account={a} size="xs" /> })),
    [accounts],
  )

  // ── Çalışma alanları arası transfer ─────────────────────────────────────
  // Sadece YENİ (düzenlenmeyen, tekrarlamayan) transfer için — bkz.
  // useTransactionStore.addCrossWorkspaceTransfer. Karşı bacak sıradan bir
  // gider/gelir satırı olduğundan, mevcut bir bacağı düzenlerken bu blok hiç
  // görünmez (o zaman tab 'expense'/'income'dir, 'transfer' değil).
  const crossWorkspace = useCrossWorkspaceTransfer()
  const { crossWs, targetWorkspaceId, targetAccountId, crossWsDebt, targetDebtId } = crossWorkspace

  const patch = (p: Partial<TxForm>) => setForm(f => ({ ...f, ...p }))

  // ── Art arda ekleme (oturum) ───────────────────────────────────────────
  const { canKeepOpen, resetForNext, editSessionRow, removeSessionRow, showSession, sessionTotals } = useSessionRows({
    isEdit, isRecurring, crossWs, keepOpen, form, session, setSession, sessionEditId, setSessionEditId,
    setTab, setForm, setAutoCategory, setAmountStr, setAmountSign, setInstallments, setManualAmounts,
    setSplits, setErrors, amountInputRef,
  })

  // ── Otomatik kategori ve kategori bölme ────────────────────────────────
  const { autoPick, withAutoCategory, rerunRulesForAmount } = useAutoCategory({
    tab, amountStr, form, patch, categories, allPeople, transactions,
    isEdit, isRecurring, splits, autoCategory, setAutoCategory,
  })
  const { splitTotal, openSplit, closeSplit, addSplitRow, removeSplitRow, resetSplits } = useCategorySplitActions({
    amountStr, form, patch, splits, setSplits, errors, setErrors,
  })

  const createCategory = async (name: string) => {
    // Bu akışta ikon seçici yok — kategori işlem yazarken bir kutudan
    // oluşturuluyor. Simge ve renk ada göre otomatik seçilir, sonradan
    // Kategoriler ekranından değiştirilebilir.
    const scope = tab === 'income' ? 'income' : 'expense'
    const suggestion = suggestCategoryIcon(name, scope)
    const cat: Category = {
      id:        crypto.randomUUID(),
      name,
      icon:      suggestion.icon,
      color:     suggestion.color,
      scope,
      isSystem:  false,
      sortOrder: categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1,
    }
    await addCategory(cat)
    return cat.id
  }

  // ── Ödeme tipi (tek çekim / taksit / abonelik) ─────────────────────────
  const {
    canSubscription, convertibleTx, installmentLocked, payType, payTypeOptions, selectPayType, subBrand,
  } = usePaymentType({
    form, patch, tab, isEdit, isRecurring, editingTx, isPlannedEdit, sessionEditId, installGroup,
    setInstallments, setManualAmounts,
  })

  // ── Kaydetme ───────────────────────────────────────────────────────────
  const { handleSubmit } = useTransactionSubmit({
    closeModal, loading, setLoading, setErrors, tab, form, rec, amountStr, amountSign,
    installments, manualAmounts, splits, accounts, categories, editingTx, editingRec, isPlannedEdit,
    isRecurring, isCollection, selectedReceivable, receivableRemaining, isInterest, taxRate,
    interestSplit, linkedTaxTx, convertibleTx, crossWs, targetWorkspaceId, targetAccountId,
    crossWsDebt, targetDebtId, canKeepOpen, keepOpen, sessionEditId, setSession, setSessionEditId,
    resetForNext,
  })

  // Gelir sekmesinde "Gelir | Alacak" anahtarı — transferdeki "Hesap | Borç"
  // anahtarının karşılığı. Alacağa geçince kategori/bölme bırakılır; kayıtta
  // satır kategori taşımaz (bkz. collectionFields).
  const incomeModeToggle = canCollect ? (
    <IncomeModeToggle
      isCollection={isCollection}
      form={form}
      patch={patch}
      receivables={receivables}
      setSplits={setSplits}
      setAutoCategory={setAutoCategory}
      setErrors={setErrors}
    />
  ) : null

  return (
    <Dialog open={open} onOpenChange={v => !v && closeModal()}>
      <DialogContent
        className="sm:max-w-lg gap-0 p-0 overflow-hidden"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (selectWasOpenRef.current) { selectWasOpenRef.current = false; e.preventDefault() }
        }}
        onOpenAutoFocus={(e) => {
          if (!isRecurring) { e.preventDefault(); amountInputRef.current?.focus() }
        }}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle>
              {isRecurring
                ? (isEdit ? 'Tekrarlayan İşlemi Düzenle' : 'Tekrarlayan İşlem Ekle')
                : isPlannedEdit ? 'Planlanan İşlemi Düzenle'
                : (isEdit ? 'İşlemi Düzenle' : 'İşlem Ekle')}
            </DialogTitle>
            <button
              type="button"
              onClick={closeModal}
              aria-label="Kapat"
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key)
                  // Kategoriler tipe göre filtrelendiğinden paylar da geçersizleşir.
                  setSplits(null)
                  setAutoCategory(null)
                  // Ödeme tipi (taksit/abonelik) ve iade işareti yalnızca giderde
                  // anlamlı; gizli kalıp gelir/transferi taksitli ya da negatif
                  // kaydetmesin. Taksitli grup düzenlemesi kilitli, dokunulmaz.
                  const leavingExpense = key !== 'expense'
                  const resetInstallment = leavingExpense && !installGroup.length
                  if (resetInstallment) {
                    setInstallments(1)
                    setManualAmounts(null)
                  }
                  setAmountSign(!leavingExpense && isEdit && editingTx && editingTx.amount < 0 ? -1 : 1)
                  patch({
                    type: key, categoryId: '', toAccountId: undefined, isDebtPayment: false, debtId: undefined,
                    ...(resetInstallment ? { isInstallment: false } : {}),
                    ...(leavingExpense ? { tags: form.tags.filter(t => !isSubscriptionTag(t)) } : {}),
                  })
                }}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition-all",
                  tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        {/* ── Amount hero ────────────────────────────────────────────────── */}
        <AmountHero
          tab={tab}
          amountSign={amountSign}
          amountStr={amountStr}
          currency={(accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode}
          error={errors.amount}
          inputRef={amountInputRef}
          onAmountChange={raw => {
            rerunRulesForAmount(raw)
            setAmountStr(raw)
            setManualAmounts(null)
            // Elle girilen paylar aynen kalır, farkı otomatik pay yutar;
            // sabitler yeni tutara sığmıyorsa sondan serbest bırakılır.
            setSplits(s => s ? distributeSplits(s, parseCurrencyInput(raw)) : s)
            if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }))
          }}
        />

        {/* ── Form body ──────────────────────────────────────────────────── */}
        <div className={cn(
          "flex flex-col gap-4 px-6 py-5 overflow-y-auto",
          showSession ? "max-h-[36vh]" : "max-h-[55vh]",
        )}>

          {/* Name (recurring only) */}
          {isRecurring && (
            <RecurringNameField rec={rec} setRec={setRec} errors={errors} setErrors={setErrors} />
          )}

          {/* Description */}
          <Field label="Açıklama" error={errors.description} optional={isRecurring}>
            <DescriptionAutocomplete
              autoFocus={false}
              value={form.description}
              onChange={v => patch(withAutoCategory({ description: v }))}
              onSelect={s => {
                // Öneri geçmişten gelir: kategorisi varsa o kullanılır (otomatik
                // sayılmaz); yoksa kural/alıcı geçmişi denenir.
                const fallback = !s.categoryId && !splits ? autoPick(s.description, s.recipientId) : undefined
                setAutoCategory(fallback ?? null)
                patch({
                  description:    s.description,
                  categoryId:     s.categoryId || fallback || '',
                  familyMemberId: s.familyMemberId,
                  recipientId:    s.recipientId,
                  // Etiketler yalnızca öneride varsa gelir; kullanıcının elle
                  // girdikleri korunur (abonelik etiketi dahil)
                  ...(s.tags?.length ? { tags: dedupeTags([...form.tags, ...s.tags]) } : {}),
                  // Transferde alıcı hesabı son işlemden getir — kaynakla aynıysa
                  // veya borç ödeme modundaysa dokunma
                  ...(tab === 'transfer' && !form.isDebtPayment && s.toAccountId && s.toAccountId !== form.accountId
                    ? { toAccountId: s.toAccountId }
                    : {}),
                })
              }}
              suggestions={suggestions}
              categories={categories}
              people={allPeople}
              accounts={accounts}
              error={errors.description}
            />
          </Field>

          {/* Account + Category/Target */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hesap" error={errors.accountId}>
              <AppSelect
                value={form.accountId}
                onChange={v => patch({ accountId: v })}
                options={accountOptions}
                placeholder="Seçin..."
                error={!!errors.accountId}
                onOpenChange={onSelectOpen}
              />
            </Field>

            {tab === 'transfer' && isRecurring ? (
              // Recurring transfers always target an account — no debt payments.
              <Field label="Hedef Hesap" error={errors.toAccountId}>
                <AppSelect
                  value={form.toAccountId ?? ''}
                  onChange={v => patch({ toAccountId: v })}
                  options={accountOptions.filter(a => a.value !== form.accountId)}
                  placeholder="Seçin..."
                  error={!!errors.toAccountId}
                  onOpenChange={onSelectOpen}
                />
              </Field>
            ) : tab === 'transfer' ? (
              <TransferTargetField
                form={form}
                patch={patch}
                errors={errors}
                isEdit={isEdit}
                sessionEditId={sessionEditId}
                activeDebts={activeDebts}
                accountOptions={accountOptions}
                onSelectOpen={onSelectOpen}
                crossWorkspace={crossWorkspace}
              />
            ) : isCollection ? (
              <CollectionField
                form={form}
                patch={patch}
                errors={errors}
                setErrors={setErrors}
                receivables={receivables}
                incomeModeToggle={incomeModeToggle}
                onSelectOpen={onSelectOpen}
              />
            ) : (
              <CategoryField
                form={form}
                patch={patch}
                errors={errors}
                autoCategory={autoCategory}
                setAutoCategory={setAutoCategory}
                splits={splits}
                splitTotal={splitTotal}
                openSplit={openSplit}
                closeSplit={closeSplit}
                categories={categories}
                filteredCategories={filteredCategories}
                createCategory={createCategory}
                incomeModeToggle={incomeModeToggle}
              />
            )}
          </div>

          {/* Faiz stopajı — Brüt · Stopaj · Net. Kaydedince stopaj Vergi'ye
              ayrı gider olarak yazılır (alıcı İTC). */}
          {isInterest && interestSplit && (
            <InterestTaxSection
              errors={errors}
              setErrors={setErrors}
              interestMode={interestMode}
              setInterestMode={setInterestMode}
              interestRateStr={interestRateStr}
              setInterestRateStr={setInterestRateStr}
              interestSplit={interestSplit}
              interestAccount={interestAccount}
              defaultTaxRate={defaultTaxRate}
            />
          )}

          {/* Alacak tahsilatı özeti — kalan alacak bu kayıttan sonra ne olur */}
          {isCollection && selectedReceivable && (
            <ReceivableSummary
              accounts={accounts}
              form={form}
              amountStr={amountStr}
              receivableRemaining={receivableRemaining}
            />
          )}

          {/* Kategori bölme — oran barı (tam genişlik, ızgaranın hemen altında) */}
          {splits && tab !== 'transfer' && (
            <CategorySplitField
              splits={splits}
              onChange={setSplits}
              total={splitTotal}
              currency={(accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode}
              categories={filteredCategories}
              onCreateCategory={createCategory}
              onAdd={addSplitRow}
              onRemove={removeSplitRow}
              onReset={resetSplits}
              error={errors.categorySplits}
            />
          )}

          {/* Date / Recurrence */}
          {isRecurring ? (
            <RecurrenceScheduleFields rec={rec} setRec={setRec} errors={errors} onSelectOpen={onSelectOpen} />
          ) : (
            <Field label="Tarih" error={errors.date}>
              <DateStepperInput
                value={form.date}
                onValueChange={date => patch({ date })}
                error={errors.date}
              />
            </Field>
          )}

          {/* Ödeme tipi — abonelik + taksit tek segmentte, tarihin hemen
              altında. Eskiden gövdenin en altında iki ayrı kesikli kart
              olarak duruyor, çoğu ekranda kaydırmadan görünmüyorlardı. */}
          {canSubscription && (
            <PaymentTypeSection
              installmentLocked={installmentLocked}
              convertibleTx={convertibleTx}
              payType={payType}
              payTypeOptions={payTypeOptions}
              selectPayType={selectPayType}
              subBrand={subBrand}
              form={form}
              amountStr={amountStr}
              accounts={accounts}
              errors={errors}
              setErrors={setErrors}
              installments={installments}
              setInstallments={setInstallments}
              manualAmounts={manualAmounts}
              setManualAmounts={setManualAmounts}
            />
          )}

          {/* People */}
          {tab !== 'transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <PersonField
                key={`fam-${modal}-${modalPayload?.id ?? 'new'}`}
                role="family_member"
                value={form.familyMemberId}
                onChange={id => patch({ familyMemberId: id })}
              />
              <PersonField
                key={`rec-${modal}-${modalPayload?.id ?? 'new'}`}
                role="recipient"
                value={form.recipientId}
                onChange={id => patch(withAutoCategory({ recipientId: id }))}
              />
            </div>
          )}

          {/* Notes */}
          <Field label="Not" optional>
            <Input
              value={form.notes ?? ''}
              onChange={e => patch({ notes: e.target.value || undefined })}
              placeholder="Ek bilgi..."
            />
          </Field>

          {/* Fiş / fatura — yalnız KAYITLI işlemde (dosya yolu işlem kimliğine bağlı) */}
          {editingTx && !isPlannedEdit && !isRecurring && (
            <Field label="Fiş / fatura" optional>
              <ReceiptField tx={editingTx} />
            </Field>
          )}

          {/* Tags — not on the recurring model (needs a Supabase column first) */}
          {!isRecurring && (
            <Field label="Etiketler" optional>
              <TagInput
                value={form.tags}
                onChange={next => patch({ tags: next })}
                tags={tags}
              />
            </Field>
          )}

          {/* Değişiklik geçmişi — yalnız KAYITLI bir işlem düzenlenirken.
              Katlanabilir: açılmadan hiçbir şey okunmaz (talep üzerine). */}
          {editingTx && !isPlannedEdit && !isRecurring && (
            <TransactionHistoryPanel
              txId={editingTx.id}
              currency={editingTx.currency}
            />
          )}
        </div>

        {/* ── Oturum listesi (art arda ekleme) ───────────────────────────── */}
        {showSession && (
          <SessionList
            session={session}
            sessionTotals={sessionTotals}
            sessionEditId={sessionEditId}
            categories={categories}
            editSessionRow={editSessionRow}
            removeSessionRow={removeSessionRow}
          />
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          {canKeepOpen ? (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepOpen}
                onChange={e => { setKeepOpen(e.target.checked); rememberKeepOpen(e.target.checked) }}
                className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
              />
              <span className="text-sm text-muted-foreground">Art arda ekle</span>
            </label>
          ) : editingTx && !isPlannedEdit ? (
            // Kayıtlı bir işlemi düzenlerken (ör. aramadan açıldığında) silme
            // listeye dönmeden buradan yapılabilsin. Onay diyaloğu listedekiyle
            // aynı: taksit grubu / yatırım bağlantısı uyarıları dahil.
            <DeleteConfirmDialog
              tx={editingTx}
              onDelete={() => void removeTx(editingTx.id)}
              onSettled={closeModal}
              trigger={
                <Button variant="ghost" disabled={loading} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                  İşlemi sil
                </Button>
              }
            />
          ) : <span />}
          <div className="flex gap-2 sm:ml-auto">
            {sessionEditId ? (
              <Button
                variant="outline"
                onClick={() => { setSessionEditId(null); resetForNext(form.date) }}
                disabled={loading}
              >
                Vazgeç
              </Button>
            ) : (
              <Button variant="outline" onClick={closeModal} disabled={loading}>
                {showSession ? 'Bitir' : 'İptal'}
              </Button>
            )}
            <Button onClick={handleSubmit} loading={loading} disabled={loading}>
              {sessionEditId ? 'Satırı Güncelle'
                : isEdit && !isPlannedEdit ? 'Güncelle'
                : canKeepOpen && keepOpen ? 'Kaydet ve devam'
                : interestSplit && interestSplit.tax > 0 ? 'Faiz + Stopaj Kaydet'
                : 'Kaydet'}
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
