'use client'

import { useMemo, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { useBudgetStore, useTransactionStore, useCategoryStore, useUIStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { formatMonthYear, prevMonth, nextMonth, lastNMonths } from '@/lib/utils/date'
import { getBudgetCategoryIds, calcBudgetSpent, enrichBudget } from '@/lib/utils/calculations'
import type { Budget, BudgetWithSpent, MonthYear } from '@/types'
import { useShallow } from 'zustand/react/shallow'

const TR_MONTHS_SHORT = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']

function shortLabel(my: MonthYear) {
  return `${TR_MONTHS_SHORT[my.month - 1]} '${String(my.year).slice(2)}`
}

// ── Icons ─────────────────────────────────────────────────────────────────────

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

// ── Budget Card ───────────────────────────────────────────────────────────────

function BudgetCard({
  b,
  onEdit,
  onDelete,
  onDetail,
}: {
  b: BudgetWithSpent
  onEdit: (b: Budget) => void
  onDelete: (id: string) => void
  onDetail: (b: BudgetWithSpent) => void
}) {
  const categories = useCategoryStore(s => s.categories)
  const cats = getBudgetCategoryIds(b).map(id => categories.find(c => c.id === id)).filter(Boolean)

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex gap-1 flex-wrap mb-1">
            {cats.map(cat => (
              <span key={cat!.id} className="text-lg" title={cat!.name}>{cat!.icon}</span>
            ))}
          </div>
          <div className="text-sm font-semibold truncate">
            {cats.map(c => c!.name).join(', ')}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {b.status !== 'ok' && (
            <Badge variant={b.status === 'exceeded' ? 'danger' : 'warning'}>
              {b.status === 'exceeded' ? 'Aşıldı' : 'Uyarı'}
            </Badge>
          )}
          <button
            onClick={() => onEdit(b)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Düzenle"
          >
            <PencilIcon />
          </button>
          <button
            onClick={() => onDelete(b.id)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Sil"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Spent / Limit */}
      <div className="flex items-baseline gap-1.5">
        <span className={`text-xl font-medium tabular-nums ${
          b.status === 'exceeded' ? 'text-destructive' : b.status === 'warning' ? 'text-orange-500' : ''
        }`}>
          <AnimatedNumber value={b.spent} format={formatCurrency} />
        </span>
        <span className="text-xs text-muted-foreground">
          / <AnimatedNumber value={b.amount} format={formatCurrency} />
        </span>
      </div>

      {/* Progress */}
      <ProgressBar percent={b.percentUsed} status={b.status} showLabel />

      {/* Footer */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {b.status === 'exceeded'
            ? <>{formatCurrency(b.spent - b.amount)} aşım</>
            : <>{formatCurrency(b.remaining)} kaldı</>}
        </span>
        <span>%{b.alertThreshold} uyarı</span>
      </div>

      {/* Detail */}
      <Button size="sm" fullWidth onClick={() => onDetail(b)}>Detay</Button>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const transactions          = useTransactionStore(s => s.transactions)
  const categories            = useCategoryStore(useShallow(s => s.getByScope('expense')))
  const allCategories         = useCategoryStore(s => s.categories)
  const { selectedPeriod, setPeriod } = useUIStore()
  const { budgets: rawBudgets, add, update, remove } = useBudgetStore(
    useShallow(s => ({ budgets: s.budgets, add: s.add, update: s.update, remove: s.remove }))
  )

  const budgets = useMemo(
    () =>
      rawBudgets
        .filter(b => b.period === 'monthly')
        .map(b => enrichBudget(b, transactions, selectedPeriod))
        .sort((a, b) => b.percentUsed - a.percentUsed),
    [rawBudgets, transactions, selectedPeriod],
  )

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [selectedBudget, setSelectedBudget] = useState<BudgetWithSpent | undefined>()

  const HISTORY_MONTHS = 12
  const historyData = useMemo(() => {
    if (!selectedBudget) return []
    const months = lastNMonths(HISTORY_MONTHS)
    return months
      .map(my => {
        const spent = calcBudgetSpent(selectedBudget, transactions, my)
        const pct   = selectedBudget.amount > 0 ? Math.min(100, (spent / selectedBudget.amount) * 100) : 0
        const status = pct >= 100 ? 'exceeded' : pct >= selectedBudget.alertThreshold ? 'warning' : 'ok'
        return { my, label: shortLabel(my), fullLabel: formatMonthYear(my), spent, pct, status }
      })
      .reverse()
  }, [selectedBudget, transactions])

  // ── Form modal ────────────────────────────────────────────────────────────
  const [showForm, setShowForm]           = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | undefined>()
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([])
  const [amtStr, setAmtStr]               = useState('')
  const [threshold, setThreshold]         = useState('80')
  const [loading, setLoading]             = useState(false)

  function startAdd() {
    setEditingBudget(undefined)
    setSelectedCatIds([])
    setAmtStr('')
    setThreshold('80')
    setShowForm(true)
  }

  function startEdit(b: Budget) {
    setEditingBudget(b)
    setSelectedCatIds(getBudgetCategoryIds(b))
    setAmtStr(new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(b.amount))
    setThreshold(String(b.alertThreshold))
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingBudget(undefined)
    setSelectedCatIds([])
    setAmtStr('')
    setThreshold('80')
  }

  function toggleCat(id: string) {
    setSelectedCatIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSave() {
    if (selectedCatIds.length === 0 || !parseCurrencyInput(amtStr)) return
    setLoading(true)

    const categoryId = selectedCatIds.length === 1
      ? selectedCatIds[0]
      : JSON.stringify(selectedCatIds)

    if (editingBudget) {
      await update(editingBudget.id, {
        categoryId,
        amount: parseCurrencyInput(amtStr),
        alertThreshold: Number(threshold) || 80,
      })
    } else {
      const b: Budget = {
        id: crypto.randomUUID(),
        categoryId,
        amount: parseCurrencyInput(amtStr),
        period: 'monthly',
        rollover: false,
        alertThreshold: Number(threshold) || 80,
      }
      await add(b)
    }
    closeForm()
    setLoading(false)
  }

  // Categories already assigned to other budgets (excluding the one being edited)
  const usedCatIds = useMemo(
    () =>
      rawBudgets
        .filter(b => b.id !== editingBudget?.id)
        .flatMap(b => getBudgetCategoryIds(b)),
    [rawBudgets, editingBudget],
  )

  const availableCategories = categories.filter(c => !usedCatIds.includes(c.id))

  // Detail modal title
  const detailTitle = useMemo(() => {
    if (!selectedBudget) return ''
    const cats = getBudgetCategoryIds(selectedBudget)
      .map(id => allCategories.find(c => c.id === id))
      .filter(Boolean)
    return cats.map(c => c!.name).join(', ')
  }, [selectedBudget, allCategories])

  return (
    <>
      <Header title="Bütçeler" action={{ label: 'Bütçe Ekle', onClick: startAdd }} />

      {/* Period nav */}
      <div className="flex items-center gap-3 px-6 py-3 bg-transparent border-b border-border/50">
        <button
          onClick={() => setPeriod(prevMonth(selectedPeriod))}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >←</button>
        <span className="text-xs font-medium tracking-wide uppercase text-foreground min-w-24 text-center">
          {formatMonthYear(selectedPeriod)}
        </span>
        <button
          onClick={() => setPeriod(nextMonth(selectedPeriod))}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >→</button>
      </div>

      {/* Grid */}
      <div className="p-6">
        {budgets.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Bu ay bütçe tanımlı değil"
            description="Harcama kategorilerinize limit belirleyin."
            action={<Button size="sm" onClick={startAdd}>Bütçe Ekle</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {budgets.map(b => (
              <BudgetCard
                key={b.id}
                b={b}
                onEdit={startEdit}
                onDelete={remove}
                onDetail={setSelectedBudget}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail modal ────────────────────────────────────────────────────── */}
      <Modal
        open={!!selectedBudget}
        onClose={() => setSelectedBudget(undefined)}
        title={detailTitle}
        size="md"
      >
        {selectedBudget && (
          <div className="flex flex-col gap-6">
            {/* Current month summary */}
            <div className="rounded-xl border border-border p-4 flex flex-col gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {formatMonthYear(selectedPeriod)}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-semibold tabular-nums ${
                  selectedBudget.status === 'exceeded' ? 'text-destructive'
                  : selectedBudget.status === 'warning' ? 'text-orange-500' : ''
                }`}>
                  {formatCurrency(selectedBudget.spent)}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {formatCurrency(selectedBudget.amount)}
                </span>
              </div>
              <ProgressBar percent={selectedBudget.percentUsed} status={selectedBudget.status} showLabel />
              <div className="text-xs text-muted-foreground">
                {selectedBudget.status === 'exceeded'
                  ? `${formatCurrency(selectedBudget.spent - selectedBudget.amount)} aşım`
                  : `${formatCurrency(selectedBudget.remaining)} kaldı`}
              </div>
            </div>

            {/* Monthly history */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                Son {HISTORY_MONTHS} Ay
              </div>
              <div className="flex flex-col gap-2">
                {historyData.map(row => (
                  <div key={`${row.my.year}-${row.my.month}`} className="flex items-center gap-3">
                    <div className="text-[11px] text-muted-foreground w-14 text-right shrink-0">
                      {row.label}
                    </div>
                    <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden">
                      <div
                        className={`h-full rounded-sm transition-all ${
                          row.status === 'exceeded' ? 'bg-destructive'
                          : row.status === 'warning' ? 'bg-orange-500'
                          : 'bg-primary'
                        }`}
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>
                    <div className="text-[11px] tabular-nums text-right shrink-0 w-24">
                      {row.spent > 0 ? (
                        <span className={
                          row.status === 'exceeded' ? 'text-destructive'
                          : row.status === 'warning' ? 'text-orange-500'
                          : 'text-foreground'
                        }>
                          {formatCurrency(row.spent)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3">
                <div className="text-[11px] text-muted-foreground w-14 text-right shrink-0">Limit</div>
                <div className="flex-1 h-5 bg-primary/20 rounded-sm" />
                <div className="text-[11px] tabular-nums text-right shrink-0 w-24 text-muted-foreground">
                  {formatCurrency(selectedBudget.amount)}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Add / Edit form modal ────────────────────────────────────────────── */}
      <Modal
        open={showForm}
        onClose={closeForm}
        title={editingBudget ? 'Bütçeyi Düzenle' : 'Bütçe Ekle'}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          {/* Multi-category selector */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Kategoriler
              {selectedCatIds.length > 0 && (
                <span className="ml-1.5 text-primary">({selectedCatIds.length} seçili)</span>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border/50">
              {availableCategories.length === 0 && selectedCatIds.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  Tüm kategoriler başka bütçelere atanmış.
                </div>
              ) : (
                [...availableCategories, ...categories.filter(c => selectedCatIds.includes(c.id) && !availableCategories.some(a => a.id === c.id))].map(cat => (
                  <label
                    key={cat.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCatIds.includes(cat.id)}
                      onChange={() => toggleCat(cat.id)}
                      className="rounded accent-primary"
                    />
                    <span className="text-base">{cat.icon}</span>
                    <span className="text-sm">{cat.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <CurrencyInput label="Aylık Limit" value={amtStr} onChange={setAmtStr} />
          <Input
            label="Uyarı Eşiği (%)"
            type="number"
            min={50}
            max={100}
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
          />

          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSave}
              loading={loading}
              fullWidth
              disabled={selectedCatIds.length === 0}
            >
              {editingBudget ? 'Güncelle' : 'Ekle'}
            </Button>
            <Button variant="secondary" onClick={closeForm} fullWidth>İptal</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
