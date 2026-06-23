'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useBudgetStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card, CardContent } from '@/components/ui/card'
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
      <div className="flex items-center gap-3 px-6 py-3 bg-transparent border-b border-border/50">
        <button onClick={() => setPeriod(prevMonth(selectedPeriod))} className="text-muted-foreground hover:text-foreground text-sm transition-colors">←</button>
        <span className="text-xs font-medium tracking-wide uppercase text-foreground min-w-24 text-center">
          {formatMonthYear(selectedPeriod)}
        </span>
        <button onClick={() => setPeriod(nextMonth(selectedPeriod))} className="text-muted-foreground hover:text-foreground text-sm transition-colors">→</button>
      </div>

      <div className="p-6">
        {budgets.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Bu ay bütçe tanımlı değil"
            description="Harcama kategorilerinize limit belirleyin."
            action={<Button size="sm" onClick={() => setShowForm(true)}>Bütçe Ekle</Button>}
          />
        ) : (
          <Card className="gap-0 py-0">
            <CardContent className="p-0">
            {budgets.map((b, i) => {
              const cat = categories.find(c => c.id === b.categoryId)
              return (
                <div key={b.id} className={`px-5 py-4 ${i < budgets.length - 1 ? 'border-b border-border/50' : ''}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat?.icon}</span>
                      <span className="text-sm font-semibold text-foreground/90">{cat?.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className={`text-sm font-medium tabular-nums ${
                          b.status === 'exceeded' ? 'text-destructive' : b.status === 'warning' ? 'text-orange-500' : 'text-foreground'
                        }`}>
                          {formatCurrency(b.spent)}
                        </span>
                        <span className="text-muted-foreground text-sm font-medium tabular-nums"> / {formatCurrency(b.amount)}</span>
                      </div>
                      <button onClick={() => startEdit(b)} className="text-muted-foreground hover:text-foreground text-sm transition-colors">✎</button>
                      <button onClick={() => remove(b.id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors">×</button>
                    </div>
                  </div>
                  <ProgressBar percent={b.percentUsed} status={b.status} showLabel />
                  <div className="flex justify-between mt-1 text-xs font-medium text-muted-foreground">
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
            </CardContent>
          </Card>
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
