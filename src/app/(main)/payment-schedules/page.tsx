'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { usePaymentSchedulesStore, useAccountStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SelectField as Select } from '@/components/ui/Select'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { formatNumberForInput, parseCurrencyInput } from '@/lib/utils/currency'
import { today, formatDate } from '@/lib/utils/date'
import { dueDateForMonth, hasOverride, overrideBounds, validateOverride } from '@/lib/utils/paymentSchedule'
import type { PaymentSchedule, PaymentScheduleType } from '@/types'
import { resolveDisplay } from '@/components/payments/board/shared'
import { TimelineView } from '@/components/payments/board/TimelineView'
import { ConsoleView } from '@/components/payments/board/ConsoleView'

const TYPE_OPTIONS = [
  { value: 'credit_card', label: 'Kredi Kartı' },
  { value: 'loan',        label: 'Kredi' },
  { value: 'other',       label: 'Diğer' },
]

type ViewId = 'timeline' | 'console'

const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: 'timeline', label: 'Zaman Çizelgesi', hint: 'Aciliyete göre gruplanmış kronolojik liste — önce hangisiyle ilgilenmeliyim?' },
  { id: 'console',  label: 'Konsol Tablo',     hint: 'Filtrelenebilir, sıralanabilir yoğun tablo — çok sayıda kayıt için' },
]

const VIEW_STORAGE_KEY = 'paymentSchedules.viewMode'

/* Düzen tercihi kalıcı. useState başlatıcısında localStorage okumak sunucu
   HTML'i ('timeline') ile istemcinin ilk render'ını ayrıştırıyordu (hydration
   uyuşmazlığı → seçili buton yanlış vurgulanıyordu). useSyncExternalStore
   hydration'da sunucu değerini kullanır, sonra kayıtlı değere geçer.
   Depolama kapalıysa seçim bellekte tutulur. */
let memoryView: ViewId | null = null
const viewListeners = new Set<() => void>()

function readView(): ViewId {
  if (memoryView) return memoryView
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return VIEWS.some(v => v.id === saved) ? (saved as ViewId) : 'timeline'
  } catch {
    return 'timeline'
  }
}

function subscribeView(cb: () => void): () => void {
  viewListeners.add(cb)
  return () => { viewListeners.delete(cb) }
}

function writeView(id: ViewId): void {
  memoryView = id
  try { window.localStorage.setItem(VIEW_STORAGE_KEY, id) } catch { /* özel pencere: bellekte kalır */ }
  viewListeners.forEach(l => l())
}

function emptyForm() {
  return {
    name: '', type: 'credit_card' as PaymentScheduleType, dueDay: '5',
    amountStr: '', accountId: '', notes: '',
  }
}

type FormErrors = Partial<Record<'name' | 'dueDay' | 'amount', string>>

