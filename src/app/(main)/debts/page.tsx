'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useDebtStore, useAccountStore, useTransactionStore } from '@/store'
import { Card, CardContent } from '@/components/ui/card'
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
import type { Debt, DebtType, DebtDirection } from '@/types'
import { useShallow } from 'zustand/react/shallow'

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
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const debts = getActive()
  const transactions = useTransactionStore(useShallow(s => s.transactions))

  const [showForm, setShowForm]       = useState(false)
  const [editingDebt, setEditingDebt] = useState<Debt | undefined>()
  const [loading, setLoading]         = useState(false)
  const [form, setForm]               = useState(emptyForm())
  const [selectedDebt, setSelectedDebt] = useState<ReturnType<typeof getActive>[0] | undefined>()

  const owe   = debts.filter(d => d.direction === 'owe')
  const owed  = debts.filter(d => d.direction === 'owed')
  const totalOwe  = owe.reduce((s, d)  => s + d.remainingAmount, 0)
  const totalOwed = owed.reduce((s, d) => s + d.remainingAmount, 0)

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
      name:        debt.name,
      type:        debt.type,
      direction:   debt.direction,
      totalStr:    fmt(debt.totalAmount),
      paidStr:     fmt(debt.paidAmount),
      interestStr: debt.interestRate ? String(debt.interestRate) : '',
      startDate:   debt.startDate,
      dueDate:     debt.dueDate ?? '',
      monthlyStr:  debt.monthlyPayment ? fmt(debt.monthlyPayment) : '',
      totalInst:   debt.totalInstallments ? String(debt.totalInstallments) : '',
      counterparty: debt.counterparty ?? '',
      accountId:   debt.accountId ?? '',
      notes:       debt.notes ?? '',
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
      <div className="p-5 border-b border-border last:border-0">
        <div className="flex items-start justify-between gap-2 mb-3">
          <button
            className="text-left"
            onClick={() => setSelectedDebt(debt)}
          >
            <div className="font-semibold text-sm hover:text-primary transition-colors">{debt.name}</div>
            {debt.counterparty && (
              <div className="text-xs text-muted-foreground mt-0.5">{debt.counterparty}</div>
            )}
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            {overdue ? (
              <Badge variant="danger">Gecikmiş</Badge>
            ) : days !== null && days <= 7 ? (
              <Badge variant="warning">{days}g</Badge>
            ) : null}
            <Badge variant={debt.direction === 'owe' ? 'danger' : 'ok'}>
              {debt.direction === 'owe' ? 'Borçluyum' : 'Alacaklıyım'}
            </Badge>
            <button onClick={() => startEdit(debt)} className="text-muted-foreground hover:text-foreground text-sm transition-colors">✎</button>
            <button onClick={() => remove(debt.id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors">×</button>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-xl font-medium tabular-nums">
            <AnimatedNumber value={debt.remainingAmount} format={formatCurrency} />
          </span>
          <span className="text-xs text-muted-foreground">/ <AnimatedNumber value={debt.totalAmount} format={formatCurrency} /> toplam</span>
        </div>

        <div className="h-[2px] bg-muted mb-2">
          <div className="h-full bg-green-600" style={{ width: `${debt.progressPercent}%` }} />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground">
          <span><AnimatedNumber value={debt.paidAmount} format={formatCurrency} /> ödendi (%{Math.round(debt.progressPercent)})</span>
          {debt.dueDate && <span>{formatDate(debt.dueDate, 'd MMM yyyy')}</span>}
          {debt.monthlyPayment && <span>Taksit: <AnimatedNumber value={debt.monthlyPayment} format={formatCurrency} /></span>}
        </div>

        {!debt.isSettled && (
          <button
            onClick={() => settle(debt.id)}
            className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-green-600 transition-colors"
          >
            Kapatıldı olarak işaretle →
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <Header title="Borç Takibi" action={{ label: 'Ekle', onClick: startAdd }} />

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

      <div className="p-6">
        {debts.length === 0 ? (
          <EmptyState
            icon="◇"
            title="Aktif borç veya alacak yok"
            description="Kredi, taksit veya kişisel borçlarınızı takip edin."
            action={<Button size="sm" onClick={startAdd}>Ekle</Button>}
          />
        ) : (
          <Card className="gap-0 py-0">
            <CardContent className="p-0">
              {debts.map(d => <DebtCard key={d.id} debt={d} />)}
            </CardContent>
          </Card>
        )}
      </div>

      <Modal open={!!selectedDebt} onClose={() => setSelectedDebt(undefined)} title={selectedDebt?.name ?? ''} size="md">
        {selectedDebt && (() => {
          const debtTxs = transactions
            .filter(t => t.debtId === selectedDebt.id)
            .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          return (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-medium tabular-nums">{formatCurrency(selectedDebt.remainingAmount)}</span>
                  <span className="text-sm text-muted-foreground">/ {formatCurrency(selectedDebt.totalAmount)} toplam</span>
                </div>
                <div className="h-[2px] bg-muted mb-1">
                  <div className="h-full bg-green-600" style={{ width: `${selectedDebt.progressPercent}%` }} />
                </div>
                <div className="text-xs text-muted-foreground">{formatCurrency(selectedDebt.paidAmount)} ödendi (%{Math.round(selectedDebt.progressPercent)})</div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">İşlemler</div>
                {debtTxs.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">Bu borca ait işlem yok.</div>
                ) : (
                  <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden">
                    {debtTxs.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-sm">
                        <div className="flex flex-col gap-0.5">
                          <span>{tx.description}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(tx.date, 'd MMM yyyy')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {tx.type === 'transfer' ? 'Transfer' : 'Ödeme'}
                          </span>
                          <span className="tabular-nums font-medium">{formatCurrency(tx.amount, tx.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

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
