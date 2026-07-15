'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header }             from '@/components/layout/Header'
import { Button }             from '@/components/ui/button'
import { CategoryIcon }       from '@/components/categories/CategoryIcon'
import { EmptyState }         from '@/components/ui/EmptyState'
import { Badge }              from '@/components/ui/Badge'
import { Card, CardContent }  from '@/components/ui/card'
import {
  useRecurringStore, useAccountStore, useCategoryStore,
  useTransactionStore, useUIStore,
} from '@/store'
import { recurringOccurrences } from '@/store/recurring.store'
import { deterministicUuid }    from '@/lib/utils/id'
import { formatCurrency }     from '@/lib/utils/currency'
import { today }              from '@/lib/utils/date'
import { useShallow }         from 'zustand/react/shallow'
import type { RecurringTransaction, RecurringFrequency } from '@/types'

/* ── Constants ─────────────────────────────────────────────────────── */

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  daily:   'Günlük',
  weekly:  'Haftalık',
  monthly: 'Aylık',
  yearly:  'Yıllık',
}

/* ── Page ───────────────────────────────────────────────────────────── */

export default function RecurringPage() {
  const recurring     = useRecurringStore(s => s.recurring)
  const remove        = useRecurringStore(s => s.remove)
  const toggleActive  = useRecurringStore(s => s.toggleActive)
  const getDue        = useRecurringStore(s => s.getDue)
  const markGenerated = useRecurringStore(s => s.markGenerated)
  const skip          = useRecurringStore(s => s.skip)
  const addTransaction  = useTransactionStore(s => s.add)
  const accounts        = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories      = useCategoryStore(s => s.categories)
  const openModal       = useUIStore(s => s.openModal)

  const todayStr = today()

  const [generatingId, setGeneratingId]   = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const due     = getDue(todayStr)
  const active  = recurring.filter(r => r.isActive && !due.some(d => d.id === r.id))
  const paused  = recurring.filter(r => !r.isActive)

  // Add/edit runs through the shared TransactionFormModal (recurring mode),
  // mounted in the main layout — the page only opens it.
  const openAdd = () => openModal('add-recurring')
  const openEdit = (r: RecurringTransaction) => openModal('edit-recurring', { id: r.id })

  async function handleGenerate(r: RecurringTransaction) {
    if (generatingId) return
    setGeneratingId(r.id)
    try {
      const now = new Date().toISOString()
      // Catch-up: one transaction per MISSED period (not just one), each with a
      // deterministic id so a double-click / second tab / retry can't duplicate
      // it — the same (template, date) always maps to the same row.
      for (const occ of recurringOccurrences(r, todayStr)) {
        await addTransaction({
          id:            deterministicUuid(`recur:${r.id}:${occ}`),
          type:          r.type,
          amount:        r.amount,
          currency:      r.currency,
          date:          occ,
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
      }
      await markGenerated(r.id, todayStr)
    } catch (err) {
      console.error('[recurring:generate]', err)
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <>
      <Header title="Tekrarlayan İşlemler" action={{ label: 'Ekle', onClick: openAdd }} />

      <div className="p-6 flex flex-col gap-6">

        {/* ── Pending (due) ─────────────────────────────────────────── */}
        {due.length > 0 && (
          <section>
            <div className="text-xs font-medium tracking-wide uppercase text-orange-500 font-semibold mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
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
                  onSkip={() => skip(r.id, todayStr)}
                />
              ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Active ────────────────────────────────────────────────── */}
        <section>
          <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold mb-2">
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
            <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground font-semibold mb-2">
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
    </>
  )
}

/* ── Due row ────────────────────────────────────────────────────────── */

function DueRow({
  r, accounts, categories, isGenerating, onGenerate, onSkip,
}: {
  r: RecurringTransaction
  accounts: { id: string; name: string; color: string }[]
  categories: { id: string; name: string; icon: string; color: string }[]
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
          {category && <CategoryIcon icon={category.icon} color={category.color} size={16} />}
          <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
          <Badge variant={r.type === 'income' ? 'ok' : r.type === 'transfer' ? 'info' : 'danger'}>
            {FREQ_LABEL[r.frequency]}
          </Badge>
        </div>
        <div className="text-xs font-medium text-muted-foreground mt-0.5 flex items-center gap-2">
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
        <span className={`font-medium tabular-nums text-lg ${r.type === 'income' ? 'text-green-600' : r.type === 'transfer' ? 'text-blue-500' : 'text-destructive'}`}>
          {r.type === 'income' ? '+' : r.type === 'expense' ? '−' : '⇄'}{formatCurrency(r.amount)}
        </span>
        <button
          onClick={onSkip}
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 border border-border rounded-xl"
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
  categories: { id: string; name: string; icon: string; color: string }[]
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
          {category && <CategoryIcon icon={category.icon} color={category.color} size={16} />}
          <span className="font-semibold text-sm text-foreground truncate">{r.name}</span>
          <Badge variant={r.type === 'income' ? 'ok' : r.type === 'transfer' ? 'info' : 'default'}>
            {FREQ_LABEL[r.frequency]}
          </Badge>
        </div>
        <div className="text-xs font-medium text-muted-foreground mt-0.5 flex items-center gap-2">
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
        <span className={`tabular-nums text-lg font-medium ${r.type === 'income' ? 'text-green-600' : 'text-muted-foreground'}`}>
          {formatCurrency(r.amount)}
        </span>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          <button onClick={onEdit} className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors" title="Düzenle">✎</button>
          <button
            onClick={onToggle}
            className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent text-xs transition-colors"
            title={r.isActive ? 'Durdur' : 'Aktif et'}
          >
            {r.isActive ? '⏸' : '▶'}
          </button>
          {isConfirm ? (
            <div className="flex items-center gap-1">
              <button onClick={onDelete} className="px-2 h-6 rounded-full bg-destructive text-white text-xs font-semibold">Sil</button>
              <button onClick={onCancelDelete} className="w-6 h-6 rounded-full border border-border text-muted-foreground text-xs">✕</button>
            </div>
          ) : (
            <button onClick={onConfirmDelete} className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-accent text-base transition-colors">×</button>
          )}
        </div>
      </div>
    </div>
  )
}