export default function PaymentSchedulesPage() {
  const schedules      = usePaymentSchedulesStore(useShallow(s => s.schedules))
  const add            = usePaymentSchedulesStore(s => s.add)
  const update         = usePaymentSchedulesStore(s => s.update)
  const remove         = usePaymentSchedulesStore(s => s.remove)
  const toggleActive   = usePaymentSchedulesStore(s => s.toggleActive)
  const setOverride    = usePaymentSchedulesStore(s => s.setOverride)
  const clearOverride  = usePaymentSchedulesStore(s => s.clearOverride)
  const markPaid       = usePaymentSchedulesStore(s => s.markPaid)
  // Adlar ARŞİVLİ hesaplar dahil gösterilir; seçim listesi yalnızca aktifler.
  const allAccounts    = useAccountStore(useShallow(s => s.accounts))
  const accounts       = useMemo(() => allAccounts.filter(a => !a.isArchived), [allAccounts])

  const todayStr = today()

  const view = useSyncExternalStore(subscribeView, readView, () => 'timeline' as ViewId)

  const resolved = useMemo(
    () => schedules.filter(s => s.isActive).map(s => resolveDisplay(s, todayStr)),
    [schedules, todayStr],
  )
  const inactive = useMemo(() => schedules.filter(s => !s.isActive), [schedules])

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<PaymentSchedule | undefined>()
  const [form, setForm]         = useState(emptyForm())
  const [errors, setErrors]     = useState<FormErrors>({})
  const [loading, setLoading]   = useState(false)

  const [overrideTarget, setOverrideTarget]     = useState<PaymentSchedule | undefined>()
  const [overrideMonthKey, setOverrideMonthKey] = useState('')
  const [overrideDate, setOverrideDate]         = useState('')
  const [overrideError, setOverrideError]       = useState('')

  // Düzenlenen takvim arşivli bir hesaba bağlıysa o hesap da seçenek olarak
  // kalsın — yoksa select boş görünür ve bağlantı fark edilmeden düşer.
  const accountOptions = useMemo(() => {
    const opts = accounts.map(a => ({ value: a.id, label: a.name }))
    const linked = allAccounts.find(a => a.id === form.accountId)
    if (linked?.isArchived) opts.push({ value: linked.id, label: `${linked.name} (arşivli)` })
    return [{ value: '', label: 'Yok' }, ...opts]
  }, [accounts, allAccounts, form.accountId])
  const formCurrency = allAccounts.find(a => a.id === form.accountId)?.currency ?? 'TRY'

  function startAdd() {
    setEditing(undefined)
    setForm(emptyForm())
    setErrors({})
    setShowForm(true)
  }

  function startEdit(s: PaymentSchedule) {
    setEditing(s)
    setForm({
      name:      s.name,
      type:      s.type,
      dueDay:    String(s.dueDay),
      // String(n) DEĞİL: "1234.5" maske tarafından binlik sanılıp 100 katına çıkar.
      amountStr: s.amount ? formatNumberForInput(s.amount) : '',
      accountId: s.accountId ?? '',
      notes:     s.notes ?? '',
    })
    setErrors({})
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(undefined)
    setForm(emptyForm())
    setErrors({})
  }

  async function handleSave() {
    const name   = form.name.trim()
    const dueDay = Number(form.dueDay)
    const amount = parseCurrencyInput(form.amountStr)
    const next: FormErrors = {}
    if (!name) next.name = 'Ad gerekli.'
    // Tam sayı şartı: "5.5" eskiden geçiyor, "2026-09-5.5" gibi bozuk bir tarih
    // üretip sayfayı çökertiyordu (Supabase integer kolonu da reddeder).
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) next.dueDay = '1 ile 31 arasında bir tam sayı girin.'
    if (amount < 0) next.amount = 'Tutar negatif olamaz.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setLoading(true)
    try {
      const patch = {
        name,
        type:      form.type,
        dueDay,
        amount:    amount || undefined,
        accountId: form.accountId || undefined,
        notes:     form.notes.trim() || undefined,
      }
      if (editing) {
        await update(editing.id, patch)
      } else {
        const s: PaymentSchedule = {
          ...patch,
          id:        crypto.randomUUID(),
          isActive:  true,
          createdAt: new Date().toISOString(),
        }
        await add(s)
      }
      closeForm()
    } catch (err) {
      console.error('[payment-schedule:save]', err)
    } finally {
      setLoading(false)
    }
  }

  function openOverride(s: PaymentSchedule, monthKey: string) {
    setOverrideTarget(s)
    setOverrideMonthKey(monthKey)
    setOverrideDate(dueDateForMonth(s, monthKey))
    setOverrideError('')
  }

  function closeOverride() {
    setOverrideTarget(undefined)
    setOverrideMonthKey('')
    setOverrideDate('')
    setOverrideError('')
  }

  async function handleSaveOverride() {
    if (!overrideTarget) return
    const invalid = validateOverride(overrideTarget, overrideMonthKey, overrideDate)
    if (invalid) { setOverrideError(invalid); return }
    try {
      await setOverride(overrideTarget.id, overrideMonthKey, overrideDate)
      closeOverride()
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    }
  }

  async function handleResetOverride() {
    if (!overrideTarget) return
    await clearOverride(overrideTarget.id, overrideMonthKey)
    closeOverride()
  }

  const bounds = overrideTarget ? overrideBounds(overrideTarget, overrideMonthKey) : undefined

  return (
    <>
      <Header title="Ödeme Takvimi" action={{ label: 'Ekle', onClick: startAdd }} />

      <div className="p-6 flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Görünüm</span>
          <div className="flex items-center gap-1">
            {VIEWS.map(v => (
              <button
                key={v.id}
                onClick={() => writeView(v.id)}
                title={v.hint}
                aria-pressed={view === v.id}
                className={[
                  'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                  view === v.id
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                ].join(' ')}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {view === 'timeline' ? (
          <TimelineView
            resolved={resolved}
            inactive={inactive}
            accounts={allAccounts}
            onEdit={startEdit}
            onRemove={id => remove(id)}
            onToggleActive={id => toggleActive(id)}
            onOverride={openOverride}
            onMarkPaid={(id, monthKey) => markPaid(id, monthKey, todayStr)}
          />
        ) : (
          <ConsoleView
            resolved={resolved}
            inactive={inactive}
            accounts={allAccounts}
            onEdit={startEdit}
            onRemove={id => remove(id)}
            onToggleActive={id => toggleActive(id)}
            onOverride={openOverride}
            onMarkPaid={(id, monthKey) => markPaid(id, monthKey, todayStr)}
          />
        )}
      </div>

      {/* Add / Edit modal */}
      <Modal open={showForm} onClose={closeForm} title={editing ? 'Ödeme Takvimini Düzenle' : 'Ödeme Takvimi Ekle'} size="md" dismissible={false}>
        <div className="flex flex-col gap-3">
          <Input label="Ad" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ziraat Kredi Kartı" error={errors.name} />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Tür"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as PaymentScheduleType }))}
              options={TYPE_OPTIONS}
            />
            <Input
              label="Son Ödeme Günü"
              type="number"
              min={1}
              max={31}
              step={1}
              value={form.dueDay}
              onChange={e => setForm(f => ({ ...f, dueDay: e.target.value }))}
              hint="Ayın günü (1-31); kısa aylarda ay sonuna sabitlenir."
              error={errors.dueDay}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CurrencyInput
              label="Tahmini Tutar (opsiyonel)"
              currency={formCurrency}
              value={form.amountStr}
              onChange={v => setForm(f => ({ ...f, amountStr: v }))}
              error={errors.amount}
            />
            <Select
              label="Hesap (opsiyonel)"
              value={form.accountId}
              onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
              options={accountOptions}
              placeholder="Yok"
            />
          </div>

          <Input label="Not (opsiyonel)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={handleSave} loading={loading} fullWidth>{editing ? 'Güncelle' : 'Kaydet'}</Button>
            <Button variant="secondary" onClick={closeForm} fullWidth>İptal</Button>
          </div>
        </div>
      </Modal>

      {/* Ay bazlı istisna modal'ı */}
      <Modal
        open={!!overrideTarget}
        onClose={closeOverride}
        title={overrideTarget ? `${overrideTarget.name} — ${formatDate(`${overrideMonthKey}-01`, 'MMMM yyyy')}` : ''}
        size="sm"
      >
        {overrideTarget && (
          <div className="flex flex-col gap-3">
            <Input
              label="Bu ayın son ödeme tarihi"
              type="date"
              value={overrideDate}
              min={bounds?.min}
              max={bounds?.max}
              onChange={e => { setOverrideDate(e.target.value); setOverrideError('') }}
              hint="Hafta sonu/tatil kayması gibi durumlarda yalnızca bu ay için değiştirir. Komşu aya taşabilir."
              error={overrideError || undefined}
            />
            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={handleSaveOverride} disabled={!overrideDate} fullWidth>Kaydet</Button>
              {hasOverride(overrideTarget, overrideMonthKey) && (
                <Button variant="secondary" onClick={handleResetOverride} fullWidth>Varsayılana Döndür</Button>
              )}
              <Button variant="secondary" onClick={closeOverride} fullWidth>İptal</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
