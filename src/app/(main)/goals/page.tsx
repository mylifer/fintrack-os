'use client'

import { useMemo, useState } from 'react'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { Header } from '@/components/layout/Header'
import { useAccountStore, useGoalsStore } from '@/store'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { SelectField } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { goalProgress, type GoalProgress } from '@/lib/utils/goals'
import type { SavingsGoal } from '@/types'

const MANUAL = ''

const GOAL_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#EAB308', '#14B8A6', '#6B7280']

const trAmount = (n: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n)

// ── Hedef kartı ───────────────────────────────────────────────────────────────

function GoalCard({ goal, progress, onEdit }: { goal: SavingsGoal; progress: GoalProgress; onEdit: () => void }) {
  const remove      = useGoalsStore(s => s.remove)
  const adjustSaved = useGoalsStore(s => s.adjustSaved)
  const [delta, setDelta] = useState('')
  const [busy, setBusy]   = useState(false)

  const manual = !progress.linkedAccount

  async function adjust(sign: 1 | -1) {
    const amount = parseCurrencyInput(delta)
    if (!amount) return
    setBusy(true)
    try {
      await adjustSaved(goal.id, sign * amount)
      setDelta('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="size-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: goal.color }} />
          <span className="text-sm font-semibold truncate">{goal.name}</span>
        </div>
        <div className="row-actions flex items-center gap-1 flex-shrink-0">
          {progress.done && <Badge variant="ok">Tamamlandı</Badge>}
          {progress.overdue && <Badge variant="danger">Süre doldu</Badge>}
          <button
            onClick={onEdit}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Düzenle"
            aria-label="Hedefi düzenle"
          >
            <IconPencil size={13} />
          </button>
          <button
            onClick={() => remove(goal.id)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Sil"
            aria-label="Hedefi sil"
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-medium tabular-nums">{formatCurrency(progress.current)}</span>
        <span className="text-xs text-muted-foreground">/ {formatCurrency(goal.targetAmount)}</span>
      </div>

      <ProgressBar percent={progress.percent} showLabel />

      <div className="text-xs text-muted-foreground flex flex-col gap-0.5">
        {progress.done ? (
          <span className="text-green-600">Hedefe ulaşıldı.</span>
        ) : progress.overdue ? (
          <span className="text-destructive">
            Hedef tarihi ({formatDate(goal.targetDate!)}) geçti — {formatCurrency(progress.remaining)} eksik.
          </span>
        ) : progress.monthlyNeeded !== null ? (
          <span>
            {formatDate(goal.targetDate!)} için{' '}
            <span className="font-medium text-foreground">ayda {formatCurrency(progress.monthlyNeeded)}</span>
            {' '}biriktirmelisin ({progress.monthsLeft} ay, {formatCurrency(progress.remaining)} kaldı).
          </span>
        ) : (
          <span>{formatCurrency(progress.remaining)} kaldı · hedef tarihi yok.</span>
        )}
        <span>
          {manual
            ? 'Elle takip ediliyor'
            : `İlerleme: ${progress.linkedAccount!.name} bakiyesi`}
        </span>
      </div>

      {manual && (
        <div className="flex items-center gap-2 pt-1">
          <CurrencyInput
            value={delta}
            onChange={setDelta}
            placeholder="Tutar"
            aria-label="Eklenecek ya da çıkarılacak tutar"
            className="h-8 text-sm"
          />
          <Button size="sm" variant="secondary" className="rounded-lg h-8" disabled={busy || !parseCurrencyInput(delta)} onClick={() => adjust(1)}>
            Ekle
          </Button>
          <Button size="sm" variant="ghost" className="rounded-lg h-8" disabled={busy || !parseCurrencyInput(delta)} onClick={() => adjust(-1)}>
            Çıkar
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Sayfa ─────────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const goals    = useGoalsStore(s => s.goals)
  const ready    = useGoalsStore(s => s.ready)
  const add      = useGoalsStore(s => s.add)
  const update   = useGoalsStore(s => s.update)
  const accounts = useAccountStore(s => s.accounts)

  const todayStr = today()
  const rows = useMemo(
    () => goals
      .map(goal => ({ goal, progress: goalProgress(goal, accounts, todayStr) }))
      // Süren hedefler önce (en yakın tarih başta), tamamlananlar sonda
      .sort((a, b) =>
        Number(a.progress.done) - Number(b.progress.done) ||
        (a.goal.targetDate ?? '9999').localeCompare(b.goal.targetDate ?? '9999') ||
        a.goal.name.localeCompare(b.goal.name, 'tr-TR')),
    [goals, accounts, todayStr],
  )

  const totals = useMemo(() => {
    const active = rows.filter(r => !r.progress.done)
    return {
      saved:   rows.reduce((s, r) => s + r.progress.current, 0),
      target:  rows.reduce((s, r) => s + r.goal.targetAmount, 0),
      monthly: active.reduce((s, r) => s + (r.progress.monthlyNeeded ?? 0), 0),
    }
  }, [rows])

  // ── Form ──────────────────────────────────────────────────────────────────
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<SavingsGoal | undefined>()
  const [name, setName]           = useState('')
  const [targetStr, setTargetStr] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [accountId, setAccountId] = useState(MANUAL)
  const [savedStr, setSavedStr]   = useState('')
  const [color, setColor]         = useState(GOAL_COLORS[0])
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  const accountOptions = [
    { value: MANUAL, label: 'Elle takip et' },
    ...accounts
      .filter(a => !a.isArchived || a.id === editing?.accountId)
      .map(a => ({ value: a.id, label: `${a.name} (${a.currency})` })),
  ]

  function openForm(goal?: SavingsGoal) {
    setEditing(goal)
    setName(goal?.name ?? '')
    setTargetStr(goal ? trAmount(goal.targetAmount) : '')
    setTargetDate(goal?.targetDate ?? '')
    setAccountId(goal?.accountId ?? MANUAL)
    setSavedStr(goal?.savedAmount ? trAmount(goal.savedAmount) : '')
    setColor(goal?.color ?? GOAL_COLORS[goals.length % GOAL_COLORS.length])
    setNotes(goal?.notes ?? '')
    setShowForm(true)
  }

  const targetAmount = parseCurrencyInput(targetStr)
  const canSave = !!name.trim() && targetAmount > 0

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const fields = {
        name:         name.trim(),
        targetAmount,
        targetDate:   targetDate || null,
        accountId:    accountId || null,
        // Hesaba bağlı hedefte elle tutar kullanılmaz ama silinmez: bağ
        // kaldırılırsa kaldığı yerden devam eder.
        savedAmount:  accountId ? (editing?.savedAmount ?? null) : Math.max(0, parseCurrencyInput(savedStr)),
        color,
        notes:        notes.trim() || null,
      }
      if (editing) {
        await update(editing.id, fields)
      } else {
        const now = new Date().toISOString()
        await add({ id: crypto.randomUUID(), ...fields, createdAt: now, updatedAt: now })
      }
      setShowForm(false)
    } catch (err) {
      console.error('[goal:save]', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Header title="Birikim Hedefleri" action={{ label: 'Hedef Ekle', onClick: () => openForm() }} />

      <div className="p-6 flex flex-col gap-4">
        {rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryTile label="Biriken" value={formatCurrency(totals.saved)} />
            <SummaryTile label="Toplam hedef" value={formatCurrency(totals.target)} />
            <SummaryTile label="Ayda gereken (tarihli hedefler)" value={formatCurrency(totals.monthly)} />
          </div>
        )}

        {ready && rows.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Henüz birikim hedefin yok"
            description="Tatil, araba, acil durum fonu… Hedefini ve tarihini gir; ayda ne kadar biriktirmen gerektiğini hesaplayalım."
            action={<Button size="sm" onClick={() => openForm()}>Hedef Ekle</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rows.map(({ goal, progress }) => (
              <GoalCard key={goal.id} goal={goal} progress={progress} onEdit={() => openForm(goal)} />
            ))}
          </div>
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Hedefi Düzenle' : 'Hedef Ekle'} size="sm">
        <div className="flex flex-col gap-4">
          <Input label="Hedef adı" value={name} onChange={e => setName(e.target.value)} placeholder="Yaz tatili" autoFocus />
          <CurrencyInput label="Hedef tutar" value={targetStr} onChange={setTargetStr} />
          <Input
            label="Hedef tarihi (opsiyonel)"
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            hint="Verirsen ayda ne kadar biriktirmen gerektiği hesaplanır."
          />
          <SelectField
            label="İlerleme nereden gelsin?"
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            options={accountOptions}
          />
          {accountId ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              Hesabın bakiyesi (TL karşılığı) birikim sayılır; işlemlerin kendiliğinden yansır.
            </p>
          ) : (
            <CurrencyInput label="Şu ana kadar biriken" value={savedStr} onChange={setSavedStr} />
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Renk</span>
            <div className="flex flex-wrap gap-2">
              {GOAL_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Renk ${c}`}
                  aria-pressed={color === c}
                  className={`size-6 rounded-full border-2 transition-transform ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <Input label="Not (opsiyonel)" value={notes} onChange={e => setNotes(e.target.value)} />

          <div className="flex flex-col gap-2">
            <Button onClick={handleSave} loading={saving} disabled={!canSave} fullWidth>
              {editing ? 'Güncelle' : 'Ekle'}
            </Button>
            <Button variant="secondary" onClick={() => setShowForm(false)} fullWidth>İptal</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium tabular-nums mt-0.5">{value}</div>
    </div>
  )
}
