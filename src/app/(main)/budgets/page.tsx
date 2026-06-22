'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useBudgetStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/utils/currency'
import { formatMonthYear, prevMonth, nextMonth } from '@/lib/utils/date'
import { parseCurrencyInput } from '@/lib/utils/currency'
import type { Budget, BudgetPeriod } from '@/types'
import { useShallow } from 'zustand/react/shallow'

export default function BudgetsPage() {
  const transactions   = useTransactionStore(s => s.transactions)
  const categories     = useCategoryStore(useShallow(s => s.getByScope('expense')))
  const { selectedPeriod, setPeriod } = useUIStore()
  const { getMonthBudgets, add, update, remove } = useBudgetStore()

  const budgets = getMonthBudgets(selectedPeriod, transactions)

  const [showForm, setShowForm]           = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | undefined>()
  const [catId, setCatId]                 = useState('')
  const [amtStr, setAmtStr]               = useState('')
  const [threshold, setThreshold]         = useState('80')
  const [loading, setLoading]             = useState(false)

  function startEdit(b: Budget) {
    setEditingBudget(b)
    setCatId(b.categoryId)
    setAmtStr(new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(b.amount))
    setThreshold(String(b.alertThreshold))
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingBudget(undefined)
    setCatId(''); setAmtStr(''); setThreshold('80')
  }

  async function handleSave() {
    if (!catId || !parseCurrencyInput(amtStr)) return
    setLoading(true)
    if (editingBudget) {
      await update(editingBudget.id, {
        categoryId: catId,
        amount: parseCurrencyInput(amtStr),
        alertThreshold: Number(threshold) || 80,
      })
    } else {
      const b: Budget = {
        id: crypto.randomUUID(),
        categoryId: catId,
        amount: parseCurrencyInput(amtStr),
        period: 'monthly',
        year: selectedPeriod.year,
        month: selectedPeriod.month,
        rollover: false,
        alertThreshold: Number(threshold) || 80,
      }
      await add(b)
    }
    closeForm()
    setLoading(false)
  }

  const catOptions = categories
    .filter(c => !budgets.some(b => b.categoryId === c.id && b.id !== editingBudget?.id))
    .map(c => ({ value: c.id, label: `${c.icon} ${c.name}` }))

  return (
    <>
      <Header title="Bütçeler" action={{ label: 'Bütçe Ekle', onClick: () => setShowForm(true) }} />

      {/* Period nav */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-line bg-surface">
        <button onClick={() => setPeriod(prevMonth(selectedPeriod))} className="text-muted hover:text-ink font-mono text-sm">←</button>
        <span className="text-xs font-mono tracking-wide uppercase text-ink min-w-24 text-center">
          {formatMonthYear(selectedPeriod)}
        </span>
        <button onClick={() => setPeriod(nextMonth(selectedPeriod))} className="text-muted hover:text-ink font-mono text-sm">→</button>
      </div>

      <div className="p-4 lg:p-6">
        {budgets.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Bu ay bütçe tanımlı değil"
            description="Harcama kategorilerinize limit belirleyin."
            action={<Button size="sm" onClick={() => setShowForm(true)}>Bütçe Ekle</Button>}
          />
        ) : (
          <div className="card">
            {budgets.map((b, i) => {
              const cat = categories.find(c => c.id === b.categoryId)
              return (
                <div key={b.id} className={`px-5 py-4 ${i < budgets.length - 1 ? 'border-b border-line' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat?.icon}</span>
                      <span className="font-medium text-sm">{cat?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={`font-mono text-sm tabular ${
                          b.status === 'exceeded' ? 'text-danger' : b.status === 'warning' ? 'text-amber' : 'text-ink'
                        }`}>
                          {formatCurrency(b.spent)}
                        </span>
                        <span className="text-muted font-mono text-xs"> / {formatCurrency(b.amount)}</span>
                      </div>
                      <button onClick={() => startEdit(b)} className="text-muted hover:text-ink text-sm transition-colors">✎</button>
                      <button onClick={() => remove(b.id)} className="text-muted hover:text-danger text-sm transition-colors">×</button>
                    </div>
                  </div>
                  <ProgressBar percent={b.percentUsed} status={b.status} showLabel />
                  <div className="flex justify-between mt-1 text-[10px] font-mono text-muted">
                    <span>
                      {b.status === 'exceeded'
                        ? `${formatCurrency(b.spent - b.amount)} aşım`
                        : `${formatCurrency(b.remaining)} kaldı`
                      }
                    </span>
                    <span>Uyarı eşiği: %{b.alertThreshold}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal open={showForm} onClose={closeForm} title={editingBudget ? 'Bütçeyi Düzenle' : 'Bütçe Ekle'} size="sm">
        <div className="flex flex-col gap-4">
          <Select label="Kategori" value={catId} onChange={e => setCatId(e.target.value)} options={catOptions} placeholder="Seçin..." />
          <CurrencyInput label="Aylık Limit" value={amtStr} onChange={setAmtStr} />
          <Input label="Uyarı Eşiği (%)" type="number" min={50} max={100} value={threshold} onChange={e => setThreshold(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={closeForm} fullWidth>İptal</Button>
            <Button onClick={handleSave} loading={loading} fullWidth>{editingBudget ? 'Güncelle' : 'Ekle'}</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
