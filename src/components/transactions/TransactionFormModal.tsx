'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useId } from 'react'
import { useUIStore, useAccountStore, useCategoryStore, useTransactionStore, usePeopleStore, useDebtStore, useRecurringStore, useWorkspaceStore } from '@/store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { parseCurrencyInput, getCurrencySymbol, formatCurrency } from '@/lib/utils/currency'
import { splitMoney, sumMoney } from '@/lib/utils/money'
import { toBaseTry } from '@/lib/utils/fx'
import { today } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { Transaction, TransactionType, CurrencyCode, PersonRole, Person, ModalPayload, RecurringTransaction, RecurringFrequency, Category, Account } from '@/types'
import { useShallow } from 'zustand/react/shallow'
import { X, Pencil, Trash2, Wallet, CreditCard, Repeat } from 'lucide-react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { PersonSelect } from '@/components/people/PersonSelect'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { TagInput } from '@/components/transactions/TagInput'
import { useTags } from '@/lib/hooks/useTags'
import { dedupeTags, tagColor, tagKey } from '@/lib/utils/tags'
import { SUBSCRIPTION_TAG, isSubscriptionTag, detectBrand } from '@/lib/subscriptions/brands'
import { BrandLogo } from '@/components/subscriptions/BrandLogo'
import { CategorySplitField } from '@/components/transactions/CategorySplitField'
import {
  equalSplit, rescaleSplits, distributeSplits, unpinSplits, primarySplitCategoryId,
  hasDuplicateCategory, type DraftSplit,
} from '@/lib/utils/categorySplits'
import type { CategorySplit } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'expense' | 'income' | 'transfer'

const TABS: { key: Tab; label: string }[] = [
  { key: 'expense',  label: 'Gider'    },
  { key: 'income',   label: 'Gelir'    },
  { key: 'transfer', label: 'Transfer' },
]

