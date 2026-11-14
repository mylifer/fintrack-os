import { today } from '@/lib/utils/date'
import { isDebtCollectionTx } from '@/lib/utils/calculations'
import { parseCurrencyInput, formatCurrency } from '@/lib/utils/currency'
import { toBaseTry } from '@/lib/utils/fx'
import { dedupeTags } from '@/lib/utils/tags'
import { hasDuplicateCategory, type DraftSplit } from '@/lib/utils/categorySplits'
import type { Transaction, CurrencyCode, ModalPayload, RecurringTransaction, RecurringFrequency, Account, Debt } from '@/types'

// İşlem formunun saf modeli (TransactionFormModal'dan taşındı): sekmeler, form
// tohumları, art arda ekleme belleği, tutar biçimi, öneri listesi ve doğrulama.
// React'e bağımlı değildir — birim testleri form-model.test.ts'te.

// ── Types ────────────────────────────────────────────────────────────────────

export type Tab = 'expense' | 'income' | 'transfer'

export const TABS: { key: Tab; label: string }[] = [
  { key: 'expense',  label: 'Gider'    },
  { key: 'income',   label: 'Gelir'    },
  { key: 'transfer', label: 'Transfer' },
]

export const FREQ_OPTIONS = [
  { value: 'daily',   label: 'Günlük'  },
  { value: 'weekly',  label: 'Haftalık' },
  { value: 'monthly', label: 'Aylık'   },
  { value: 'yearly',  label: 'Yıllık'  },
]

// Recurring-only fields, kept beside the shared transaction form state.
// "Ayın Günü" alanı yok: takvim onu hiç okumadı, gün BAŞLANGIÇ TARİHİNDEN gelir
// (bkz. lib/utils/recurrence.ts anchorDayOf).
export function newRecurringForm() {
  return {
    name:       '',
    frequency:  'monthly' as RecurringFrequency,
    startDate:  today(),
    endDate:    '',
  }
}

// Modal her açılışta remount olduğundan (layout'ta key'li) açılışlar arasında
// hatırlanması gereken iki şey modül seviyesinde yaşar; sayfa yenilenince
// varsayılana döner:
//   · date      — son eklenen işlemin tarihi, yeni form onunla açılır
//   · keepOpen  — "art arda ekle" tercihi
// Okuma/yazma modül fonksiyonlarından geçer: değerler render sırasında değil,
// kayıt/işleyici içinde değişir (React Compiler'ın global yeniden atama kuralı).
const modalMemory: { date: string | null; keepOpen: boolean } = { date: null, keepOpen: false }
export function rememberAddedDate(date: string) { modalMemory.date = date }
export function rememberKeepOpen(on: boolean)   { modalMemory.keepOpen = on }
export function recallKeepOpen(): boolean       { return modalMemory.keepOpen }

export function newForm() {
  return {
    type: 'expense' as Tab,
    amount: 0,
    currency: 'TRY' as CurrencyCode,
    date: modalMemory.date ?? today(),
    accountId: '',
    toAccountId: undefined as string | undefined,
    categoryId: '' as string | undefined,
    description: '',
    notes: undefined as string | undefined,
    tags: [] as string[],
    isInstallment: false,
    familyMemberId: undefined as string | null | undefined,
    recipientId:    undefined as string | null | undefined,
    isDebtPayment: false,
    debtId: undefined as string | undefined,
  }
}

// Art arda ekleme: bir sonraki giriş için form. Tip, hesap ve tarih taşınır;
// geri kalan her şey (tutar, açıklama, kategori, kişi, etiket, not, taksit ve
// borç ayarları) temizlenir.
export function formForNextEntry(type: Tab, accountId: string, date: string): ReturnType<typeof newForm> {
  return { ...newForm(), type, accountId, date }
}

/** İşlem formunun durumu (newForm şekli). */
export type TxForm = ReturnType<typeof newForm>

/** Tekrarlayan şablon alanlarının durumu (newRecurringForm şekli). */
export type RecForm = ReturnType<typeof newRecurringForm>

