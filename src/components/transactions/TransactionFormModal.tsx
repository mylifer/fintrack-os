'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useId } from 'react'
import { useUIStore, useAccountStore, useCategoryStore, useTransactionStore, usePeopleStore, useDebtStore, useRecurringStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { parseCurrencyInput, getCurrencySymbol } from '@/lib/utils/currency'
import { toBaseTry } from '@/lib/utils/fx'
import { today } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { Transaction, TransactionType, CurrencyCode, PersonRole, Person, ModalPayload, RecurringTransaction, RecurringFrequency, Category } from '@/types'
import { useShallow } from 'zustand/react/shallow'
import { Check, X, Plus } from 'lucide-react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { TagInput } from '@/components/transactions/TagInput'
import { useTags } from '@/lib/hooks/useTags'
import { dedupeTags } from '@/lib/utils/tags'
import { SUBSCRIPTION_TAG, isSubscriptionTag, detectBrand } from '@/lib/subscriptions/brands'
import { BrandLogo } from '@/components/subscriptions/BrandLogo'

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

function newForm() {
  return {
    type: 'expense' as Tab,
    amount: 0,
    currency: 'TRY' as CurrencyCode,
    date: today(),
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

interface Suggestion {
  description:     string
  categoryId:      string
  familyMemberId?: string
  recipientId?:    string
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
          "h-9 w-full rounded-md",
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
  value, onChange, onSelect, suggestions, categories, people, error, autoFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (s: Suggestion) => void
  suggestions: Suggestion[]
  categories: { id: string; name: string; icon: string; color: string }[]
  people: Person[]
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
                  {famPerson && <span>{famPerson.name}</span>}
                  {recPerson && <span>{recPerson.name}</span>}
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
  role, value, onChange, onSelectOpen,
}: {
  role: PersonRole
  value: string | null | undefined
  onChange: (id: string | undefined) => void
  onSelectOpen?: (open: boolean) => void
}) {
  const allPeople = usePeopleStore(s => s.people)
  const addPerson = usePeopleStore(s => s.add)
  // Archived people stay resolvable on old transactions but are not selectable —
  // unless the transaction being edited already points at one (keep it visible).
  const people    = allPeople.filter(p => p.role === role && (!p.isArchived || p.id === value))

  const [adding, setAdding]   = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving]   = useState(false)

  const label = role === 'family_member' ? 'Aile Üyesi' : 'Alıcı'

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    try {
      const person = await addPerson(name, role)
      onChange(person.id)
      setAdding(false)
      setNewName('')
    } catch (err) {
      console.error('[person:add]', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Field label={label} optional>
      {adding ? (
        <div className="flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')  handleAdd()
              if (e.key === 'Escape') { setAdding(false); setNewName('') }
            }}
            placeholder={`${label} adı...`}
            disabled={saving}
            className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="h-9 w-9 flex items-center justify-center rounded-md border border-input text-green-600 hover:bg-accent disabled:opacity-40 transition-colors"
          >
            <Check className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName('') }}
            className="h-9 w-9 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex gap-1">
          <Select
            value={value ?? ''}
            onValueChange={v => {
              if (v === '__NEW__') { setAdding(true); return }
              onChange(v || undefined)
            }}
            onOpenChange={onSelectOpen}
          >
            <SelectTrigger className="h-9 flex-1 rounded-md">
              <SelectValue placeholder="— Seçin —" />
            </SelectTrigger>
            <SelectContent>
              {people.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
              <SelectItem value="__NEW__">+ Yeni ekle…</SelectItem>
            </SelectContent>
          </Select>
          {value && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="h-9 w-9 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent transition-colors"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </Field>
  )
}

// ── Turkish amount formatter ──────────────────────────────────────────────────
// amountStr stores raw digits + optional single comma (e.g. "1250,50")
// Display adds dots as thousands separators (e.g. "1.250,50")

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
    ? transactions.find(t => t.id === modalPayload.id)
    : undefined
  const editingRec: RecurringTransaction | undefined = modal === 'edit-recurring' && modalPayload?.id
    ? recurring.find(r => r.id === modalPayload.id)
    : undefined

  // Lazy initializers run exactly once — the component is remounted (keyed) per
  // open, so first-render values (editingTx / modalPayload) are the correct seed.
  const [tab, setTab]             = useState<Tab>(() =>
    editingRec ? editingRec.type as Tab : isEdit && editingTx ? editingTx.type as Tab : 'expense')
  const [form, setForm]           = useState(() => buildInitialForm(isEdit, editingTx, editingRec, modalPayload))
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
    const seed = editingRec?.amount ?? (isEdit && editingTx ? editingTx.amount : undefined)
    return seed !== undefined
      ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, useGrouping: false }).format(Math.abs(seed))
      : ''
  })
  // Sign of the amount. Always +1 except when editing a refund (negative
  // expense), where we preserve the negative so a save doesn't flip it positive.
  const [amountSign, setAmountSign] = useState(() => isEdit && editingTx && editingTx.amount < 0 ? -1 : 1)
  const [installments, setInstallments] = useState(() => isEdit && editingTx ? (editingTx.installTotal ?? 1) : 1)
  const [loading, setLoading]     = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

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
  const suggestions = useMemo<Suggestion[]>(() => {
    const map = new Map<string, { description: string; categoryId: string; date: string; familyMemberId?: string; recipientId?: string }>()
    transactions
      .filter(tx => tx.type === tab && tx.description?.trim())
      .forEach(tx => {
        const key = tx.description.trim().toLowerCase()
        const ex  = map.get(key)
        if (!ex || tx.date > ex.date) {
          map.set(key, {
            description:    tx.description.trim(),
            categoryId:     tx.categoryId ?? '',
            date:           tx.date,
            familyMemberId: tx.familyMemberId ?? undefined,
            recipientId:    tx.recipientId    ?? undefined,
          })
        }
      })
    return Array.from(map.values()).map(({ description, categoryId, familyMemberId, recipientId }) =>
      ({ description, categoryId, familyMemberId, recipientId }))
  }, [transactions, tab])

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

  function validate(): boolean {
    const e: Record<string, string> = {}
    // Magnitude only — the sign is carried separately (amountSign). Negative
    // `expense` amounts (refunds) are allowed; the input holds the magnitude.
    const amount = parseCurrencyInput(amountStr)
    if (!amount || amount <= 0)                      e.amount      = 'Geçerli bir tutar girin'
    if (!form.accountId)                             e.accountId   = 'Hesap seçin'
    if (tab !== 'transfer' && !form.categoryId)                         e.categoryId  = 'Kategori seçin'
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

  async function handleSubmit() {
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

    if (editingTx) {
      await updateTx(editingTx.id, {
        ...formData, type: tab as TransactionType, amount, currency, updatedAt: now,
        categoryId:     formData.categoryId     || undefined,
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
    } else {
      const base = {
        ...formData,
        type:        tab as TransactionType,
        amount,
        currency,
        categoryId:  formData.categoryId  || undefined,
        toAccountId: formData.toAccountId || undefined,
        tags:        cleanTags.length ? cleanTags : undefined,
      }
      if (formData.isInstallment && installments > 1) {
        await addGroup(base, installments)
      } else {
        await addTx({ ...base, id: crypto.randomUUID(), isInstallment: false, createdAt: now, updatedAt: now })
      }
      if (tab === 'transfer' && form.isDebtPayment && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amountTry)
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

  return (
    <Dialog open={open} onOpenChange={v => !v && closeModal()}>
      <DialogContent
        className="sm:max-w-lg gap-0 p-0 overflow-hidden"
        showCloseButton={false}
        onInteractOutside={(e) => {
          if (selectWasOpenRef.current) { selectWasOpenRef.current = false; e.preventDefault() }
        }}
      >

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle>
              {isRecurring
                ? (isEdit ? 'Tekrarlayan İşlemi Düzenle' : 'Tekrarlayan İşlem Ekle')
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
              {isFocused && amountStr && (
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
        <div className="flex flex-col gap-4 px-6 py-5 overflow-y-auto max-h-[55vh]">

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
              autoFocus={!isRecurring}
              value={form.description}
              onChange={v => patch({ description: v })}
              onSelect={s => patch({
                description:    s.description,
                categoryId:     s.categoryId,
                familyMemberId: s.familyMemberId,
                recipientId:    s.recipientId,
              })}
              suggestions={suggestions}
              categories={categories}
              people={allPeople}
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
                  <span className={cn("text-sm font-medium", (errors.toAccountId || errors.debtId) && "text-destructive")}>
                    Hedef
                  </span>
                  <div className="flex rounded border border-input overflow-hidden text-[11px]">
                    <button
                      type="button"
                      onClick={() => patch({ isDebtPayment: false, debtId: undefined })}
                      className={cn(
                        "px-2 py-0.5 transition-colors",
                        !form.isDebtPayment ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Hesap
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ isDebtPayment: true, toAccountId: undefined })}
                      className={cn(
                        "px-2 py-0.5 transition-colors border-l border-input",
                        form.isDebtPayment ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Borç
                    </button>
                  </div>
                </div>
                {form.isDebtPayment ? (
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
              <Field label="Kategori" error={errors.categoryId}>
                <CategoryCascadeSelect
                  categories={filteredCategories}
                  value={form.categoryId ?? ''}
                  onChange={v => patch({ categoryId: v })}
                  error={!!errors.categoryId}
                  onCreate={async name => {
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
                  }}
                />
              </Field>
            )}
          </div>

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

          {/* People */}
          {tab !== 'transfer' && (
            <div className="grid grid-cols-2 gap-3">
              <PersonField
                key={`fam-${modal}-${modalPayload?.id ?? 'new'}`}
                role="family_member"
                value={form.familyMemberId}
                onChange={id => patch({ familyMemberId: id })}
                onSelectOpen={onSelectOpen}
              />
              <PersonField
                key={`rec-${modal}-${modalPayload?.id ?? 'new'}`}
                role="recipient"
                value={form.recipientId}
                onChange={id => patch({ recipientId: id })}
                onSelectOpen={onSelectOpen}
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

          {/* Subscription toggle (expenses only) */}
          {!isRecurring && tab === 'expense' && (
            <div className="rounded-lg border border-dashed p-4 flex flex-col gap-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isSubscription}
                  onChange={e => toggleSubscription(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                />
                <span className="text-sm font-medium">Abonelik</span>
                {isSubscription && subBrand && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <BrandLogo brand={subBrand} name={subBrand.name} size={20} />
                    {subBrand.name} olarak tanındı
                  </span>
                )}
              </label>
              {isSubscription && !subBrand && (
                <p className="text-xs text-muted-foreground">
                  Marka otomatik tanınacak — Abonelikler sayfasında görünür.
                </p>
              )}
            </div>
          )}

          {/* Installment */}
          {!isRecurring && tab === 'expense' && !isEdit && (
            <div className="rounded-lg border border-dashed p-4 flex flex-col gap-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.isInstallment}
                  onChange={e => patch({ isInstallment: e.target.checked })}
                  className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                />
                <span className="text-sm font-medium">Taksitli ödeme</span>
              </label>
              {form.isInstallment && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Taksit sayısı</span>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={installments}
                    onChange={e => setInstallments(Math.min(60, Math.max(2, Number(e.target.value) || 2)))}
                    className="w-20 h-9 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm text-center outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                  />
                  <span className="text-sm text-muted-foreground">taksit</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={closeModal} disabled={loading}>
            İptal
          </Button>
          <Button onClick={handleSubmit} loading={loading} disabled={loading}>
            {isEdit ? 'Güncelle' : 'Kaydet'}
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
