'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useUIStore, useAccountStore, useCategoryStore, useTransactionStore, usePeopleStore } from '@/store'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import type { Transaction, TransactionType, CurrencyCode, PersonRole, Person } from '@/types'
import { useShallow } from 'zustand/react/shallow'
import { PersonAvatar } from '@/components/people/PersonAvatar'

type Tab = 'expense' | 'income' | 'transfer'

const TAB_LABELS: Record<Tab, string> = {
  expense:  'Gider',
  income:   'Gelir',
  transfer: 'Transfer',
}

function newTx(): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    type: 'expense',
    amount: 0,
    currency: 'TRY',
    date: today(),
    accountId: '',
    categoryId: '',
    description: '',
    isInstallment: false,
  }
}

interface Suggestion {
  description: string
  categoryId: string
  familyMemberId?: string
  recipientId?: string
}

interface DescriptionAutocompleteProps {
  value: string
  onChange: (v: string) => void
  onSelect: (s: Suggestion) => void
  suggestions: Suggestion[]
  categories: { id: string; name: string; icon: string }[]
  people: Person[]
  error?: string
}

function DescriptionAutocomplete({
  value, onChange, onSelect, suggestions, categories, people, error,
}: DescriptionAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return suggestions
      .filter(s => s.description.toLowerCase().includes(q))
      .slice(0, 6)
  }, [value, suggestions])

  useEffect(() => { setHighlighted(0) }, [filtered.length])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && filtered[highlighted]) {
      e.preventDefault()
      onSelect(filtered[highlighted])
      setOpen(false)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <label className="block text-[9px] font-mono tracking-[0.12em] uppercase text-muted mb-1.5">
        Açıklama
      </label>
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onKeyDown={handleKeyDown}
        onFocus={() => value.trim() && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Migros, Maaş, Kira..."
        className={[
          'w-full border px-3 py-2 text-sm bg-surface text-ink font-sans',
          'placeholder:text-muted focus:outline-none transition-colors',
          error
            ? 'border-danger focus:border-danger'
            : 'border-line focus:border-ink',
        ].join(' ')}
      />
      {error && (
        <p className="mt-1 text-[10px] font-mono text-danger">{error}</p>
      )}

      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full border border-t-0 border-line bg-surface">
          {filtered.map((s, i) => {
            const cat = categories.find(c => c.id === s.categoryId)
            return (
              <button
                key={s.description}
                type="button"
                onMouseDown={() => {
                  onSelect(s)
                  setOpen(false)
                }}
                className={[
                  'w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors',
                  i === highlighted ? 'bg-ground' : 'hover:bg-ground',
                ].join(' ')}
              >
                <span className="text-sm truncate flex-1">{s.description}</span>
                <span className="flex-shrink-0 flex items-center gap-2">
                  {s.familyMemberId && (() => {
                    const p = people.find(x => x.id === s.familyMemberId)
                    return p ? (
                      <span className="flex items-center gap-1">
                        <PersonAvatar person={p} size="xs" />
                        <span className="text-[10px] text-muted">{p.name}</span>
                      </span>
                    ) : null
                  })()}
                  {s.recipientId && (() => {
                    const p = people.find(x => x.id === s.recipientId)
                    return p ? (
                      <span className="flex items-center gap-1">
                        <PersonAvatar person={p} size="xs" />
                        <span className="text-[10px] text-muted">{p.name}</span>
                      </span>
                    ) : null
                  })()}
                  {cat && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-muted">
                      <span>{cat.icon}</span>
                      <span className="uppercase tracking-wide">{cat.name}</span>
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const PERSON_ROLE_LABELS: Record<PersonRole, string> = {
  family_member: 'Aile Üyesi',
  recipient:     'Alıcı',
}

function PersonSelectField({
  role,
  value,
  onChange,
}: {
  role: PersonRole
  value: string | null | undefined
  onChange: (id: string | undefined) => void
}) {
  const allPeople = usePeopleStore(s => s.people)
  const addPerson = usePeopleStore(s => s.add)
  const people    = allPeople.filter(p => p.role === role)
  const [adding, setAdding]     = useState(false)
  const [newName, setNewName]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    setAddError(null)
    try {
      const person = await addPerson(name, role)
      onChange(person.id)
      setAdding(false)
      setNewName('')
    } catch {
      setAddError('Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  const label = PERSON_ROLE_LABELS[role]

  const selectedPerson = people.find(p => p.id === value)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="block text-[9px] font-mono tracking-[0.12em] uppercase text-muted">
        {label} <span className="normal-case font-normal tracking-normal">(opsiyonel)</span>
      </label>

      {adding ? (
        /* Compact add row: input + ✓ + ✕ icon buttons — fits in a narrow grid column */
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { setAdding(false); setNewName(''); setAddError(null) }
            }}
            placeholder={`${label} adı...`}
            className="flex-1 min-w-0 border border-line px-2 py-[7px] text-sm bg-surface text-ink focus:border-accent outline-none"
            disabled={saving}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="w-8 h-[33px] flex-shrink-0 flex items-center justify-center text-ok border border-line hover:bg-ground disabled:opacity-40 transition-colors font-bold text-sm"
            title="Kaydet"
          >{saving ? '…' : '✓'}</button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); setAddError(null) }}
            className="w-8 h-[33px] flex-shrink-0 flex items-center justify-center text-muted border border-line hover:bg-ground transition-colors text-sm"
            title="İptal"
          >✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {selectedPerson && (
            <PersonAvatar person={selectedPerson} size="sm" className="flex-shrink-0" />
          )}
          <select
            value={value ?? ''}
            onChange={e => {
              if (e.target.value === '__NEW__') { setAdding(true); return }
              onChange(e.target.value || undefined)
            }}
            className="flex-1 min-w-0 border border-line px-2 py-[7px] text-sm bg-surface text-ink focus:border-accent outline-none"
          >
            <option value="">— Seçin —</option>
            {people.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="__NEW__">+ Yeni ekle…</option>
          </select>
        </div>
      )}

      {addError && <p className="text-[10px] font-mono text-danger">{addError}</p>}
    </div>
  )
}

export function TransactionFormModal() {
  const { modal, modalPayload, closeModal } = useUIStore()
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)
  const transactions  = useTransactionStore(s => s.transactions)
  const addTx         = useTransactionStore(s => s.add)
  const addGroup      = useTransactionStore(s => s.addInstallmentGroup)
  const updateTx      = useTransactionStore(s => s.update)
  const editingTx: Transaction | undefined =
    modal === 'edit-transaction' && modalPayload?.id
      ? transactions.find(t => t.id === modalPayload.id)
      : undefined

  const [tab, setTab]               = useState<Tab>('expense')
  const [form, setForm]             = useState(newTx())
  const [amountStr, setAmountStr]   = useState('')
  const [installments, setInstallments] = useState(1)
  const [loading, setLoading]       = useState(false)
  const [errors, setErrors]         = useState<Record<string, string>>({})

  const open = modal === 'add-transaction' || modal === 'edit-transaction'

  useEffect(() => {
    if (!open) {
      setForm(newTx())
      setAmountStr('')
      setInstallments(1)
      setErrors({})
    } else if (modal === 'edit-transaction' && modalPayload?.id) {
      const tx = transactions.find(t => t.id === modalPayload.id)
      if (tx) {
        setTab(tx.type as Tab)
        setForm({
          type: tx.type,
          amount: tx.amount,
          currency: tx.currency,
          date: tx.date,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId,
          categoryId: tx.categoryId ?? '',
          description: tx.description,
          notes: tx.notes,
          isInstallment: tx.isInstallment,
          familyMemberId: tx.familyMemberId ?? undefined,
          recipientId: tx.recipientId ?? undefined,
        })
        setAmountStr(new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(tx.amount))
        setInstallments(tx.installTotal ?? 1)
      }
    } else {
      setTab('expense')
      if (modalPayload?.accountId) {
        setForm(f => ({ ...f, accountId: modalPayload!.accountId! }))
      }
    }
  }, [open])

  const allPeople = usePeopleStore(s => s.people)

  // Build suggestions: unique descriptions for current tab type, most recent data per description
  const suggestions = useMemo<Suggestion[]>(() => {
    const map = new Map<string, { description: string; categoryId: string; date: string; familyMemberId?: string; recipientId?: string }>()
    transactions
      .filter(tx => tx.type === tab && tx.description?.trim())
      .forEach(tx => {
        const key = tx.description.trim().toLowerCase()
        const existing = map.get(key)
        if (!existing || tx.date > existing.date) {
          map.set(key, {
            description:    tx.description.trim(),
            categoryId:     tx.categoryId ?? '',
            date:           tx.date,
            familyMemberId: tx.familyMemberId ?? undefined,
            recipientId:    tx.recipientId    ?? undefined,
          })
        }
      })
    return Array.from(map.values()).map(({ description, categoryId, familyMemberId, recipientId }) => ({
      description, categoryId, familyMemberId, recipientId,
    }))
  }, [transactions, tab])

  const filteredCategories = categories.filter(
    c => c.scope === tab || c.scope === 'both',
  )

  const accountOptions  = accounts.map(a => ({ value: a.id, label: a.name }))
  const categoryOptions = filteredCategories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` }))

  function validate(): boolean {
    const e: Record<string, string> = {}
    const amount = parseCurrencyInput(amountStr)
    if (!amount || amount <= 0)      e.amount      = 'Geçerli bir tutar girin'
    if (!form.accountId)             e.accountId   = 'Hesap seçin'
    if (!form.date)                  e.date        = 'Tarih seçin'
    if (tab !== 'transfer' && !form.categoryId)  e.categoryId  = 'Kategori seçin'
    if (tab === 'transfer' && !form.toAccountId) e.toAccountId = 'Hedef hesap seçin'
    if (!form.description.trim())    e.description = 'Açıklama girin'
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

    if (editingTx) {
      await updateTx(editingTx.id, {
        ...form,
        type: tab as TransactionType,
        amount,
        currency,
        updatedAt: now,
        // Explicitly null to clear if deselected (Dexie ignores undefined in updates)
        familyMemberId: form.familyMemberId ?? null,
        recipientId:    form.recipientId    ?? null,
      })
    } else {
      const base = { ...form, type: tab as TransactionType, amount, currency }
      if (form.isInstallment && installments > 1) {
        await addGroup(base, installments)
      } else {
        const tx: Transaction = { ...base, id: crypto.randomUUID(), isInstallment: false, createdAt: now, updatedAt: now }
        await addTx(tx)
      }
    }

    setLoading(false)
    closeModal()
  }

  return (
    <Modal open={open} onClose={closeModal} title={editingTx ? 'İşlemi Düzenle' : 'İşlem Ekle'} size="md">
      {/* Tab selector */}
      <div className="flex border border-line mb-5">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              setForm(f => ({ ...f, type: t, categoryId: '', toAccountId: undefined }))
            }}
            className={[
              'flex-1 py-2 text-xs font-mono font-semibold tracking-wide uppercase transition-colors',
              tab === t ? 'bg-accent/[0.15] text-accent border-b-2 border-accent' : 'text-muted hover:text-ink hover:bg-ground',
            ].join(' ')}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {/* Description — first, with autocomplete */}
        <DescriptionAutocomplete
          value={form.description}
          onChange={v => setForm(f => ({ ...f, description: v }))}
          onSelect={s => setForm(f => ({
            ...f,
            description:    s.description,
            categoryId:     s.categoryId,
            familyMemberId: s.familyMemberId,
            recipientId:    s.recipientId,
          }))}
          suggestions={suggestions}
          categories={categories}
          people={allPeople}
          error={errors.description}
        />

        {/* Amount */}
        <CurrencyInput
          label="Tutar"
          value={amountStr}
          onChange={setAmountStr}
          error={errors.amount}
        />

        <div className="grid grid-cols-2 gap-3">
          {/* Account */}
          <Select
            label="Hesap"
            value={form.accountId}
            onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
            options={accountOptions}
            placeholder="Seçin..."
            error={errors.accountId}
          />

          {/* Category or To Account */}
          {tab === 'transfer' ? (
            <Select
              label="Hedef Hesap"
              value={form.toAccountId ?? ''}
              onChange={e => setForm(f => ({ ...f, toAccountId: e.target.value }))}
              options={accountOptions.filter(a => a.value !== form.accountId)}
              placeholder="Seçin..."
              error={errors.toAccountId}
            />
          ) : (
            <Select
              label="Kategori"
              value={form.categoryId ?? ''}
              onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
              options={categoryOptions}
              placeholder="Seçin..."
              error={errors.categoryId}
            />
          )}
        </div>

        {/* Date */}
        <Input
          label="Tarih"
          type="date"
          value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          error={errors.date}
        />

        {/* Notes */}
        <Input
          label="Not (opsiyonel)"
          value={form.notes ?? ''}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Ek bilgi..."
        />

        {/* Person tags */}
        <div className="grid grid-cols-2 gap-3">
          <PersonSelectField
            key={`family-${modal}-${modalPayload?.id ?? 'new'}`}
            role="family_member"
            value={form.familyMemberId}
            onChange={id => setForm(f => ({ ...f, familyMemberId: id }))}
          />
          <PersonSelectField
            key={`recipient-${modal}-${modalPayload?.id ?? 'new'}`}
            role="recipient"
            value={form.recipientId}
            onChange={id => setForm(f => ({ ...f, recipientId: id }))}
          />
        </div>

        {/* Installment toggle */}
        {tab === 'expense' && !editingTx && (
          <div className="flex flex-col gap-2 pt-1 border-t border-line">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isInstallment}
                onChange={e => setForm(f => ({ ...f, isInstallment: e.target.checked }))}
                className="w-3 h-3 accent-ink"
              />
              <span className="text-xs font-mono uppercase tracking-wide text-muted">Taksitli ödeme</span>
            </label>
            {form.isInstallment && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted font-mono">Taksit sayısı</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={installments}
                  onChange={e => setInstallments(Number(e.target.value))}
                  className="w-20 border border-line px-2 py-1.5 text-sm font-mono text-center bg-surface text-ink focus:border-ink outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" onClick={closeModal} fullWidth>İptal</Button>
          <Button onClick={handleSubmit} loading={loading} fullWidth>Kaydet</Button>
        </div>
      </div>
    </Modal>
  )
}