// Build the initial form once (used as a lazy useState initializer). On edit it
// hydrates from the transaction being edited; on add it seeds an empty form,
// optionally pre-filling the account passed via the modal payload.
export function buildInitialForm(
  isEdit: boolean,
  editingTx: Transaction | undefined,
  editingRec: RecurringTransaction | undefined,
  modalPayload: ModalPayload | null,
): ReturnType<typeof newForm> {
  if (editingRec) {
    return {
      ...newForm(),
      type:           editingRec.type as Tab,
      amount:         editingRec.amount,
      currency:       editingRec.currency,
      accountId:      editingRec.accountId,
      toAccountId:    editingRec.toAccountId,
      categoryId:     editingRec.categoryId ?? '',
      description:    editingRec.description,
      notes:          editingRec.notes,
      familyMemberId: editingRec.familyMemberId ?? undefined,
      recipientId:    editingRec.recipientId    ?? undefined,
    }
  }
  if (isEdit && editingTx) {
    return {
      type:           editingTx.type as Tab,
      amount:         editingTx.amount,
      currency:       editingTx.currency,
      date:           editingTx.date,
      accountId:      editingTx.accountId,
      toAccountId:    editingTx.toAccountId,
      categoryId:     editingTx.categoryId ?? '',
      description:    editingTx.description,
      notes:          editingTx.notes,
      tags:           editingTx.tags ?? [],
      isInstallment:  editingTx.isInstallment,
      familyMemberId: editingTx.familyMemberId ?? undefined,
      recipientId:    editingTx.recipientId    ?? undefined,
      // Borç bağı iki biçimde olur: transfer = borcuma ödeme, gelir = alacağımın
      // tahsilatı (isDebtCollectionTx). İkisi de aynı form alanlarını kullanır.
      isDebtPayment:  (editingTx.type === 'transfer' && !!editingTx.debtId && !editingTx.toAccountId)
        || isDebtCollectionTx(editingTx),
      debtId:         (editingTx.type === 'transfer' && !editingTx.toAccountId) || isDebtCollectionTx(editingTx)
        ? editingTx.debtId : undefined,
    }
  }
  const f = newForm()
  if (modalPayload?.accountId) f.accountId = modalPayload.accountId
  return f
}

// Art arda ekleme oturumunda modal içinde biriken satır. Sadece görüntüleme
// için tutulur — gerçek kayıt store'dadır; `id` silme/düzenleme hedefidir
// (taksitli grupta ilk taksitin id'si; remove() zaten tüm grubu siler).
export interface SessionRow {
  id:          string
  description: string
  amount:      number            // taksitli grupta TOPLAM satın alma tutarı
  currency:    CurrencyCode
  type:        Tab
  categoryId?: string
  accountName: string
  // Satır modal içinde düzenlenebilir mi: tekil, taksitsiz, borç ödemesi
  // olmayan sıradan satırlar. Diğerleri yalnızca silinebilir (kendi kapsamlı
  // akışları var; art arda oturumunda yarım yamalak düzenlenmemeli).
  editable:    boolean
}

export interface Suggestion {
  description:     string
  categoryId:      string
  familyMemberId?: string
  recipientId?:    string
  toAccountId?:    string
  tags?:           string[]
}

// ── Turkish amount formatter ──────────────────────────────────────────────────
// amountStr stores raw digits + optional single comma (e.g. "1250,50")
// Display adds dots as thousands separators (e.g. "1.250,50")

// Sayıyı amountStr'nin raw biçimine çevirir (500.5 → "500,5") — taksit
// düzenleyicisinin input değerleri de ana tutar alanıyla aynı biçimi kullanır.
export function toAmountStr(v: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, useGrouping: false }).format(v)
}

export function formatTurkishDisplay(raw: string): string {
  if (!raw) return '0'
  const commaIdx = raw.indexOf(',')
  const intPart  = commaIdx === -1 ? raw : raw.slice(0, commaIdx)
  const decPart  = commaIdx === -1 ? '' : raw.slice(commaIdx)          // includes the comma
  const grouped  = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return grouped + decPart
}

// ── Autocomplete suggestions ──────────────────────────────────────────────────

  // Aynı açıklamadan birden çok satır varsa "SON" olan kazanır ve son olan,
  // en son KAYDEDİLEN/DÜZENLENEN satırdır — işlem tarihi en ileri olan değil.
  // Tarihe bakmak yanlış alan dolduruyordu: geriye tarihlenmiş yeni bir kayıt
  // (bugün girilip geçen aya yazılan cashback) hep kaybediyor, ileri tarihli
  // bir satır (taksit/tekrarlayan üretimi, planlanmış kayıt) ise sonsuza kadar
  // kazanıyordu. Eşitlikte işlem tarihi ayırıcı olur.
export function buildSuggestions(transactions: Transaction[], tab: Tab, accounts: { id: string }[]): Suggestion[] {
  // updatedAt/createdAt ISO zaman damgası, date ise salt tarih ("2026-06-21");
  // damgası olmayan eski satırlar bu yüzden damgalı olanlara karşı kaybeder.
  const stampOf = (tx: Transaction) => tx.updatedAt || tx.createdAt || tx.date
  const map = new Map<string, { description: string; categoryId: string; date: string; stamp: string; familyMemberId?: string; recipientId?: string; toAccountId?: string; tags?: string[] }>()
  transactions
    .filter(tx => tx.type === tab && tx.description?.trim())
    .forEach(tx => {
      const key   = tx.description.trim().toLowerCase()
      const ex    = map.get(key)
      const stamp = stampOf(tx)
      if (!ex || stamp > ex.stamp || (stamp === ex.stamp && tx.date > ex.date)) {
        map.set(key, {
          description:    tx.description.trim(),
          categoryId:     tx.categoryId ?? '',
          date:           tx.date,
          stamp,
          familyMemberId: tx.familyMemberId ?? undefined,
          recipientId:    tx.recipientId    ?? undefined,
          // Transfer önerileri hedef hesabı da taşır — silinmiş/arşivli hesap seçilemez
          toAccountId:    tx.toAccountId && accounts.some(a => a.id === tx.toAccountId)
            ? tx.toAccountId
            : undefined,
          // Etiketler de son işlemden gelir — boşsa alan hiç taşınmaz
          tags:           tx.tags?.length ? dedupeTags(tx.tags) : undefined,
        })
      }
    })
  return Array.from(map.values()).map(({ description, categoryId, familyMemberId, recipientId, toAccountId, tags }) =>
    ({ description, categoryId, familyMemberId, recipientId, toAccountId, tags }))
}

