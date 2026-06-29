'use client'

import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { useUIStore, useAccountStore, useCategoryStore, useTransactionStore, usePeopleStore, useDebtStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { Transaction, TransactionType, CurrencyCode, PersonRole, Person } from '@/types'
import { useShallow } from 'zustand/react/shallow'
import { Check, X, Plus } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/Select'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'expense' | 'income' | 'transfer'

const TABS: { key: Tab; label: string }[] = [
  { key: 'expense',  label: 'Gider'    },
  { key: 'income',   label: 'Gelir'    },
  { key: 'transfer', label: 'Transfer' },
]

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
    isInstallment: false,
    familyMemberId: undefined as string | null | undefined,
    recipientId:    undefined as string | null | undefined,
    isDebtPayment: false,
    debtId: undefined as string | undefined,
  }
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
  options: { value: string; label: string }[]
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
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

function DescriptionAutocomplete({
  value, onChange, onSelect, suggestions, categories, people, error,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (s: Suggestion) => void
  suggestions: Suggestion[]
  categories: { id: string; name: string; icon: string }[]
  people: Person[]
  error?: string
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

  useEffect(() => { setHighlighted(0) }, [filtered.length])

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
        autoFocus
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
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
                  {cat && <span>{cat.icon} {cat.name}</span>}
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
  const people    = allPeople.filter(p => p.role === role)

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

// ── Main modal ────────────────────────────────────────────────────────────────

export function TransactionFormModal() {
  const { modal, modalPayload, closeModal } = useUIStore()
  const accounts   = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories = useCategoryStore(s => s.categories)
  const transactions = useTransactionStore(s => s.transactions)
  const addTx        = useTransactionStore(s => s.add)
  const addGroup     = useTransactionStore(s => s.addInstallmentGroup)
  const updateTx     = useTransactionStore(s => s.update)
  const allPeople    = usePeopleStore(s => s.people)
  const activeDebts  = useDebtStore(s => s.debts.filter(d => !d.isSettled && d.direction === 'owe'))

  const open = modal === 'add-transaction' || modal === 'edit-transaction'
  const isEdit = modal === 'edit-transaction'

  const editingTx: Transaction | undefined = isEdit && modalPayload?.id
    ? transactions.find(t => t.id === modalPayload.id)
    : undefined

  const [tab, setTab]             = useState<Tab>('expense')
  const [form, setForm]           = useState(newForm())
  const [amountStr, setAmountStr] = useState('')
  const [installments, setInstallments] = useState(1)
  const [loading, setLoading]     = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

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

  // Reset / populate on open
  useEffect(() => {
    if (!open) {
      setForm(newForm()); setAmountStr(''); setInstallments(1); setErrors({})
      return
    }
    if (isEdit && editingTx) {
      setTab(editingTx.type as Tab)
      setForm({
        type:           editingTx.type as Tab,
        amount:         editingTx.amount,
        currency:       editingTx.currency,
        date:           editingTx.date,
        accountId:      editingTx.accountId,
        toAccountId:    editingTx.toAccountId,
        categoryId:     editingTx.categoryId ?? '',
        description:    editingTx.description,
        notes:          editingTx.notes,
        isInstallment:  editingTx.isInstallment,
        familyMemberId: editingTx.familyMemberId ?? undefined,
        recipientId:    editingTx.recipientId    ?? undefined,
        isDebtPayment:  editingTx.type === 'transfer' && !!editingTx.debtId && !editingTx.toAccountId,
        debtId:         editingTx.type === 'transfer' && !editingTx.toAccountId ? editingTx.debtId : undefined,
      })
      setAmountStr(new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(editingTx.amount))
      setInstallments(editingTx.installTotal ?? 1)
    } else {
      setTab('expense')
      const f = newForm()
      if (modalPayload?.accountId) f.accountId = modalPayload.accountId
      setForm(f)
    }
  }, [open])

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

  const filteredCategories = categories.filter(c => c.scope === tab)
  const accountOptions     = accounts.map(a => ({ value: a.id, label: a.name }))

  function validate(): boolean {
    const e: Record<string, string> = {}
    const amount = parseCurrencyInput(amountStr)
    if (!amount || amount <= 0)                      e.amount      = 'Geçerli bir tutar girin'
    if (!form.accountId)                             e.accountId   = 'Hesap seçin'
    if (!form.date)                                  e.date        = 'Tarih seçin'
    if (tab !== 'transfer' && !form.categoryId)                         e.categoryId  = 'Kategori seçin'
    if (tab === 'transfer' && !form.isDebtPayment && !form.toAccountId) e.toAccountId = 'Hedef hesap seçin'
    if (tab === 'transfer' && form.isDebtPayment && !form.debtId)       e.debtId      = 'Borç seçin'
    if (!form.description.trim())                    e.description = 'Açıklama girin'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setLoading(true)
    const amount   = parseCurrencyInput(amountStr)
    const account  = accounts.find(a => a.id === form.accountId)
    const currency = (account?.currency ?? 'TRY') as CurrencyCode
    const now      = new Date().toISOString()

    // Strip UI-only fields before building the stored transaction
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { isDebtPayment: _idp, ...formData } = form

    if (editingTx) {
      await updateTx(editingTx.id, {
        ...formData, type: tab as TransactionType, amount, currency, updatedAt: now,
        familyMemberId: formData.familyMemberId ?? null,
        recipientId:    formData.recipientId    ?? null,
      })

      // Reconcile debt paidAmount for edit
      const wasDebtPayment = editingTx.type === 'transfer' && !!editingTx.debtId && !editingTx.toAccountId
      const isDebtPaymentNow = tab === 'transfer' && form.isDebtPayment && !!formData.debtId
      const { recordPayment } = useDebtStore.getState()

      if (wasDebtPayment && isDebtPaymentNow) {
        if (editingTx.debtId === formData.debtId) {
          const delta = Math.round((amount - editingTx.amount) * 100) / 100
          if (delta !== 0) await recordPayment(formData.debtId!, delta)
        } else {
          // Debt changed: reverse old debt, apply to new debt
          await recordPayment(editingTx.debtId!, -editingTx.amount)
          await recordPayment(formData.debtId!, amount)
        }
      } else if (wasDebtPayment && !isDebtPaymentNow) {
        await recordPayment(editingTx.debtId!, -editingTx.amount)
      } else if (!wasDebtPayment && isDebtPaymentNow) {
        await recordPayment(formData.debtId!, amount)
      }
    } else {
      const base = { ...formData, type: tab as TransactionType, amount, currency }
      if (formData.isInstallment && installments > 1) {
        await addGroup(base, installments)
      } else {
        await addTx({ ...base, id: crypto.randomUUID(), isInstallment: false, createdAt: now, updatedAt: now })
      }
      if (tab === 'transfer' && form.isDebtPayment && formData.debtId) {
        await useDebtStore.getState().recordPayment(formData.debtId, amount)
      }
    }
    setLoading(false)
    closeModal()
  }

  const patch = (p: Partial<ReturnType<typeof newForm>>) => setForm(f => ({ ...f, ...p }))

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
            <DialogTitle>{isEdit ? 'İşlemi Düzenle' : 'İşlem Ekle'}</DialogTitle>
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

        {/* ── Form body ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 px-6 py-5 overflow-y-auto max-h-[65vh]">

          {/* Description */}
          <Field label="Açıklama" error={errors.description}>
            <DescriptionAutocomplete
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

          {/* Amount */}
          <Field label="Tutar" error={errors.amount}>
            <CurrencyInput value={amountStr} onChange={setAmountStr} error={errors.amount} />
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

            {tab === 'transfer' ? (
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
                />
              </Field>
            )}
          </div>

          {/* Date */}
          <Field label="Tarih" error={errors.date}>
            <Input
              type="date"
              value={form.date}
              onChange={e => patch({ date: e.target.value })}
              error={errors.date}
            />
          </Field>

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

          {/* Installment */}
          {tab === 'expense' && !isEdit && (
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
                    onChange={e => setInstallments(Number(e.target.value))}
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
