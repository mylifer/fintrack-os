'use client'

import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header }             from '@/components/layout/Header'
import { Button }             from '@/components/ui/button'
import { Modal }              from '@/components/ui/Modal'
import { Input }              from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput }      from '@/components/ui/CurrencyInput'
import { EmptyState }         from '@/components/ui/EmptyState'
import { Badge }              from '@/components/ui/Badge'
import { Card, CardContent }  from '@/components/ui/card'
import {
  useRecurringStore, useAccountStore, useCategoryStore,
  useTransactionStore, usePeopleStore,
} from '@/store'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { today }              from '@/lib/utils/date'
import { useShallow }         from 'zustand/react/shallow'
import type {
  RecurringTransaction, RecurringFrequency,
  TransactionType, CurrencyCode,
} from '@/types'

/* ── Constants ─────────────────────────────────────────────────────── */

const FREQ_OPTIONS = [
  { value: 'daily',   label: 'Günlük' },
  { value: 'weekly',  label: 'Haftalık' },
  { value: 'monthly', label: 'Aylık' },
  { value: 'yearly',  label: 'Yıllık' },
]

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  daily:   'Günlük',
  weekly:  'Haftalık',
  monthly: 'Aylık',
  yearly:  'Yıllık',
}

const TYPE_OPTIONS = [
  { value: 'expense',  label: 'Gider' },
  { value: 'income',   label: 'Gelir' },
  { value: 'transfer', label: 'Transfer' },
]

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}. gün`,
}))

/* ── Empty form ─────────────────────────────────────────────────────── */

function emptyForm() {
  return {
    name:        '',
    type:        'expense' as TransactionType,
    amountStr:   '',
    accountId:   '',
    toAccountId: '',
    categoryId:  '',
    description: '',
    notes:       '',
    frequency:   'monthly' as RecurringFrequency,
    dayOfMonth:  '1',
    startDate:   today(),
    endDate:     '',
  }
}

type FormState = ReturnType<typeof emptyForm>

/* ── Page ───────────────────────────────────────────────────────────── */

export default function RecurringPage() {
  const { recurring, add, update, remove, toggleActive, getDue, markGenerated } = useRecurringStore()
  const addTransaction  = useTransactionStore(s => s.add)
  const accounts        = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories      = useCategoryStore(s => s.categories)
  const people          = usePeopleStore(s => s.people)

  const todayStr = today()

  const [showForm, setShowForm]           = useState(false)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [form, setForm]                   = useState<FormState>(emptyForm())
  const [loading, setLoading]             = useState(false)
  const [generatingId, setGeneratingId]   = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const due     = getDue(todayStr)
  const active  = recurring.filter(r => r.isActive && !due.some(d => d.id === r.id))
  const paused  = recurring.filter(r => !r.isActive)

  const accountOptions  = accounts.map(a => ({ value: a.id, label: a.name }))
  const categoryOptions = useMemo(
    () => categories
      .filter(c => c.scope === form.type || c.scope === 'both')
      .map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
    [categories, form.type],
  )

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(r: RecurringTransaction) {
    setEditingId(r.id)
    setForm({
      name:        r.name,
      type:        r.type,
      amountStr:   new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(r.amount),
      accountId:   r.accountId,
      toAccountId: r.toAccountId ?? '',
      categoryId:  r.categoryId ?? '',
      description: r.description,
      notes:       r.notes ?? '',
      frequency:   r.frequency,
      dayOfMonth:  String(r.dayOfMonth ?? 1),
      startDate:   r.startDate,
      endDate:     r.endDate ?? '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  async function handleSave() {
    const amount = parseCurrencyInput(form.amountStr)
    if (!form.name.trim() || !amount || !form.accountId || !form.startDate) return
    if (form.type === 'transfer' && !form.toAccountId) return
    if (form.type !== 'transfer' && !form.categoryId) return

    setLoading(true)
    const account  = accounts.find(a => a.id === form.accountId)
    const currency = (account?.currency ?? 'TRY') as CurrencyCode

    if (editingId) {
      await update(editingId, {
        name:        form.name.trim(),
        type:        form.type,
        amount,
        currency,
        accountId:   form.accountId,
        toAccountId: form.type === 'transfer' ? form.toAccountId : undefined,
        categoryId:  form.type !== 'transfer' ? form.categoryId : undefined,
        description: form.description.trim() || form.name.trim(),
        notes:       form.notes || undefined,
        frequency:   form.frequency,
        dayOfMonth:  form.frequency !== 'daily' && form.frequency !== 'weekly'
          ? Number(form.dayOfMonth)
          : undefined,
        endDate:     form.endDate || undefined,
      })
    } else {
      const r: RecurringTransaction = {
        id:          crypto.randomUUID(),
        name:        form.name.trim(),
        type:        form.type,
        amount,
        currency,
        accountId:   form.accountId,
        toAccountId: form.type === 'transfer' ? form.toAccountId : undefined,
        categoryId:  form.type !== 'transfer' ? form.categoryId : undefined,
        description: form.description.trim() || form.name.trim(),
        notes:       form.notes || undefined,
        frequency:   form.frequency,
        dayOfMonth:  form.frequency !== 'daily' && form.frequency !== 'weekly'
          ? Number(form.dayOfMonth)
          : undefined,
        startDate:   form.startDate,
        endDate:     form.endDate || undefined,
        nextDueDate: form.startDate,
        isActive:    true,
        createdAt:   new Date().toISOString(),
      }
      await add(r)
    }

    closeForm()
    setLoading(false)
  }

  async function handleGenerate(r: RecurringTransaction) {
    setGeneratingId(r.id)
    const now = new Date().toISOString()
    await addTransaction({
      id:            crypto.randomUUID(),
      type:          r.type,
      amount:        r.amount,
      currency:      r.currency,
      date:          r.nextDueDate,
      accountId:     r.accountId,
      toAccountId:   r.toAccountId,
      categoryId:    r.categoryId,
      description:   r.description,
      notes:         r.notes,
      isInstallment: false,
      familyMemberId: r.familyMemberId,
      recipientId:   r.recipientId,
      createdAt:     now,
      updatedAt:     now,
    })
    await markGenerated(r.id, todayStr)
    setGeneratingId(null)
  }

  return (
    <>
      <Header title="Tekrarlayan İşlemler" action={{ label: 'Ekle', onClick: openAdd }} />

      <div className="p-6 lg:p-8 flex flex-col gap-6">

        {/* ── Pending (due) ─────────────────────────────────────────── */}
        {due.length > 0 && (
          <section>
            <div className="text-xs font-medium tracking-wide uppercase text-amber font-semibold mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block" />
              Bekleyen — {due.length} işlem
            </div>
            <Card className="gap-0 py-0">
              <CardContent className="p-0 divide-y divide-border">
              {due.map(r => (
                <DueRow
                  key={r.id}
                  r={r}
                  accounts={accounts}
                  categories={categories}
                  isGenerating={generatingId === r.id}
                  onGenerate={() => handleGenerate(r)}
                  onSkip={() => markGenerated(r.id, todayStr)}
                />
              ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Active ────────────────────────────────────────────────── */}
        <section>
          <div className="text-xs font-medium tracking-wide uppercase text-muted font-semibold mb-2">
            Aktif — {active.length}
          </div>
          {recurring.filter(r => r.isActive).length === 0 && due.length === 0 ? (
            <EmptyState
              icon="↻"
              title="Tekrarlayan işlem yok"
              description="Kira, maaş, abonelik gibi düzenli işlemlerinizi buradan takip edin."
              action={<Button size="sm" onClick={openAdd}>Ekle</Button>}
            />
          ) : active.length > 0 ? (
            <Card className="gap-0 py-0">
              <CardContent className="p-0 divide-y divide-border">
              {active.map(r => (
                <RecurringRow
                  key={r.id}
                  r={r}
                  accounts={accounts}
                  categories={categories}
                  confirmDeleteId={confirmDeleteId}
                  onEdit={() => openEdit(r)}
                  onToggle={() => toggleActive(r.id)}
                  onDelete={() => remove(r.id)}
                  onConfirmDelete={() => setConfirmDeleteId(r.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              ))}
              </CardContent>
            </Card>
          ) : null}
        </section>

        {/* ── Paused ────────────────────────────────────────────────── */}
        {paused.length > 0 && (
          <section>
            <div className="text-xs font-medium tracking-wide uppercase text-muted font-semibold mb-2">
              Duraklatıldı — {paused.length}
            </div>
            <Card className="gap-0 py-0 opacity-60">
              <CardContent className="p-0 divide-y divide-border">
              {paused.map(r => (
                <RecurringRow
                  key={r.id}
                  r={r}
                  accounts={accounts}
                  categories={categories}
                  confirmDeleteId={confirmDeleteId}
                  onEdit={() => openEdit(r)}
                  onToggle={() => toggleActive(r.id)}
                  onDelete={() => remove(r.id)}
                  onConfirmDelete={() => setConfirmDeleteId(r.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                />
              ))}
              </CardContent>
            </Card>
          </section>
        )}

      </div>

      {/* ── Form Modal ────────────────────────────────────────────────── */}
      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingId ? 'Tekrarlayan İşlemi Düzenle' : 'Tekrarlayan İşlem Ekle'}
        size="md"
      >
        <div className="flex flex-col gap-4">

          <Input
            label="Ad"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Kira, Netflix, Maaş..."
          />

          {/* Type tabs */}
          <div>
            <label className="block text-xs font-medium tracking-wide uppercase text-muted mb-1.5">Tür</label>
            <div className="flex border border-border">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: opt.value as TransactionType, categoryId: '', toAccountId: '' }))}
                  className={[
                    'flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                    form.type === opt.value
                      ? 'bg-accent/[0.15] text-accent border-b-2 border-accent'
                      : 'text-muted hover:text-ink hover:bg-ground',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <CurrencyInput
            label="Tutar"
            value={form.amountStr}
            onChange={v => setForm(f => ({ ...f, amountStr: v }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Hesap"
              value={form.accountId}
              onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
              options={accountOptions}
              placeholder="Seçin..."
            />
            {form.type === 'transfer' ? (
              <Select
                label="Hedef Hesap"
                value={form.toAccountId}
                onChange={e => setForm(f => ({ ...f, toAccountId: e.target.value }))}
                options={accountOptions.filter(a => a.value !== form.accountId)}
                placeholder="Seçin..."
              />
            ) : (
              <Select
                label="Kategori"
                value={form.categoryId}
                onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
                options={categoryOptions}
                placeholder="Seçin..."
              />
            )}
          </div>

          <Input
            label="Açıklama (opsiyonel)"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="İşlem kaydında gösterilir"
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Tekrar Sıklığı"
              value={form.frequency}
              onChange={e => setForm(f => ({ ...f, frequency: e.target.value as RecurringFrequency }))}
              options={FREQ_OPTIONS}
            />
            {(form.frequency === 'monthly' || form.frequency === 'yearly') && (
              <Select
                label="Ayın Günü"
                value={form.dayOfMonth}
                onChange={e => setForm(f => ({ ...f, dayOfMonth: e.target.value }))}
                options={DAY_OPTIONS}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Başlangıç Tarihi"
              type="date"
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
            />
            <Input
              label="Bitiş Tarihi (opsiyonel)"
              type="date"
              value={form.endDate}
              onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={closeForm} fullWidth>İptal</Button>
            <Button onClick={handleSave} loading={loading} fullWidth>
              {editingId ? 'Güncelle' : 'Kaydet'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

/* ── Due row ────────────────────────────────────────────────────────── */

function DueRow({
  r, accounts, categories, isGenerating, onGenerate, onSkip,
}: {
  r: RecurringTransaction
  accounts: { id: string; name: string; color: string }[]
  categories: { id: string; name: string; icon: string }[]
  isGenerating: boolean
  onGenerate: () => void
  onSkip: () => void
}) {
  const account  = accounts.find(a => a.id === r.accountId)
  const category = categories.find(c => c.id === r.categoryId)

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {category && <span className="text-base">{category.icon}</span>}
          <span className="font-semibold text-sm text-ink truncate">{r.name}</span>
          <Badge variant={r.type === 'income' ? 'ok' : r.type === 'transfer' ? 'info' : 'danger'}>
            {FREQ_LABEL[r.frequency]}
          </Badge>
        </div>
        <div className="text-xs font-medium text-muted mt-0.5 flex items-center gap-2">
          {account && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: account.color }} />
              {account.name}
            </span>
          )}
          <span>·</span>
          <span>
            {format(new Date(r.nextDueDate + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={`font-medium tabular-nums tracking-tight text-lg ${r.type === 'income' ? 'text-ok' : r.type === 'transfer' ? 'text-info' : 'text-danger'}`}>
          {r.type === 'income' ? '+' : r.type === 'expense' ? '−' : '⇄'}{formatCurrency(r.amount)}
        </span>
        <button
          onClick={onSkip}
          className="text-xs font-medium text-muted hover:text-ink transition-colors px-2 py-1 border border-border rounded-xl"
          title="Bu sefer atla"
        >
          Atla
        </button>
        <Button size="sm" onClick={onGenerate} loading={isGenerating}>
          Kaydet
        </Button>
      </div>
    </div>
  )
}

/* ── Recurring row ──────────────────────────────────────────────────── */

function RecurringRow({
  r, accounts, categories, confirmDeleteId,
  onEdit, onToggle, onDelete, onConfirmDelete, onCancelDelete,
}: {
  r: RecurringTransaction
  accounts: { id: string; name: string; color: string }[]
  categories: { id: string; name: string; icon: string }[]
  confirmDeleteId: string | null
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  const account  = accounts.find(a => a.id === r.accountId)
  const category = categories.find(c => c.id === r.categoryId)
  const isConfirm = confirmDeleteId === r.id

  return (
    <div className="flex items-center gap-4 px-5 py-4 group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {category && <span className="text-base">{category.icon}</span>}
          <span className="font-semibold text-sm text-ink truncate">{r.name}</span>
          <Badge variant={r.type === 'income' ? 'ok' : r.type === 'transfer' ? 'info' : 'default'}>
            {FREQ_LABEL[r.frequency]}
          </Badge>
        </div>
        <div className="text-xs font-medium text-muted mt-0.5 flex items-center gap-2">
          {account && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: account.color }} />
              {account.name}
            </span>
          )}
          <span>·</span>
          <span>
            Sonraki: {format(new Date(r.nextDueDate + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className={`tabular-nums tracking-tight text-lg font-medium ${r.type === 'income' ? 'text-ok' : 'text-muted'}`}>
          {formatCurrency(r.amount)}
        </span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          <button onClick={onEdit} className="w-7 h-7 rounded-xl flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] text-xs transition-colors" title="Düzenle">✎</button>
          <button
            onClick={onToggle}
            className="w-7 h-7 rounded-xl flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] text-xs transition-colors"
            title={r.isActive ? 'Durdur' : 'Aktif et'}
          >
            {r.isActive ? '⏸' : '▶'}
          </button>
          {isConfirm ? (
            <div className="flex items-center gap-1">
              <button onClick={onDelete} className="px-2 h-6 rounded-full bg-danger text-white text-xs font-semibold">Sil</button>
              <button onClick={onCancelDelete} className="w-6 h-6 rounded-full border border-border text-muted text-xs">✕</button>
            </div>
          ) : (
            <button onClick={onConfirmDelete} className="w-7 h-7 rounded-xl flex items-center justify-center text-muted hover:text-danger hover:bg-white/[0.08] text-base transition-colors">×</button>
          )}
        </div>
      </div>
    </div>
  )
}