const FREQ_OPTIONS = [
  { value: 'daily',   label: 'Günlük'  },
  { value: 'weekly',  label: 'Haftalık' },
  { value: 'monthly', label: 'Aylık'   },
  { value: 'yearly',  label: 'Yıllık'  },
]

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}. gün`,
}))

// Recurring-only fields, kept beside the shared transaction form state.
function newRecurringForm() {
  return {
    name:       '',
    frequency:  'monthly' as RecurringFrequency,
    dayOfMonth: '1',
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
function rememberAddedDate(date: string) { modalMemory.date = date }
function rememberKeepOpen(on: boolean)   { modalMemory.keepOpen = on }
function recallKeepOpen(): boolean       { return modalMemory.keepOpen }

function newForm() {
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
function formForNextEntry(type: Tab, accountId: string, date: string): ReturnType<typeof newForm> {
  return { ...newForm(), type, accountId, date }
}

// Build the initial form once (used as a lazy useState initializer). On edit it
// hydrates from the transaction being edited; on add it seeds an empty form,
// optionally pre-filling the account passed via the modal payload.
function buildInitialForm(
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
      isDebtPayment:  editingTx.type === 'transfer' && !!editingTx.debtId && !editingTx.toAccountId,
      debtId:         editingTx.type === 'transfer' && !editingTx.toAccountId ? editingTx.debtId : undefined,
    }
  }
  const f = newForm()
  if (modalPayload?.accountId) f.accountId = modalPayload.accountId
  return f
}

// Art arda ekleme oturumunda modal içinde biriken satır. Sadece görüntüleme
// için tutulur — gerçek kayıt store'dadır; `id` silme/düzenleme hedefidir
// (taksitli grupta ilk taksitin id'si; remove() zaten tüm grubu siler).
interface SessionRow {
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

interface Suggestion {
  description:     string
  categoryId:      string
  familyMemberId?: string
  recipientId?:    string
  toAccountId?:    string
  tags?:           string[]
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, error, children, optional }: {
  label: string
  error?: string
  children: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("text-sm font-medium", error && "text-destructive")}>
        {label}
        {optional && <span className="font-normal text-muted-foreground ml-1">(opsiyonel)</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ── Shadcn Select wrapper ─────────────────────────────────────────────────────

function AppSelect({
  value, onChange, options, placeholder, error, disabled, onOpenChange,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; icon?: React.ReactNode }[]
  placeholder?: string
  error?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled} onOpenChange={onOpenChange}>
      <SelectTrigger
        aria-invalid={!!error}
        className={cn(
          "h-9 data-[size=default]:h-9 w-full rounded-md",
          error && "border-destructive aria-invalid:ring-destructive/20",
        )}
      >
        <SelectValue placeholder={placeholder ?? 'Seçin...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.icon ? (
              <span className="flex items-center gap-2">
                <span>{o.icon}</span>
                <span>{o.label}</span>
              </span>
            ) : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

function DescriptionAutocomplete({
  value, onChange, onSelect, suggestions, categories, people, accounts, error, autoFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (s: Suggestion) => void
  suggestions: Suggestion[]
  categories: { id: string; name: string; icon: string; color: string }[]
  people: Person[]
  accounts: { id: string; name: string }[]
  error?: string
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const justMountedRef = useRef(true)
  const id = useId()

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter(s => s.description.toLowerCase().includes(q)).slice(0, 6)
  }, [value, suggestions])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || !filtered.length) return
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); onSelect(filtered[highlighted]); setOpen(false) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showDropdown = open && filtered.length > 0

  return (
    <div className="relative">
      <input
        id={id}
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0) }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (justMountedRef.current) { justMountedRef.current = false; return }
          value.trim() && setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Migros, Maaş, Kira..."
        aria-invalid={!!error}
        className={cn(
          "h-9 w-full rounded-md border bg-background dark:bg-muted px-3 text-sm outline-none transition-colors",
          "placeholder:text-muted-foreground",
          "focus:ring-2 focus:ring-ring/50 focus:border-ring",
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
          showDropdown && "rounded-b-none border-b-0",
          error ? "border-destructive" : "border-input",
        )}
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-md border border-t-0 border-input bg-popover shadow-md">
          {filtered.map((s, i) => {
            const cat = categories.find(c => c.id === s.categoryId)
            const famPerson = people.find(p => p.id === s.familyMemberId)
            const recPerson = people.find(p => p.id === s.recipientId)
            const toAcc = accounts.find(a => a.id === s.toAccountId)
            return (
              <button
                key={s.description}
                type="button"
                onMouseDown={() => { onSelect(s); setOpen(false) }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                  i === highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <span className="flex-1 truncate">{s.description}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {s.tags?.slice(0, 2).map(t => (
                    <span
                      key={tagKey(t)}
                      className="rounded-md px-1.5 py-0.5 font-medium"
                      style={{ background: `${tagColor(tagKey(t))}1A`, color: tagColor(tagKey(t)) }}
                    >
                      {t}
                    </span>
                  ))}
                  {famPerson && <span>{famPerson.name}</span>}
                  {recPerson && <span>{recPerson.name}</span>}
                  {toAcc && <span>→ {toAcc.name}</span>}
                  {cat && <span className="inline-flex items-center gap-1"><CategoryIcon icon={cat.icon} color={cat.color} size={12} /> {cat.name}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Person field ──────────────────────────────────────────────────────────────

function PersonField({
  role, value, onChange,
}: {
  role: PersonRole
  value: string | null | undefined
  onChange: (id: string | undefined) => void
}) {
  const allPeople = usePeopleStore(s => s.people)
  const addPerson = usePeopleStore(s => s.add)
  // Archived people stay resolvable on old transactions but are not selectable —
  // unless the transaction being edited already points at one (keep it visible).
  const people    = allPeople.filter(p => p.role === role && (!p.isArchived || p.id === value))

  const label = role === 'family_member' ? 'Aile Üyesi' : 'Alıcı'

  return (
    <Field label={label} optional>
      <PersonSelect
        people={people}
        value={value}
        onChange={onChange}
        onCreate={async name => {
          try {
            const person = await addPerson(name, role)
            return person.id
          } catch (err) {
            console.error('[person:add]', err)
            return null
          }
        }}
      />
    </Field>
  )
}

// ── Turkish amount formatter ──────────────────────────────────────────────────
// amountStr stores raw digits + optional single comma (e.g. "1250,50")
// Display adds dots as thousands separators (e.g. "1.250,50")

// Sayıyı amountStr'nin raw biçimine çevirir (500.5 → "500,5") — taksit
// düzenleyicisinin input değerleri de ana tutar alanıyla aynı biçimi kullanır.
function toAmountStr(v: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, useGrouping: false }).format(v)
}

function formatTurkishDisplay(raw: string): string {
  if (!raw) return '0'
  const commaIdx = raw.indexOf(',')
  const intPart  = commaIdx === -1 ? raw : raw.slice(0, commaIdx)
  const decPart  = commaIdx === -1 ? '' : raw.slice(commaIdx)          // includes the comma
  const grouped  = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return grouped + decPart
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function TransactionFormModal() {
  const modal        = useUIStore(s => s.modal)
  const modalPayload = useUIStore(s => s.modalPayload)
  const closeModal   = useUIStore(s => s.closeModal)
  const accounts   = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories = useCategoryStore(s => s.categories)
  const addCategory = useCategoryStore(s => s.add)
  const transactions = useTransactionStore(s => s.transactions)
  const addTx        = useTransactionStore(s => s.add)
  const addGroup     = useTransactionStore(s => s.addInstallmentGroup)
  const updateGroup  = useTransactionStore(s => s.updateInstallmentGroup)
  const convertGroup = useTransactionStore(s => s.convertToInstallmentGroup)
  const updateTx     = useTransactionStore(s => s.update)
  const allPeople    = usePeopleStore(s => s.people)
  const activeDebts  = useDebtStore(useShallow(s => s.debts.filter(d => !d.isSettled && d.direction === 'owe')))
  const recurring    = useRecurringStore(s => s.recurring)
  const addRec       = useRecurringStore(s => s.add)
  const updateRec    = useRecurringStore(s => s.update)
  const tags           = useTags()
  const tagSuggestions = useMemo(() => tags.map(t => t.tag), [tags])

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

  // Lazy initializers run exactly once — the component is remounted (keyed) per
  // open, so first-render values (editingTx / modalPayload) are the correct seed.
  const [tab, setTab]             = useState<Tab>(() =>
    editingRec ? editingRec.type as Tab : isEdit && editingTx ? editingTx.type as Tab : 'expense')
  const [form, setForm]           = useState(() => {
    const f = buildInitialForm(isEdit, editingTx, editingRec, modalPayload)
    // Taksitli grup düzenleniyorsa tarih ilk taksitinki olsun (ilk-giriş görünümü).
    if (installGroup.length) f.date = installGroup[0].date
    return f
  })
  const [rec, setRec]             = useState(() => editingRec
    ? {
        name:       editingRec.name,
        frequency:  editingRec.frequency,
        dayOfMonth: String(editingRec.dayOfMonth ?? 1),
        startDate:  editingRec.startDate,
        endDate:    editingRec.endDate ?? '',
      }
    : newRecurringForm())
  const [amountStr, setAmountStr] = useState(() => {
    // Taksitli grup düzenleniyorsa 'Tutar' toplamı gösterir (ilk-giriş gibi).
    const seed = installGroup.length
      ? sumMoney(installGroup.map(t => t.amount))
      : editingRec?.amount ?? (isEdit && editingTx ? editingTx.amount : undefined)
    return seed !== undefined
      ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, useGrouping: false }).format(Math.abs(seed))
      : ''
  })
  // Sign of the amount. Always +1 except when editing a refund (negative
  // expense), where we preserve the negative so a save doesn't flip it positive.
  const [amountSign, setAmountSign] = useState(() => isEdit && editingTx && editingTx.amount < 0 ? -1 : 1)
  const [installments, setInstallments] = useState(() =>
    installGroup.length || (isEdit && editingTx ? (editingTx.installTotal ?? 1) : 1))
  // Elle düzenlenen taksit tutarları (amountStr formatında raw string'ler).
  // null → otomatik bölüşüm (splitMoney). Toplam tutar veya taksit sayısı
  // değişince elle girilenler geçersizleşir, otomatiğe dönülür (onChange'lerde
  // sıfırlanır — effect içinde setState lint'e takılıyor). Taksitli grup
  // düzenleniyorsa mevcut taksit tutarlarıyla tohumlanır (gerçek tutarlar görünür).
  const [manualAmounts, setManualAmounts] = useState<string[] | null>(() =>
    installGroup.length ? installGroup.map(t => toAmountStr(t.amount)) : null)
  // ── Çoklu kategori (oran barı) ─────────────────────────────────────────
  // null → bölme kapalı (tek kategori, alan bugünkü haliyle çalışır).
  // Paylar BÜYÜKLÜK uzayında tutulur; işaret kayıtta amountSign ile verilir.
  // Taksitli grup düzenlenirken paylar TOPLAM tutara ölçeklenir (ilk-giriş
  // görünümüyle tutarlı: satır satır değil, satın almanın tamamı üzerinden).
  // Kayıtlı paylar SABİT gelir: düzenlemede kullanıcının bir kez verdiği
  // tutarlar kendiliğinden oynamaz (tutar değişirse kalanı son pay yutar).
  const [splits, setSplits] = useState<DraftSplit[] | null>(() => {
    const src = installGroup.length ? installGroup[0].categorySplits : editingTx?.categorySplits
    if (!src?.length || src.length < 2) return null
    const magnitude = src.map(s => ({ ...s, amount: Math.abs(s.amount) }))
    const totalSeed = installGroup.length
      ? sumMoney(installGroup.map(t => Math.abs(t.amount)))
      : Math.abs(editingTx?.amount ?? 0)
    return rescaleSplits(magnitude, totalSeed).map(s => ({ ...s, pinned: true }))
  })

  const [loading, setLoading]     = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

  // ── Art arda ekleme (oturum) ───────────────────────────────────────────
  // Açıkken Kaydet modalı kapatmaz: satır store'a yazılır, footer'ın üstündeki
  // oturum listesine düşer ve form bir sonraki giriş için sıfırlanır.
  const [keepOpen, setKeepOpen]           = useState(recallKeepOpen)
  const [session, setSession]             = useState<SessionRow[]>([])
  const [sessionEditId, setSessionEditId] = useState<string | null>(null)

  const [isFocused, setIsFocused] = useState(false)
  const [cursorX, setCursorX]    = useState(0)
  const amountInputRef    = useRef<HTMLInputElement>(null)
  const mirrorRef         = useRef<HTMLSpanElement>(null)
  const numberContainerRef = useRef<HTMLDivElement>(null)
  const oldContainerLeftRef = useRef(0)

  // Track Select open state to prevent dialog from closing while a dropdown is open.
  // Radix DismissableLayer defers dialog's onInteractOutside to the "click" event,
  // by which time the Select has already closed. Snapshot the state on pointerdown
  // (capture phase, before any bubbling handler fires) for reliable detection.
  const selectOpenRef = useRef(false)
  const selectWasOpenRef = useRef(false)
  useEffect(() => {
    const snap = () => { selectWasOpenRef.current = selectOpenRef.current }
    document.addEventListener('pointerdown', snap, true)
    return () => document.removeEventListener('pointerdown', snap, true)
  }, [])
  const onSelectOpen = (open: boolean) => { selectOpenRef.current = open }

  // Autocomplete suggestions
  // Aynı açıklamadan birden çok satır varsa "SON" olan kazanır ve son olan,
  // en son KAYDEDİLEN/DÜZENLENEN satırdır — işlem tarihi en ileri olan değil.
  // Tarihe bakmak yanlış alan dolduruyordu: geriye tarihlenmiş yeni bir kayıt
  // (bugün girilip geçen aya yazılan cashback) hep kaybediyor, ileri tarihli
  // bir satır (taksit/tekrarlayan üretimi, planlanmış kayıt) ise sonsuza kadar
  // kazanıyordu. Eşitlikte işlem tarihi ayırıcı olur.
  const suggestions = useMemo<Suggestion[]>(() => {
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
  }, [transactions, tab, accounts])

  // FLIP slide-left animation: fires after React paints the new (wider) number,
  // offsets back to old position instantly, then transitions to the natural position.
  useLayoutEffect(() => {
    const el = numberContainerRef.current
    if (!el || !amountStr) return
    const newLeft = el.getBoundingClientRect().left
    const delta   = oldContainerLeftRef.current - newLeft   // positive = shifted left
    if (delta < 0.5) return                                  // deleted or no change
    el.style.transition = 'none'
    el.style.transform  = `translateX(${delta}px)`
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform 240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      el.style.transform  = 'translateX(0)'
    }))
  }, [amountStr])

  const filteredCategories = useMemo(() => categories.filter(c => c.scope === tab), [categories, tab])
  const accountOptions     = useMemo(
    () => accounts.map(a => ({ value: a.id, label: a.name, icon: <AccountAvatar account={a} size="xs" /> })),
    [accounts],
  )

  // ── Çalışma alanları arası transfer ─────────────────────────────────────
  // Sadece YENİ (düzenlenmeyen, tekrarlamayan) transfer için — bkz.
  // useTransactionStore.addCrossWorkspaceTransfer. Karşı bacak sıradan bir
  // gider/gelir satırı olduğundan, mevcut bir bacağı düzenlerken bu blok hiç
  // görünmez (o zaman tab 'expense'/'income'dir, 'transfer' değil).
  const allWorkspaces    = useWorkspaceStore(s => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeId)
  const otherWorkspaces  = useMemo(
    () => allWorkspaces.filter(w => w.id !== activeWorkspaceId),
    [allWorkspaces, activeWorkspaceId],
  )
  const [crossWs, setCrossWs]                 = useState(false)
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const [targetAccounts, setTargetAccounts]   = useState<Account[]>([])
  const [targetAccountId, setTargetAccountId] = useState('')

  useEffect(() => {
    // Boş hedef alan durumunda state'e dokunulmaz — hesap picker'ı zaten
    // `targetWorkspaceId` yokken render edilmiyor (aşağıda). Sıfırlama, alanı
    // DEĞİŞTİREN event handler'da yapılır (bkz. AppSelect onChange), effect
    // içinde senkron setState'ten kaçınmak için.
    if (!crossWs || !targetWorkspaceId) return
    let cancelled = false
    db.accounts.toArray().then(rows => {
      if (cancelled) return
      setTargetAccounts(
        rows.filter(isLive).filter(a => rowInWorkspace(a, targetWorkspaceId)) as Account[],
      )
    })
    return () => { cancelled = true }
  }, [crossWs, targetWorkspaceId])

  function validate(): boolean {
    const e: Record<string, string> = {}
    // Magnitude only — the sign is carried separately (amountSign). Negative
    // `expense` amounts (refunds) are allowed; the input holds the magnitude.
    const amount = parseCurrencyInput(amountStr)
    if (!amount || amount <= 0)                      e.amount      = 'Geçerli bir tutar girin'
    if (!form.accountId)                             e.accountId   = 'Hesap seçin'
    // Bölme açıkken kategori payların içinden gelir; tek alan boş olabilir.
    if (tab !== 'transfer' && !splits && !form.categoryId)              e.categoryId  = 'Kategori seçin'
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
        dayOfMonth:  rec.frequency === 'monthly' || rec.frequency === 'yearly'
          ? Number(rec.dayOfMonth)
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
    if (!targetAccountId)         e.toAccountId       = 'Hedef hesap seçin'
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

  // ── Art arda ekleme yardımcıları ────────────────────────────────────────
  // Checkbox yalnızca YENİ tekil işlem eklerken anlamlı: düzenleme, tekrarlayan
  // şablon ve çalışma alanları arası transfer kendi tek-seferlik akışlarıdır.
  const canKeepOpen = !isEdit && !isRecurring && !crossWs

  // Bir sonraki giriş için formu topla: tip, hesap ve tarih taşınır; tutar,
  // açıklama, kategori, kişi, etiket, not ve taksit/borç ayarları temizlenir.
  function resetForNext(keepDate: string) {
    setForm(f => formForNextEntry(f.type, f.accountId, keepDate))
    setAmountStr('')
    setAmountSign(1)
    setInstallments(1)
    setManualAmounts(null)
    setSplits(null)
    setErrors({})
    requestAnimationFrame(() => amountInputRef.current?.focus())
  }

  // Oturum satırını forma geri yükler — Kaydet artık o satırı GÜNCELLER.
  function editSessionRow(row: SessionRow) {
    const tx = useTransactionStore.getState().transactions.find(t => t.id === row.id)
    if (!tx) return
    setTab(tx.type as Tab)
    setForm({
      type:           tx.type as Tab,
      amount:         tx.amount,
      currency:       tx.currency,
      date:           tx.date,
      accountId:      tx.accountId,
      toAccountId:    tx.toAccountId,
      categoryId:     tx.categoryId ?? '',
      description:    tx.description,
      notes:          tx.notes,
      tags:           tx.tags ?? [],
      isInstallment:  false,
      familyMemberId: tx.familyMemberId ?? undefined,
      recipientId:    tx.recipientId    ?? undefined,
      isDebtPayment:  false,
      debtId:         undefined,
    })
    setAmountStr(toAmountStr(Math.abs(tx.amount)))
    setAmountSign(tx.amount < 0 ? -1 : 1)
    setInstallments(1)
    setManualAmounts(null)
    setSplits(tx.categorySplits?.length && tx.categorySplits.length > 1
      ? tx.categorySplits.map(s => ({ ...s, amount: Math.abs(s.amount) }))
      : null)
    setErrors({})
    setSessionEditId(row.id)
    requestAnimationFrame(() => amountInputRef.current?.focus())
  }

  // Satırı sil: store'un normal silme yolu — taksitli grup birlikte gider,
  // borç katkısı geri alınır ve "geri al" toast'ı çıkar.
  async function removeSessionRow(row: SessionRow) {
    await useTransactionStore.getState().remove(row.id)
    setSession(rows => rows.filter(r => r.id !== row.id))
    if (sessionEditId === row.id) {
      setSessionEditId(null)
      resetForNext(form.date)
    }
  }

  // Oturum listesi görünürken form gövdesi kısalır; modalın toplam boyu
  // liste olmadığındakiyle aynı kalsın (dikeyde taşma olmasın).
  const showSession = canKeepOpen && keepOpen && session.length > 0

  // Oturum toplamı — para birimi başına ayrı (karışık kurlarda "₺1.240 · $30").
  const sessionTotals = useMemo(() => {
    const byCurrency = new Map<CurrencyCode, number>()
    session.forEach(r => byCurrency.set(r.currency, sumMoney([byCurrency.get(r.currency) ?? 0, r.amount])))
    return Array.from(byCurrency, ([cur, sum]) => formatCurrency(sum, cur)).join(' · ')
  }, [session])

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

    if (editingTx && editingTx.isInstallment && editingTx.installGroupId && installments > 1) {
      // Taksitli grup düzenleme: 'ilk giriş' gibi toplam/sayı/taksitler tüm gruba
      // uygulanır. Taksit tutarları pozitif harcamadır → büyüklük kullanılır.
      const total   = parseCurrencyInput(amountStr)
      const rows    = manualAmounts ?? splitMoney(total, installments).map(toAmountStr)
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
      const rows    = manualAmounts ?? splitMoney(total, installments).map(toAmountStr)
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
      })
      if (tab === 'transfer' && form.isDebtPayment && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amountTry)
      }
    } else if (editingTx) {
      await updateTx(editingTx.id, {
        ...formData, type: tab as TransactionType, amount, currency, updatedAt: now,
        // Taksit bayrağı bu dalda DEĞİŞMEZ: gruba dönüşüm yukarıdaki dalda
        // olur, burada `isInstallment: true` yazmak grupsuz sahte taksit üretir.
        isInstallment:  editingTx.isInstallment,
        categorySplits: txSplits,
        categoryId:     splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId:    formData.toAccountId    || undefined,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId    ?? null,
        tags:           cleanTags.length ? cleanTags : undefined,
      })

      // Reconcile debt paidAmount for edit.
      // adjustPaidAmount: taksit sayısını değiştirmez (tutar düzeltmesi / geri alma);
      // recordPayment: yeni bir ödeme kaydeder (taksit sayısını da artırır).
      // Narrowed locals let TS follow the debt-id flow without non-null assertions.
      const editDebtId = editingTx.debtId
      const formDebtId = formData.debtId
      const wasDebtPayment = editingTx.type === 'transfer' && !!editDebtId && !editingTx.toAccountId
      const isDebtPaymentNow = tab === 'transfer' && form.isDebtPayment && !!formDebtId
      const { recordPayment, revertPayment, adjustPaidAmount } = useDebtStore.getState()
      const oldPaidTry = editingTx.amountTry ?? editingTx.amount   // prior payment in TRY

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
        amount,
        currency,
        categorySplits: txSplits,
        categoryId:  splitCategoryId ?? formData.categoryId ?? undefined,
        toAccountId: formData.toAccountId || undefined,
        tags:        cleanTags.length ? cleanTags : undefined,
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
      rememberAddedDate(formData.date)
      const isDebtPay = tab === 'transfer' && form.isDebtPayment && !!formData.debtId
      if (isDebtPay && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amountTry)
      }
      // Art arda ekle: modal kapanmaz — satır oturum listesine düşer ve form
      // bir sonraki giriş için toplanır.
      if (canKeepOpen && keepOpen) {
        setSession(rows => [...rows, {
          id:          newId,
          description: form.description.trim(),
          amount:      isGroup ? parseCurrencyInput(amountStr) : amount,
          currency,
          type:        tab,
          categoryId:  formData.categoryId || undefined,
          accountName: account?.name ?? '',
          editable:    !isGroup && !isDebtPay,
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

  const patch = (p: Partial<ReturnType<typeof newForm>>) => setForm(f => ({ ...f, ...p }))

  // ── Bölme yardımcıları ──────────────────────────────────────────────────
  // Tüm pay matematiği BÜYÜKLÜK üzerinden yürür (tutar alanı da öyle);
  // işaret yalnızca kayıt anında amountSign ile geri takılır.
  const splitTotal = parseCurrencyInput(amountStr)

  // Bölmeyi aç: mevcut kategori ilk pay olur, ikinci pay boş gelir (kullanıcı
  // seçer — sessizce rastgele bir kategori atamak veriyi kirletirdi). Tutar
  // eşit bölünür; kuruş kalanı ilk paya gider.
  function openSplit() {
    setSplits(equalSplit(splitTotal, [form.categoryId ?? '', '']))
    if (errors.categoryId) setErrors(prev => ({ ...prev, categoryId: '' }))
  }

  // Bölmeyi kapat: baskın kategori tek kategori olarak kalır.
  function closeSplit() {
    patch({ categoryId: primarySplitCategoryId(splits ?? undefined) ?? form.categoryId })
    setSplits(null)
    setErrors(prev => ({ ...prev, categorySplits: '' }))
  }

  // Yeni pay otomatik doğar: elle girilmiş tutarlara dokunulmaz, yalnızca
  // kalan yeniden paylaşılır.
  function addSplitRow() {
    if (!splits) return
    setSplits(distributeSplits([...splits, { categoryId: '', amount: 0 }], splitTotal))
  }

  function removeSplitRow(i: number) {
    if (!splits) return
    const rest = splits.filter((_, j) => j !== i)
    if (rest.length < 2) {
      patch({ categoryId: rest[0]?.categoryId || form.categoryId })
      setSplits(null)
      setErrors(prev => ({ ...prev, categorySplits: '' }))
      return
    }
    setSplits(distributeSplits(rest, splitTotal))
  }

  /** "Eşit böl": tüm sabitleri kaldırır, paylar baştan eşit bölünür. */
  function resetSplits() {
    if (!splits) return
    setSplits(unpinSplits(splits, splitTotal))
  }

  const createCategory = async (name: string) => {
    const cat: Category = {
      id:        crypto.randomUUID(),
      name,
      icon:      'package',
      color:     '#6366F1',
      scope:     tab === 'income' ? 'income' : 'expense',
      isSystem:  false,
      sortOrder: categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1,
    }
    await addCategory(cat)
    return cat.id
  }

  // Subscription toggle — marks an expense with the reserved tag. Derives its
  // checked state from the tag list (case-insensitive) and toggles it without
  // disturbing other tags; the existing dedupeTags-on-submit flow keeps it tidy.
  const isSubscription = form.tags.some(isSubscriptionTag)
  const toggleSubscription = (on: boolean) => {
    if (on) {
      if (!form.tags.some(isSubscriptionTag)) patch({ tags: [...form.tags, SUBSCRIPTION_TAG] })
    } else {
      patch({ tags: form.tags.filter(t => !isSubscriptionTag(t)) })
    }
  }
  const subBrand = isSubscription ? detectBrand(form.description) : null

  // ── Ödeme tipi ──────────────────────────────────────────────────────────
  // Abonelik ve taksit aynı sorunun cevabı ("bu gider nasıl ödeniyor"), o
  // yüzden tek bir segmentte toplanır. Seçenek kümesi duruma göre daralır:
  // taksit yalnızca yeni kayıtta ya da taksitli bir grup düzenlenirken anlamlı.
  const canSubscription = !isRecurring && tab === 'expense'
  // Var olan tekil bir işlem SONRADAN taksitlendirilebilir: satır 1. taksit
  // olur (id korunur), kalan taksitler üretilir. Mutabakat gerektiren bağları
  // olan satırlar dışarıda kalır — borç ödemesi, çalışma alanları arası
  // transfer bacağı, iade (negatif tutar / refundOfId) ve sistem kayıtları.
  const convertibleTx = !!editingTx && !isPlannedEdit && !editingTx.isInstallment
    && !editingTx.installGroupId && !editingTx.debtId && !editingTx.workspaceTransferId
    && !editingTx.systemKind && !editingTx.refundOfId && editingTx.amount > 0
  const canInstallment  = canSubscription && !sessionEditId
    && (!isEdit || installGroup.length > 0 || convertibleTx)
  // Taksitli grup düzenlenirken taksit KAPATILAMAZ: grubu tekil işleme
  // dönüştürme mutabakatı bu modalda yürütülmüyor (eskiden de checkbox
  // yerine sabit başlık gösteriliyordu). Segment kilitli görünür.
  const installmentLocked = canInstallment && isEdit && installGroup.length > 0
  // Segment tek seçimli; eski kayıtlarda ikisi birden işaretli olabilir —
  // taksit öncelenir, abonelik etiketi Etiketler alanında görünür kalır
  // (etiket silinmez, veri kaybı olmaz).
  type PayType = 'one' | 'installment' | 'subscription'
  const payType: PayType = form.isInstallment ? 'installment'
    : isSubscription ? 'subscription'
    : 'one'
  // Taksit seçeneği kullanılamaz durumdayken bile mevcut seçimse gösterilir,
  // yoksa segmentte hiçbir şey aktif görünmez.
  const payTypeOptions = ([
    { key: 'one',          label: 'Tek çekim', Icon: Wallet,     show: true },
    { key: 'installment',  label: 'Taksitli',  Icon: CreditCard, show: canInstallment || payType === 'installment' },
    { key: 'subscription', label: 'Abonelik',  Icon: Repeat,     show: canSubscription },
  ] as const).filter(o => o.show)

  const selectPayType = (next: PayType) => {
    if (installmentLocked || next === payType) return
    if (next === 'installment') {
      patch({ isInstallment: true })
      // Taksit anlamlı olsun diye en az 2'ye çekilir (tekil işlemde sayaç 1'dir).
      setInstallments(n => Math.max(2, n))
    } else if (form.isInstallment) {
      patch({ isInstallment: false })
      setManualAmounts(null)
    }
    toggleSubscription(next === 'subscription')
  }

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
                  patch({ type: key, categoryId: '', toAccountId: undefined, isDebtPayment: false, debtId: undefined })
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
        <div className="relative h-24 flex items-center justify-center border-b bg-muted/50">
          <div className="flex items-center gap-2 select-none pointer-events-none">
            {tab !== 'transfer' && (
              <span className={cn(
                "text-2xl font-semibold leading-none transition-colors duration-200",
                tab === 'expense' && amountSign < 0
                  ? "text-green-600"
                  : amountStr ? "text-muted-foreground/50" : "text-muted-foreground/25",
              )}>
                {tab === 'income' || (tab === 'expense' && amountSign < 0) ? '+' : '−'}
              </span>
            )}
            <span className={cn(
              "text-2xl font-semibold leading-none transition-colors duration-200",
              amountStr ? "text-muted-foreground/50" : "text-muted-foreground/25",
            )}>
              {getCurrencySymbol((accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode)}
            </span>

            {/* Number + custom smooth caret */}
            <div ref={numberContainerRef} className="relative leading-none">
              <span className={cn(
                "text-5xl font-bold tabular-nums leading-none",
                amountStr ? "text-foreground" : "text-muted-foreground/25",
                errors.amount && "!text-destructive",
              )}>
                {formatTurkishDisplay(amountStr)}
              </span>

              {/* Hidden mirror — measures rendered text width for caret positioning */}
              <span
                ref={mirrorRef}
                aria-hidden
                className="invisible absolute left-0 top-0 whitespace-pre text-5xl font-bold tabular-nums leading-none pointer-events-none"
              >
                {formatTurkishDisplay(amountStr)}
              </span>

              {/* Smooth caret */}
              {isFocused && (
                <div
                  className="amount-caret absolute top-[1px] bottom-[1px] w-[2.5px] rounded-full bg-foreground"
                  style={{ left: 0, transform: `translateX(${cursorX}px)`, transition: 'transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
                />
              )}
            </div>
          </div>

          {/* Error floats at bottom, doesn't affect centering */}
          {errors.amount && (
            <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-destructive">{errors.amount}</p>
          )}

          {/* Invisible input overlay captures typing */}
          <input
            ref={amountInputRef}
            type="text"
            inputMode="decimal"
            value={amountStr}
            onFocus={() => {
              setIsFocused(true)
              requestAnimationFrame(() => {
                if (mirrorRef.current) setCursorX(mirrorRef.current.offsetWidth)
              })
            }}
            onBlur={() => setIsFocused(false)}
            onChange={e => {
              // Capture position BEFORE state update for FLIP animation
              oldContainerLeftRef.current = numberContainerRef.current?.getBoundingClientRect().left ?? 0

              let raw = e.target.value.replace(/[^0-9,]/g, '')
              const firstComma = raw.indexOf(',')
              if (firstComma !== -1) {
                raw = raw.slice(0, firstComma + 1) + raw.slice(firstComma + 1).replace(/,/g, '')
              }
              setAmountStr(raw)
              setManualAmounts(null)
              // Elle girilen paylar aynen kalır, farkı otomatik pay yutar;
              // sabitler yeni tutara sığmıyorsa sondan serbest bırakılır.
              setSplits(s => s ? distributeSplits(s, parseCurrencyInput(raw)) : s)
              if (errors.amount) setErrors(prev => ({ ...prev, amount: '' }))
              requestAnimationFrame(() => {
                if (mirrorRef.current) setCursorX(mirrorRef.current.offsetWidth)
              })
            }}
            aria-label="Tutar"
            aria-invalid={!!errors.amount}
            className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          />
        </div>

        {/* ── Form body ──────────────────────────────────────────────────── */}
        <div className={cn(
          "flex flex-col gap-4 px-6 py-5 overflow-y-auto",
          showSession ? "max-h-[36vh]" : "max-h-[55vh]",
        )}>

          {/* Name (recurring only) */}
          {isRecurring && (
            <Field label="Ad" error={errors.name}>
              <Input
                autoFocus
                value={rec.name}
                onChange={e => {
                  setRec(r => ({ ...r, name: e.target.value }))
                  if (errors.name) setErrors(prev => ({ ...prev, name: '' }))
                }}
                placeholder="Kira, Netflix, Maaş..."
                error={errors.name}
              />
            </Field>
          )}

          {/* Description */}
          <Field label="Açıklama" error={errors.description} optional={isRecurring}>
            <DescriptionAutocomplete
              autoFocus={false}
              value={form.description}
              onChange={v => patch({ description: v })}
              onSelect={s => patch({
                description:    s.description,
                categoryId:     s.categoryId,
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
              })}
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
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className={cn("text-sm font-medium", (errors.toAccountId || errors.debtId || errors.targetWorkspaceId) && "text-destructive")}>
                    Hedef
                  </span>
                  <div className="flex rounded border border-input overflow-hidden text-[11px]">
                    <button
                      type="button"
                      onClick={() => { setCrossWs(false); patch({ isDebtPayment: false, debtId: undefined }) }}
                      className={cn(
                        "px-2 py-0.5 transition-colors",
                        !form.isDebtPayment && !crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Hesap
                    </button>
                    {/* Oturum satırı düzenlenirken hedef yalnızca hesap olabilir:
                        satır sıradan bir transfer olarak doğdu, borç/alan-transferi
                        mutabakatı bu dalda yürütülmez. */}
                    {!sessionEditId && (
                      <button
                        type="button"
                        onClick={() => { setCrossWs(false); patch({ isDebtPayment: true, toAccountId: undefined }) }}
                        className={cn(
                          "px-2 py-0.5 transition-colors border-l border-input",
                          form.isDebtPayment && !crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Borç
                      </button>
                    )}
                    {!isEdit && !sessionEditId && otherWorkspaces.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setCrossWs(true); patch({ isDebtPayment: false, toAccountId: undefined }) }}
                        className={cn(
                          "px-2 py-0.5 transition-colors border-l border-input",
                          crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Diğer Alan
                      </button>
                    )}
                  </div>
                </div>
                {crossWs ? (
                  <div className="flex flex-col gap-2">
                    <AppSelect
                      value={targetWorkspaceId}
                      onChange={v => { setTargetWorkspaceId(v); setTargetAccountId(''); setTargetAccounts([]) }}
                      options={otherWorkspaces.map(w => ({ value: w.id, label: w.name }))}
                      placeholder="Çalışma alanı seçin..."
                      error={!!errors.targetWorkspaceId}
                      onOpenChange={onSelectOpen}
                    />
                    {errors.targetWorkspaceId && <p className="text-xs text-destructive">{errors.targetWorkspaceId}</p>}
                    {targetWorkspaceId && (
                      targetAccounts.length === 0 ? (
                        <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                          Bu alanda hesap bulunamadı
                        </div>
                      ) : (
                        <AppSelect
                          value={targetAccountId}
                          onChange={setTargetAccountId}
                          options={targetAccounts.map(a => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
                          placeholder="Hedef hesap seçin..."
                          error={!!errors.toAccountId}
                          onOpenChange={onSelectOpen}
                        />
                      )
                    )}
                    {errors.toAccountId && <p className="text-xs text-destructive">{errors.toAccountId}</p>}
                  </div>
                ) : form.isDebtPayment ? (
                  <>
                    {activeDebts.length === 0 ? (
                      <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                        Aktif borcunuz bulunmuyor
                      </div>
                    ) : (
                      <AppSelect
                        value={form.debtId ?? ''}
                        onChange={v => {
                          const debt = activeDebts.find(d => d.id === v)
                          patch({ debtId: v, ...(debt && !form.description.trim() ? { description: debt.name } : {}) })
                        }}
                        options={activeDebts.map(d => ({ value: d.id, label: d.name }))}
                        placeholder="Borç seçin..."
                        error={!!errors.debtId}
                        onOpenChange={onSelectOpen}
                      />
                    )}
                    {errors.debtId && <p className="text-xs text-destructive">{errors.debtId}</p>}
                  </>
                ) : (
                  <>
                    <AppSelect
                      value={form.toAccountId ?? ''}
                      onChange={v => patch({ toAccountId: v })}
                      options={accountOptions.filter(a => a.value !== form.accountId)}
                      placeholder="Seçin..."
                      error={!!errors.toAccountId}
                      onOpenChange={onSelectOpen}
                    />
                    {errors.toAccountId && <p className="text-xs text-destructive">{errors.toAccountId}</p>}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className={cn("text-sm font-medium", errors.categoryId && "text-destructive")}>
                    Kategori
                  </Label>
                  {/* Bölme yalnızca gerçek bir tutar varken anlamlı — 0'ı bölmek
                      boş bir bar üretirdi. */}
                  {splits ? (
                    <button type="button" onClick={closeSplit} className="text-xs font-medium text-primary hover:underline">
                      Bölmeyi kaldır
                    </button>
                  ) : splitTotal > 0 && (
                    <button type="button" onClick={openSplit} className="text-xs font-medium text-primary hover:underline">
                      Böl
                    </button>
                  )}
                </div>
                {splits ? (
                  // Bölme açıkken alan özet gösterir; seçim aşağıdaki paylardan yapılır.
                  <div className="flex h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm select-none dark:bg-input/30">
                    <span className="flex items-center">
                      {splits.slice(0, 3).map((s, i) => {
                        const c = categories.find(x => x.id === s.categoryId)
                        return (
                          <span key={`${s.categoryId}-${i}`} className={cn("flex items-center", i > 0 && "-ml-1.5")}>
                            {c
                              ? <CategoryIcon icon={c.icon} color={c.color} size={13} />
                              : <span className="size-3.5 rounded-full bg-muted" />}
                          </span>
                        )
                      })}
                    </span>
                    <span className="truncate text-muted-foreground">{splits.length} kategori</span>
                  </div>
                ) : (
                  <CategoryCascadeSelect
                    categories={filteredCategories}
                    value={form.categoryId ?? ''}
                    onChange={v => patch({ categoryId: v })}
                    error={!!errors.categoryId}
                    onCreate={createCategory}
                  />
                )}
                {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId}</p>}
              </div>
            )}
          </div>

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
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tekrar Sıklığı">
                  <AppSelect
                    value={rec.frequency}
                    onChange={v => setRec(r => ({ ...r, frequency: v as RecurringFrequency }))}
                    options={FREQ_OPTIONS}
                    onOpenChange={onSelectOpen}
                  />
                </Field>
                {(rec.frequency === 'monthly' || rec.frequency === 'yearly') && (
                  <Field label="Ayın Günü">
                    <AppSelect
                      value={rec.dayOfMonth}
                      onChange={v => setRec(r => ({ ...r, dayOfMonth: v }))}
                      options={DAY_OPTIONS}
                      onOpenChange={onSelectOpen}
                    />
                  </Field>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Başlangıç Tarihi" error={errors.startDate}>
                  <Input
                    type="date"
                    value={rec.startDate}
                    onChange={e => setRec(r => ({ ...r, startDate: e.target.value }))}
                    error={errors.startDate}
                  />
                </Field>
                <Field label="Bitiş Tarihi" optional>
                  <Input
                    type="date"
                    value={rec.endDate}
                    onChange={e => setRec(r => ({ ...r, endDate: e.target.value }))}
                  />
                </Field>
              </div>
            </>
          ) : (
            <Field label="Tarih" error={errors.date}>
              <Input
                type="date"
                value={form.date}
                onChange={e => patch({ date: e.target.value })}
                error={errors.date}
              />
            </Field>
          )}

          {/* Ödeme tipi — abonelik + taksit tek segmentte, tarihin hemen
              altında. Eskiden gövdenin en altında iki ayrı kesikli kart
              olarak duruyor, çoğu ekranda kaydırmadan görünmüyorlardı. */}
          {canSubscription && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Ödeme tipi</Label>
                {installmentLocked ? (
                  <span className="text-xs text-muted-foreground">
                    Değişiklik tüm taksitlere uygulanır
                  </span>
                ) : convertibleTx && form.isInstallment ? (
                  <span className="text-xs text-muted-foreground">
                    Bu işlem 1. taksit olur
                  </span>
                ) : null}
              </div>

              <div className={cn(
                "grid gap-1 rounded-lg bg-muted p-1",
                payTypeOptions.length === 3 ? "grid-cols-3" : "grid-cols-2",
              )}>
                {payTypeOptions.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={installmentLocked}
                    aria-pressed={payType === key}
                    onClick={() => selectPayType(key)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all",
                      payType === key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                      installmentLocked && "cursor-default",
                    )}
                  >
                    <Icon className={cn("size-3.5", payType === key && "text-primary")} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Abonelik detayı — marka açıklamadan tanınır. */}
              {payType === 'subscription' && (
                <div className="rounded-lg border border-dashed p-4">
                  {subBrand ? (
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <BrandLogo brand={subBrand} name={subBrand.name} size={20} />
                      {subBrand.name} olarak tanındı — Abonelikler sayfasında görünür.
                    </span>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Marka otomatik tanınacak — Abonelikler sayfasında görünür.
                    </p>
                  )}
                </div>
              )}

              {/* Taksit detayı — sayı + taksit tutarları (elle düzenlenebilir). */}
              {form.isInstallment && (
                <div className="rounded-lg border border-dashed p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Taksit sayısı</span>
                    <input
                      type="number"
                      min={2}
                      max={60}
                      value={installments}
                      onChange={e => {
                        setInstallments(Math.min(60, Math.max(2, Number(e.target.value) || 2)))
                        setManualAmounts(null)
                      }}
                      className="w-20 h-9 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm text-center outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                    />
                    <span className="text-sm text-muted-foreground">taksit</span>
                  </div>
                  {parseCurrencyInput(amountStr) > 0 && (() => {
                    const total    = parseCurrencyInput(amountStr)
                    const cur      = (accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode
                    const rows     = manualAmounts ?? splitMoney(total, installments).map(toAmountStr)
                    const sum      = sumMoney(rows.map(s => parseCurrencyInput(s) || 0))
                    const sumDiff  = Math.round(sum * 100) !== Math.round(total * 100)
                    return (
                      <div className="flex flex-col gap-2 border-t border-dashed pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">
                            Aylık taksitler {manualAmounts ? '(elle düzenlendi)' : '(otomatik bölündü — düzenlenebilir)'}
                          </span>
                          {manualAmounts && (
                            <button
                              type="button"
                              onClick={() => setManualAmounts(null)}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              Otomatik böl
                            </button>
                          )}
                        </div>
                        <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5 pr-1">
                          {rows.map((val, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-32 shrink-0">
                                {i + 1}. taksit · {format(addMonths(parseISO(form.date || today()), i), 'MMM yyyy', { locale: tr })}
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={val}
                                onChange={e => {
                                  let raw = e.target.value.replace(/[^0-9,]/g, '')
                                  const fc = raw.indexOf(',')
                                  if (fc !== -1) raw = raw.slice(0, fc + 1) + raw.slice(fc + 1).replace(/,/g, '')
                                  const next = [...rows]
                                  next[i] = raw
                                  setManualAmounts(next)
                                  if (errors.installments) setErrors(prev => ({ ...prev, installments: '' }))
                                }}
                                aria-label={`${i + 1}. taksit tutarı`}
                                className="flex-1 h-8 rounded-md border border-input bg-background dark:bg-muted px-2.5 text-sm text-right outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                              />
                              <span className="text-xs text-muted-foreground w-8">{getCurrencySymbol(cur)}</span>
                            </div>
                          ))}
                        </div>
                        <p className={cn('text-xs', sumDiff ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground')}>
                          Toplam: {formatCurrency(sum, cur)}
                          {sumDiff && ` — girilen tutardan (${formatCurrency(total, cur)}) farklı`}
                        </p>
                        {errors.installments && <p className="text-xs text-destructive">{errors.installments}</p>}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
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
                onChange={id => patch({ recipientId: id })}
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

          {/* Tags — not on the recurring model (needs a Supabase column first) */}
          {!isRecurring && (
            <Field label="Etiketler" optional>
              <TagInput
                value={form.tags}
                onChange={tags => patch({ tags })}
                suggestions={tagSuggestions}
              />
            </Field>
          )}
        </div>

        {/* ── Oturum listesi (art arda ekleme) ───────────────────────────── */}
        {showSession && (
          <div className="border-t bg-muted/40">
            <div className="flex items-baseline justify-between px-6 pt-3 pb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Bu oturumda eklenenler ({session.length})
              </span>
              <span className="text-xs font-semibold tabular-nums">{sessionTotals}</span>
            </div>
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5 px-6 pb-3">
              {/* En yeni üstte — store dizisi bozulmadan ters çevrilir. */}
              {[...session].reverse().map(row => {
                const cat = row.categoryId ? categories.find(c => c.id === row.categoryId) : undefined
                const isEditing = sessionEditId === row.id
                return (
                  <div
                    key={row.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border bg-background dark:bg-card px-2.5 py-1.5",
                      isEditing && "border-primary ring-1 ring-primary/30",
                    )}
                  >
                    {cat
                      ? <CategoryIcon icon={cat.icon} color={cat.color} size={14} />
                      : <span className="size-6 shrink-0" />}
                    <span className="flex-1 truncate text-sm">{row.description}</span>
                    <span className={cn(
                      "text-sm font-semibold tabular-nums",
                      row.type === 'income' && "text-[var(--cf-income)]",
                    )}>
                      {row.type === 'income' ? '+' : row.type === 'expense' ? '−' : ''}
                      {formatCurrency(Math.abs(row.amount), row.currency)}
                    </span>
                    <span className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground">
                      {row.accountName}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {row.editable && (
                        <button
                          type="button"
                          onClick={() => editSessionRow(row)}
                          aria-label={`${row.description} satırını düzenle`}
                          title="Forma geri yükle"
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeSessionRow(row)}
                        aria-label={`${row.description} satırını sil`}
                        title="Sil"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
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
                : 'Kaydet'}
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
