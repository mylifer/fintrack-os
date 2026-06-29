'use client'

import { useState } from 'react'
import { AlertDialog } from 'radix-ui'
import { Header } from '@/components/layout/Header'
import { useDebtStore, useAccountStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, daysUntil, isOverdue } from '@/lib/utils/date'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { parseCurrencyInput } from '@/lib/utils/currency'
import type { Debt, DebtType, DebtDirection, Transaction } from '@/types'
import { useShallow } from 'zustand/react/shallow'

const PencilIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const TrashIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)

function TxDeleteDialog({ tx, onDelete }: { tx: Transaction; onDelete: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Sil"
        >
          <TrashIcon />
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content className={[
          'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-6 shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        ].join(' ')}>
          <AlertDialog.Title className="text-base font-semibold text-foreground mb-1">İşlemi sil</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground mb-5">
            <span className="font-medium text-foreground">&ldquo;{tx.description}&rdquo;</span> işlemi kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors">İptal</button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button onClick={onDelete} className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors">Sil</button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

const TYPE_OPTIONS = [
  { value: 'personal',          label: 'Kişisel Borç/Alacak' },
  { value: 'bank_loan',         label: 'Banka Kredisi' },
  { value: 'credit_card_debt',  label: 'Kredi Kartı Borcu' },
  { value: 'installment',       label: 'Taksitli Satın Alma' },
]

function emptyForm() {
  return {
    name: '', type: 'personal' as DebtType, direction: 'owe' as DebtDirection,
    totalStr: '', paidStr: '0', interestStr: '',
    startDate: new Date().toISOString().slice(0, 10),
    dueDate: '', monthlyStr: '', totalInst: '', counterparty: '',
    accountId: '', notes: '',
  }
}

export default function DebtsPage() {
  const { getActive, add, update, settle, remove } = useDebtStore()
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const debts        = getActive()
  const transactions = useTransactionStore(useShallow(s => s.transactions))
  const categories   = useCategoryStore(s => s.categories)
  const openModal    = useUIStore(s => s.openModal)
  const removeTx     = useTransactionStore(s => s.remove)

  const [showForm, setShowForm]         = useState(false)
  const [editingDebt, setEditingDebt]   = useState<Debt | undefined>()
  const [loading, setLoading]           = useState(false)
  const [form, setForm]                 = useState(emptyForm())
  const [selectedDebt, setSelectedDebt] = useState<ReturnType<typeof getActive>[0] | undefined>()

  const owe        = debts.filter(d => d.direction === 'owe')
  const owed       = debts.filter(d => d.direction === 'owed')
  const totalOwe   = owe.reduce((s, d)  => s + d.remainingAmount, 0)
  const totalOwed  = owed.reduce((s, d) => s + d.remainingAmount, 0)

  const animTotalOwe  = useCountUp(totalOwe)
  const animTotalOwed = useCountUp(totalOwed)

  function fmt(n: number) {
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n)
  }

  function startAdd() {
    setEditingDebt(undefined)
    setForm(emptyForm())
    setShowForm(true)
  }

  function startEdit(debt: Debt) {
    setEditingDebt(debt)
    setForm({
      name:         debt.name,
      type:         debt.type,
      direction:    debt.direction,
      totalStr:     fmt(debt.totalAmount),
      paidStr:      fmt(debt.paidAmount),
      interestStr:  debt.interestRate ? String(debt.interestRate) : '',
      startDate:    debt.startDate,
      dueDate:      debt.dueDate ?? '',
      monthlyStr:   debt.monthlyPayment ? fmt(debt.monthlyPayment) : '',
      totalInst:    debt.totalInstallments ? String(debt.totalInstallments) : '',
      counterparty: debt.counterparty ?? '',
      accountId:    debt.accountId ?? '',
      notes:        debt.notes ?? '',
    })
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingDebt(undefined)
    setForm(emptyForm())
  }

  async function handleSave() {
    if (!form.name || !parseCurrencyInput(form.totalStr)) return
    setLoading(true)

    const patch = {
      name:              form.name,
      type:              form.type,
      direction:         form.direction,
      totalAmount:       parseCurrencyInput(form.totalStr),
      paidAmount:        parseCurrencyInput(form.paidStr),
      interestRate:      parseCurrencyInput(form.interestStr) || undefined,
      startDate:         form.startDate,
      dueDate:           form.dueDate || undefined,
      monthlyPayment:    parseCurrencyInput(form.monthlyStr) || undefined,
      totalInstallments: form.totalInst ? Number(form.totalInst) : undefined,
      counterparty:      form.counterparty || undefined,
      accountId:         form.accountId || undefined,
      notes:             form.notes || undefined,
    }

    if (editingDebt) {
      await update(editingDebt.id, patch)
    } else {
      const d: Debt = {
        ...patch,
        id:               crypto.randomUUID(),
        paidInstallments: 0,
        isSettled:        false,
        createdAt:        new Date().toISOString(),
      }
      await add(d)
    }

    closeForm()
    setLoading(false)
  }

  function DebtCard({ debt }: { debt: ReturnType<typeof getActive>[0] }) {
    const overdue = debt.dueDate && isOverdue(debt.dueDate)
    const days    = debt.dueDate ? daysUntil(debt.dueDate) : null

    return (
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">{debt.name}</div>
            {debt.counterparty && (
              <div className="text-xs text-muted-foreground mt-0.5">{debt.counterparty}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {overdue ? (
              <Badge variant="danger">Gecikmiş</Badge>
            ) : days !== null && days <= 7 ? (
              <Badge variant="warning">{days}g</Badge>
            ) : null}
            <Badge variant={debt.direction === 'owe' ? 'danger' : 'ok'}>
              {debt.direction === 'owe' ? 'Borçluyum' : 'Alacaklıyım'}
            </Badge>
            <button
              onClick={() => startEdit(debt)}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Düzenle"
            >
              <PencilIcon />
            </button>
            <button
              onClick={() => remove(debt.id)}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Sil"
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Amount */}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-medium tabular-nums">
            <AnimatedNumber value={debt.remainingAmount} format={formatCurrency} />
          </span>
          <span className="text-xs text-muted-foreground">
            / <AnimatedNumber value={debt.totalAmount} format={formatCurrency} /> toplam
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-[2px] bg-muted">
          <div className="h-full bg-green-600 transition-all" style={{ width: `${debt.progressPercent}%` }} />
        </div>

        {/* Footer info */}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            <AnimatedNumber value={debt.paidAmount} format={formatCurrency} /> ödendi (%{Math.round(debt.progressPercent)})
          </span>
          {debt.dueDate && <span>{formatDate(debt.dueDate, 'd MMM yyyy')}</span>}
          {debt.monthlyPayment && (
            <span>Taksit: <AnimatedNumber value={debt.monthlyPayment} format={formatCurrency} /></span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" fullWidth onClick={() => setSelectedDebt(debt)}>
            Detay
          </Button>
          {!debt.isSettled && (
            <Button size="sm" variant="ok" fullWidth onClick={() => settle(debt.id)}>
              Kapatıldı
            </Button>
          )}
        </div>
      </div>
    )
  }

  // Detail modal content
  const debtTxs = selectedDebt
    ? transactions
        .filter(t => t.debtId === selectedDebt.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    : []

  return (
    <>
      <Header title="Borç Takibi" action={{ label: 'Ekle', onClick: startAdd }} />

      {/* Summary bar */}
      <div className="flex border-b border-border bg-card">
        <div className="flex-1 px-6 py-4 border-r border-border">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Toplam Borç</div>
          <div className="text-3xl font-normal tabular-nums text-destructive">{formatCurrency(animTotalOwe)}</div>
        </div>
        <div className="flex-1 px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Toplam Alacak</div>
          <div className="text-3xl font-normal tabular-nums text-green-600">{formatCurrency(animTotalOwed)}</div>
        </div>
      </div>

      {/* Debt grid */}
      <div className="p-6">
        {debts.length === 0 ? (
          <EmptyState
            icon="◇"
            title="Aktif borç veya alacak yok"
            description="Kredi, taksit veya kişisel borçlarınızı takip edin."
            action={<Button size="sm" onClick={startAdd}>Ekle</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {debts.map(d => <DebtCard key={d.id} debt={d} />)}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Modal
        open={!!selectedDebt}
        onClose={() => setSelectedDebt(undefined)}
        title={selectedDebt?.name ?? ''}
        size="lg"
      >
        {selectedDebt && (
          <div className="flex flex-col gap-5">
            {/* Debt summary */}
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-medium tabular-nums">
                  {formatCurrency(selectedDebt.remainingAmount)}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {formatCurrency(selectedDebt.totalAmount)} toplam
                </span>
              </div>
              <div className="h-[2px] bg-muted mb-1.5">
                <div className="h-full bg-green-600" style={{ width: `${selectedDebt.progressPercent}%` }} />
              </div>
              <div className="text-xs text-muted-foreground">
                {formatCurrency(selectedDebt.paidAmount)} ödendi (%{Math.round(selectedDebt.progressPercent)})
              </div>
            </div>

            {/* Transactions */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">İşlemler</div>
              {debtTxs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Bu borca ait işlem yok.</div>
              ) : (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  {debtTxs.map((tx, i) => {
                    const cat         = categories.find(c => c.id === tx.categoryId)
                    const account     = accounts.find(a => a.id === tx.accountId)
                    const isIncome    = tx.type === 'income'
                    const isXfer      = tx.type === 'transfer'
                    const iconBg      = cat?.color ? `${cat.color}20` : isXfer ? '#00E5FF20' : 'rgba(255,255,255,0.04)'
                    const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
                    const iconIsText  = !cat?.icon && !!tx.icon

                    return (
                      <div
                        key={tx.id}
                        className={[
                          'flex items-center gap-3 px-4 py-3.5 hover:bg-accent transition-colors',
                          i > 0 ? 'border-t border-border' : '',
                        ].join(' ')}
                      >
                        {/* Icon */}
                        <div
                          className={[
                            'w-7 h-7 flex-shrink-0 flex items-center justify-center rounded',
                            iconIsText ? 'text-xs font-medium text-foreground/50' : 'text-sm',
                          ].join(' ')}
                          style={{ background: iconBg }}
                        >
                          {displayIcon}
                        </div>

                        {/* Description + sub */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{tx.description}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(tx.date, 'd MMM yyyy')}
                            {account && <span className="ml-1.5">· {account.name}</span>}
                          </div>
                        </div>

                        {/* Amount */}
                        <span
                          className={[
                            'flex-shrink-0 text-sm font-medium tabular-nums',
                            isIncome ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
                          ].join(' ')}
                        >
                          {isIncome ? '+' : isXfer ? '' : '−'}
                          {formatCurrency(tx.amount, tx.currency)}
                        </span>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => openModal('edit-transaction', { id: tx.id })}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            title="Düzenle"
                          >
                            <PencilIcon />
                          </button>
                          <TxDeleteDialog tx={tx} onDelete={() => removeTx(tx.id)} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Add / Edit debt form modal */}
      <Modal open={showForm} onClose={closeForm} title={editingDebt ? 'Borcu Düzenle' : 'Borç / Alacak Ekle'} size="md">
        <div className="flex flex-col gap-3">
          <Input label="Açıklama" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Araba Kredisi" />

          <div className="grid grid-cols-2 gap-3">
            <Select label="Tür" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value as DebtType}))} options={TYPE_OPTIONS} />
            <Select label="Yön" value={form.direction}
              onChange={e => setForm(f => ({...f, direction: e.target.value as DebtDirection}))}
              options={[{value:'owe',label:'Ben Borçluyum'},{value:'owed',label:'Bana Borçlu'}]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CurrencyInput label="Toplam Tutar" value={form.totalStr} onChange={v => setForm(f => ({...f, totalStr: v}))} />
            <CurrencyInput label="Ödenen" value={form.paidStr} onChange={v => setForm(f => ({...f, paidStr: v}))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Başlangıç" type="date" value={form.startDate} onChange={e => setForm(f => ({...f, startDate: e.target.value}))} />
            <Input label="Son Ödeme / Vade" type="date" value={form.dueDate} onChange={e => setForm(f => ({...f, dueDate: e.target.value}))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CurrencyInput label="Aylık Taksit" value={form.monthlyStr} onChange={v => setForm(f => ({...f, monthlyStr: v}))} />
            <Input label="Alacaklı / Kişi" value={form.counterparty} onChange={e => setForm(f => ({...f, counterparty: e.target.value}))} placeholder="Garanti BBVA" />
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={handleSave} loading={loading} fullWidth>{editingDebt ? 'Güncelle' : 'Kaydet'}</Button>
            <Button variant="secondary" onClick={closeForm} fullWidth>İptal</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
