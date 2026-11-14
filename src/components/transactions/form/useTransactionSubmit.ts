import { useAccountStore, useTransactionStore, usePeopleStore, useDebtStore, useRecurringStore } from '@/store'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { splitInstallments } from '@/lib/utils/money'
import { toBaseTry, baseAmount } from '@/lib/utils/fx'
import { DEBT_COLLECTION_ICON, isDebtCollectionTx } from '@/lib/utils/calculations'
import { INTEREST_TAX_SUFFIX, interestTaxId, type splitInterest } from '@/lib/utils/interest-tax'
import { foldText } from '@/lib/auto-category'
import { dedupeTags } from '@/lib/utils/tags'
import { primarySplitCategoryId, type DraftSplit } from '@/lib/utils/categorySplits'
import type { Transaction, TransactionType, CurrencyCode, RecurringTransaction, Category, CategorySplit, Account, Debt } from '@/types'
import {
  rememberAddedDate, toAmountStr, validateTransactionForm,
  type Tab, type TxForm, type RecForm, type SessionRow,
} from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

// Kaydetme akışları: tekrarlayan şablon, çalışma alanları arası transfer ve
// normal (tekil / taksitli / düzenleme / planlanan / art arda oturum) yol.
export function useTransactionSubmit({
  closeModal, loading, setLoading, setErrors, tab, form, rec, amountStr, amountSign,
  installments, manualAmounts, splits, accounts, categories, editingTx, editingRec, isPlannedEdit,
  isRecurring, isCollection, selectedReceivable, receivableRemaining, isInterest, taxRate,
  interestSplit, linkedTaxTx, convertibleTx, crossWs, targetWorkspaceId, targetAccountId,
  crossWsDebt, targetDebtId, canKeepOpen, keepOpen, sessionEditId, setSession, setSessionEditId,
  resetForNext,
}: {
  closeModal: () => void
  loading: boolean
  tab: Tab
  form: TxForm
  rec: RecForm
  amountStr: string
  amountSign: number
  installments: number
  manualAmounts: string[] | null
  splits: DraftSplit[] | null
  accounts: Account[]
  categories: Category[]
  editingTx: Transaction | undefined
  editingRec: RecurringTransaction | undefined
  isPlannedEdit: boolean
  isRecurring: boolean
  isCollection: boolean
  selectedReceivable: Debt | undefined
  receivableRemaining: number
  isInterest: boolean
  taxRate: number
  interestSplit: ReturnType<typeof splitInterest> | null
  linkedTaxTx: Transaction | undefined
  convertibleTx: boolean
  crossWs: boolean
  targetWorkspaceId: string
  targetAccountId: string
  crossWsDebt: boolean
  targetDebtId: string
  canKeepOpen: boolean
  keepOpen: boolean
  sessionEditId: string | null
  resetForNext: (keepDate: string) => void
} & Pick<TransactionFormState, 'setLoading' | 'setErrors' | 'setSession' | 'setSessionEditId'>) {
  const addTx        = useTransactionStore(s => s.add)
  const addGroup     = useTransactionStore(s => s.addInstallmentGroup)
  const updateGroup  = useTransactionStore(s => s.updateInstallmentGroup)
  const convertGroup = useTransactionStore(s => s.convertToInstallmentGroup)
  const updateTx     = useTransactionStore(s => s.update)
  const addRec       = useRecurringStore(s => s.add)
  const updateRec    = useRecurringStore(s => s.update)

  function validate(): boolean {
    const e = validateTransactionForm({
      amountStr, form, tab, isCollection, splits, isInterest, taxRate, selectedReceivable,
      receivableRemaining, accounts, isRecurring, rec, manualAmounts,
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // Recurring templates save through the recurring store — none of the debt /
  // installment / tag machinery below applies to them.
  async function handleRecurringSubmit() {
    if (loading || !validate()) return
    setLoading(true)
    try {
      const amount   = parseCurrencyInput(amountStr)
      const account  = useAccountStore.getState().accounts.find(a => a.id === form.accountId)
      const currency = (account?.currency ?? editingRec?.currency ?? 'TRY') as CurrencyCode
      const name     = rec.name.trim()
      const shared = {
        name,
        type:        tab as TransactionType,
        amount,
        currency,
        accountId:   form.accountId,
        toAccountId: tab === 'transfer' ? form.toAccountId : undefined,
        categoryId:  tab !== 'transfer' ? (form.categoryId || undefined) : undefined,
        description: form.description.trim() || name,
        notes:       form.notes || undefined,
        familyMemberId: tab !== 'transfer' ? (form.familyMemberId ?? undefined) : undefined,
        recipientId:    tab !== 'transfer' ? (form.recipientId    ?? undefined) : undefined,
        frequency:   rec.frequency,
        // Bilgi amaçlı: takvim başlangıç tarihinin gününden yürür (recurrence.ts).
        dayOfMonth:  rec.frequency === 'monthly' || rec.frequency === 'yearly'
          ? Number(rec.startDate.slice(8, 10))
          : undefined,
        startDate:   rec.startDate,
        endDate:     rec.endDate || undefined,
      }
      if (editingRec) {
        await updateRec(editingRec.id, {
          ...shared,
          // Başlangıç tarihi değiştiyse bir sonraki üretim o tarihten başlasın
          ...(rec.startDate !== editingRec.startDate ? { nextDueDate: rec.startDate } : {}),
        })
      } else {
        await addRec({
          ...shared,
          id:          crypto.randomUUID(),
          nextDueDate: rec.startDate,
          isActive:    true,
          createdAt:   new Date().toISOString(),
        })
      }
      closeModal()
    } catch (err) {
      console.error('[recurring:submit]', err)
      setErrors({ name: 'Kaydetme başarısız oldu, tekrar deneyin' })
    } finally {
      setLoading(false)
    }
  }

  // Çalışma alanları arası transfer: normal dal zincirinden (taksit/tekrarlayan/
  // düzenleme) TAMAMEN ayrık — iki bağımsız satır atomik olarak store'da üretilir.
  async function handleCrossWorkspaceSubmit() {
    if (loading) return
    const amount = parseCurrencyInput(amountStr)
    const e: Record<string, string> = {}
    if (!amount || amount <= 0)   e.amount            = 'Geçerli bir tutar girin'
    if (!form.accountId)          e.accountId         = 'Hesap seçin'
    if (!targetWorkspaceId)       e.targetWorkspaceId = 'Çalışma alanı seçin'
    if (crossWsDebt && !targetDebtId) e.debtId        = 'Borç seçin'
    if (!targetAccountId)         e.toAccountId       = crossWsDebt ? 'Ödemenin geçeceği hesabı seçin' : 'Hedef hesap seçin'
    if (!form.date)               e.date              = 'Tarih seçin'
    if (!form.description.trim()) e.description       = 'Açıklama girin'
    setErrors(e)
    if (Object.keys(e).length > 0) return

    setLoading(true)
    try {
      await useTransactionStore.getState().addCrossWorkspaceTransfer({
        sourceAccountId:   form.accountId,
        targetWorkspaceId,
        targetAccountId,
        amount,
        date:        form.date,
        description: form.description.trim(),
        notes:       form.notes || undefined,
        targetDebtId: crossWsDebt ? targetDebtId : undefined,
      })
      rememberAddedDate(form.date)
      closeModal()
    } catch (err) {
      console.error('[transaction:cross-workspace-transfer]', err)
      setErrors({ description: 'Kaydetme başarısız oldu, tekrar deneyin' })
    } finally {
      setLoading(false)
    }
  }

  // Stopaj gideri: sistemdeki "Vergi" gider kategorisi (yoksa adında vergi
  // geçen ilk gider kategorisi) ve "İTC" alıcısı (yoksa oluşturulur).
  function taxCategoryId(): string | undefined {
    const live = categories.filter(c => c.scope === 'expense' && !c.isArchived)
    return (live.find(c => c.isSystem && c.name === 'Vergi')
      ?? live.find(c => foldText(c.name).includes('vergi')))?.id
  }
  async function taxRecipientId(): Promise<string> {
    const people = usePeopleStore.getState()
    const found = people.people.find(p => p.role === 'recipient' && foldText(p.name) === foldText('İTC'))
    return found ? found.id : (await people.add('İTC', 'recipient')).id
  }

  async function handleSubmit() {
    if (crossWs) return handleCrossWorkspaceSubmit()
    if (isRecurring) return handleRecurringSubmit()
    if (loading || !validate()) return
    setLoading(true)
    try {
    // Re-apply the preserved sign so editing a refund keeps its negative amount.
    const amount   = parseCurrencyInput(amountStr) * amountSign
    // Arşivlenmiş hesap `accounts` listesinde yok — tam store'dan ara ki
    // arşivli hesaptaki bir işlemi düzenlemek para birimini TRY'ye çevirmesin
    const account  = useAccountStore.getState().accounts.find(a => a.id === form.accountId)
    const currency = (account?.currency ?? editingTx?.currency ?? 'TRY') as CurrencyCode
    // Debts are TRY-denominated → all debt paidAmount math uses the base value,
    // never the raw account-currency amount (M4).
    const amountTry = toBaseTry(amount, currency)
    const now      = new Date().toISOString()
    const cleanTags = dedupeTags(form.tags)

    // Strip UI-only fields before building the stored transaction
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isDebtPayment: _idp, ...formData } = form

    // Çoklu kategori: paylar işlemin işaretini alır (iade = negatif gider) ve
    // `categoryId` en büyük payla damgalanır — store aynı değişmezi tekrar
    // uygular, burada yazmak yalnızca yerel durumu da doğru tutar.
    // Bölme kapalıysa alan AÇIKÇA undefined gönderilir: düzenlemede eski
    // payların silinmesi buna bağlı (patch'te anahtarın VARLIĞI temizler).
    const txSplits: CategorySplit[] | undefined = splits
      ? splits.map(s => ({ categoryId: s.categoryId, amount: s.amount * amountSign }))
      : undefined
    const splitCategoryId = primarySplitCategoryId(txSplits)

    // Alacak tahsilatı: kategori ve pay taşımaz, DEBT_COLLECTION_ICON ile
    // işaretlenir (dağılım grafikleri `!t.icon` ile süzer). Tahsilat normal
    // gelire çevrilirse işaret temizlenir; diğer satırların ikonuna dokunulmaz
    // (yatırım/transfer satırları ikonu kendi işareti olarak taşır).
    const collecting = tab === 'income' && form.isDebtPayment && !!formData.debtId
    const collectionFields: Partial<Transaction> = collecting
      ? { categoryId: undefined, categorySplits: undefined, icon: DEBT_COLLECTION_ICON }
      : editingTx && isDebtCollectionTx(editingTx) ? { icon: undefined } : {}

    // Faiz stopajı: gelir satırı BRÜT faizle yazılır, stopaj ayrı gider olur.
    // Net girildiyse brüt, stopajı kesilince tam bu neti verecek tutardır.
    const savedAmount = interestSplit ? interestSplit.gross : amount
    const taxAmount   = interestSplit?.tax ?? 0
    const taxDescription = `${form.description.trim()} ${INTEREST_TAX_SUFFIX}`

    if (editingTx && editingTx.isInstallment && editingTx.installGroupId && installments > 1) {
      // Taksitli grup düzenleme: 'ilk giriş' gibi toplam/sayı/taksitler tüm gruba
      // uygulanır. Taksit tutarları pozitif harcamadır → büyüklük kullanılır.
      const total   = parseCurrencyInput(amountStr)
      const rows    = manualAmounts ?? splitInstallments(total, installments).map(toAmountStr)
      const amounts = rows.map(s => parseCurrencyInput(s))
      await updateGroup(editingTx.installGroupId, {
        type:           tab as TransactionType,
        currency,
        accountId:      form.accountId,
        // Paylar toplam tutara göre girilir; store her taksite ölçekler.
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        description:    form.description.trim(),
        notes:          formData.notes || undefined,
        tags:           cleanTags.length ? cleanTags : undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId ?? null,
        date:           form.date,
      }, amounts)
    } else if (editingTx && convertibleTx && form.isInstallment && installments > 1) {
      // Sonradan taksitlendirme: girilen tutar TOPLAM satın almadır, satırın
      // kendisi 1. taksit olur, kalan taksitler yeni satır olarak doğar.
      const total   = parseCurrencyInput(amountStr)
      const rows    = manualAmounts ?? splitInstallments(total, installments).map(toAmountStr)
      const amounts = rows.map(s => parseCurrencyInput(s))
      await convertGroup(editingTx.id, {
        type:           tab as TransactionType,
        currency,
        accountId:      form.accountId,
        // Paylar toplam tutara göre girilir; store her taksite ölçekler.
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        description:    form.description.trim(),
        notes:          formData.notes || undefined,
        tags:           cleanTags.length ? cleanTags : undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId ?? null,
        date:           form.date,
      }, amounts)
    } else if (editingTx && isPlannedEdit) {
      // Materialize: recurring approval'la aynı felsefe — bu düzenleme onay
      // anıdır, satır 'approved' doğar (approveRecurring ile tutarlı).
      await addTx({
        ...formData, id: editingTx.id, type: tab as TransactionType, amount, currency,
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId:    formData.toAccountId    || undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId    ?? null,
        tags:           cleanTags.length ? cleanTags : undefined,
        isInstallment:  false,
        approvalStatus: 'approved',
        approvedAt:     now,
        createdAt:      now,
        updatedAt:      now,
        ...collectionFields,
      })
      if ((tab === 'transfer' || tab === 'income') && form.isDebtPayment && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amountTry)
      }
    } else if (editingTx) {
      await updateTx(editingTx.id, {
        ...formData, type: tab as TransactionType, amount: savedAmount, currency, updatedAt: now,
        // Taksit bayrağı bu dalda DEĞİŞMEZ: gruba dönüşüm yukarıdaki dalda
        // olur, burada `isInstallment: true` yazmak grupsuz sahte taksit üretir.
        isInstallment:  editingTx.isInstallment,
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId:    formData.toAccountId    || undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId    ?? null,
        tags:           cleanTags.length ? cleanTags : undefined,
        ...collectionFields,
      })

      // Reconcile debt paidAmount for edit.
      // adjustPaidAmount: taksit sayısını değiştirmez (tutar düzeltmesi / geri alma);
      // recordPayment: yeni bir ödeme kaydeder (taksit sayısını da artırır).
      // Narrowed locals let TS follow the debt-id flow without non-null assertions.
      const editDebtId = editingTx.debtId
      const formDebtId = formData.debtId
      // Borca ödeme (transfer) ve alacak tahsilatı (gelir) aynı mutabakattan geçer.
      const wasDebtPayment = (editingTx.type === 'transfer' && !!editDebtId && !editingTx.toAccountId)
        || isDebtCollectionTx(editingTx)
      const isDebtPaymentNow = (tab === 'transfer' || tab === 'income') && form.isDebtPayment && !!formDebtId
      const { recordPayment, revertPayment, adjustPaidAmount } = useDebtStore.getState()
      // Önceki ödemenin TL değeri — silme yoluyla (transactions.store remove) AYNI
      // kural. `amountTry ?? amount` snapshot'sız yabancı para ödemesinde ham
      // tutarı TL sayıyor, düzenleme ile silme paidAmount'u farklı oynatıyordu.
      const oldPaidTry = baseAmount(editingTx)

      if (wasDebtPayment && editDebtId && isDebtPaymentNow && formDebtId) {
        if (editDebtId === formDebtId) {
          // Same payment, amount edited → adjust value only, keep installment count.
          const delta = Math.round((amountTry - oldPaidTry) * 100) / 100
          if (delta !== 0) await adjustPaidAmount(formDebtId, delta)
        } else {
          // Debt changed: fully reverse old payment, record a new one on the new debt.
          await revertPayment(editDebtId, oldPaidTry)
          await recordPayment(formDebtId, amountTry)
        }
      } else if (wasDebtPayment && editDebtId && !isDebtPaymentNow) {
        await revertPayment(editDebtId, oldPaidTry)
      } else if (!wasDebtPayment && isDebtPaymentNow && formDebtId) {
        await recordPayment(formDebtId, amountTry)
      }

      // Bağlı stopaj satırı faizle birlikte güncellenir; faiz artık faiz
      // değilse (kategori/tip değişti) ya da stopaj 0'a indiyse silinir.
      if (linkedTaxTx) {
        if (interestSplit && taxAmount > 0) {
          await updateTx(linkedTaxTx.id, {
            amount: taxAmount, currency, accountId: form.accountId, date: form.date,
            description: taxDescription, updatedAt: now,
          })
        } else {
          await useTransactionStore.getState().remove(linkedTaxTx.id, { undoable: false })
        }
      }
    } else if (sessionEditId) {
      // Art arda oturumundaki bir satırın düzeltilmesi. Bu satırlar tanımı
      // gereği sıradan (taksitsiz, borçsuz) olduğundan borç mutabakatı yok —
      // düzenleme yalnızca alanları günceller.
      await updateTx(sessionEditId, {
        ...formData, type: tab as TransactionType, amount, currency, updatedAt: now,
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId:    formData.toAccountId    || undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId    ?? null,
        tags:           cleanTags.length ? cleanTags : undefined,
      })
      setSession(rows => rows.map(r => r.id === sessionEditId ? {
        ...r,
        description: form.description.trim(),
        amount,
        currency,
        type:        tab,
        categoryId:  formData.categoryId || undefined,
        accountName: account?.name ?? r.accountName,
      } : r))
      setSessionEditId(null)
      rememberAddedDate(formData.date)
      resetForNext(formData.date)
      return
    } else {
      const base = {
        ...formData,
        type:        tab as TransactionType,
        amount:      savedAmount,
        currency,
        categorySplits: txSplits,
        categoryId:  splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId: formData.toAccountId || undefined,
        tags:        cleanTags.length ? cleanTags : undefined,
        ...collectionFields,
      }
      const isGroup = formData.isInstallment && installments > 1
      let newId: string
      if (isGroup) {
        const ids = await addGroup(base, installments, manualAmounts?.map(s => parseCurrencyInput(s)))
        newId = ids[0]
      } else {
        newId = crypto.randomUUID()
        await addTx({ ...base, id: newId, isInstallment: false, createdAt: now, updatedAt: now })
      }
      const wroteTax = !isGroup && taxAmount > 0
      if (wroteTax) {
        // Stopaj: Vergi kategorisine, alıcısı İTC olan ayrı gider. Kimliği faiz
        // satırından türetilir (interestTaxId) — silme ve düzenleme bu bağla bulur.
        await addTx({
          id:            interestTaxId(newId),
          type:          'expense',
          amount:        taxAmount,
          currency,
          date:          form.date,
          accountId:     form.accountId,
          categoryId:    taxCategoryId(),
          recipientId:   await taxRecipientId(),
          description:   taxDescription,
          isInstallment: false,
          createdAt:     now,
          updatedAt:     now,
        })
      }
      rememberAddedDate(formData.date)
      const isDebtPay = (tab === 'transfer' || tab === 'income') && form.isDebtPayment && !!formData.debtId
      if (isDebtPay && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amountTry)
      }
      // Art arda ekle: modal kapanmaz — satır oturum listesine düşer ve form
      // bir sonraki giriş için toplanır.
      if (canKeepOpen && keepOpen) {
        setSession(rows => [...rows, {
          id:          newId,
          description: form.description.trim(),
          amount:      isGroup ? parseCurrencyInput(amountStr) : savedAmount,
          currency,
          type:        tab,
          categoryId:  formData.categoryId || undefined,
          accountName: account?.name ?? '',
          editable:    !isGroup && !isDebtPay && !wroteTax,
        }])
        resetForNext(formData.date)
        return
      }
    }
    closeModal()
    } catch (err) {
      console.error('[transaction:submit]', err)
      setErrors({ description: 'Kaydetme başarısız oldu, tekrar deneyin' })
    } finally {
      setLoading(false)
    }
  }

  return { handleSubmit }
}