// ── Doğrulama ─────────────────────────────────────────────────────────────────
// Normal (tekil/taksitli/tekrarlayan) kayıt yolunun alan kuralları. Hata
// sözlüğünü döndürür; boşsa form geçerlidir.

export interface ValidateInput {
  amountStr:           string
  form:                TxForm
  tab:                 Tab
  isCollection:        boolean
  splits:              DraftSplit[] | null
  isInterest:          boolean
  taxRate:             number
  selectedReceivable:  Debt | undefined
  receivableRemaining: number
  accounts:            Account[]
  isRecurring:         boolean
  rec:                 RecForm
  manualAmounts:       string[] | null
}

export function validateTransactionForm({
  amountStr, form, tab, isCollection, splits, isInterest, taxRate, selectedReceivable,
  receivableRemaining, accounts, isRecurring, rec, manualAmounts,
}: ValidateInput): Record<string, string> {
  const e: Record<string, string> = {}
  // Magnitude only — the sign is carried separately (amountSign). Negative
  // `expense` amounts (refunds) are allowed; the input holds the magnitude.
  const amount = parseCurrencyInput(amountStr)
  if (!amount || amount <= 0)                      e.amount      = 'Geçerli bir tutar girin'
  if (!form.accountId)                             e.accountId   = 'Hesap seçin'
  // Bölme açıkken kategori payların içinden gelir; tek alan boş olabilir.
  // Alacak tahsilatı kategori taşımaz — yerine alacak seçilir.
  if (tab !== 'transfer' && !isCollection && !splits && !form.categoryId) e.categoryId  = 'Kategori seçin'
  if (isInterest && !(taxRate >= 0 && taxRate < 100)) e.interestRate = 'Stopaj oranı 0 ile 99 arasında olmalı'
  if (isCollection && !form.debtId)                e.debtId      = 'Alacak seçin'
  else if (isCollection && selectedReceivable && amount > 0) {
    // Alacak TL bazlıdır; yabancı para hesaba gelen tahsilat TL'ye çevrilip kıyaslanır.
    const cur = (accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode
    if (toBaseTry(amount, cur) > receivableRemaining + 0.005) {
      e.amount = `Tutar kalan alacaktan fazla (kalan ${formatCurrency(receivableRemaining, 'TRY')})`
    }
  }
  // Oran barı toplamı yapısal olarak korur → geriye iki kural kalır: her payın
  // kategorisi dolu ve payı 0'dan büyük olmalı (0 paylı kategori hiçbir rapora
  // katkı vermez, yalnızca yanıltır — taksit editörüyle aynı kural).
  if (splits?.some(s => !s.categoryId))            e.categorySplits = 'Her pay için kategori seçin'
  else if (splits && hasDuplicateCategory(splits))
    e.categorySplits = 'Aynı kategori birden fazla payda seçilemez'
  else if (splits?.some(s => Math.abs(s.amount) < 0.01))
    e.categorySplits = 'Her payın tutarı 0’dan büyük olmalı'
  if (isRecurring) {
    // Recurring: name + startDate required; description falls back to name;
    // transfer target is always an account (no debt payments on templates).
    if (!rec.name.trim())                          e.name        = 'Ad girin'
    if (!rec.startDate)                            e.startDate   = 'Başlangıç tarihi seçin'
    if (tab === 'transfer' && !form.toAccountId)   e.toAccountId = 'Hedef hesap seçin'
  } else {
    if (!form.date)                                e.date        = 'Tarih seçin'
    if (tab === 'transfer' && !form.isDebtPayment && !form.toAccountId) e.toAccountId = 'Hedef hesap seçin'
    if (tab === 'transfer' && form.isDebtPayment && !form.debtId)       e.debtId      = 'Borç seçin'
    if (!form.description.trim())                  e.description = 'Açıklama girin'
    if (form.isInstallment && manualAmounts?.some(s => !(parseCurrencyInput(s) > 0))) {
      e.installments = 'Tüm taksit tutarları 0’dan büyük olmalı'
    }
  }
  return e
}
