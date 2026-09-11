'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { SelectField as Select } from '@/components/ui/Select'
import { formatCurrency, formatNumberForInput, parseCurrencyInput } from '@/lib/utils/currency'
import { roundMoney } from '@/lib/utils/money'
import { savePlanSettings } from '@/lib/payments/actions'
import type { PaymentTarget } from '@/lib/payments/schedule'
import type { Account } from '@/types'
import { TargetMark, Toggle, kindLabel, monthTitle } from './board/bits'

/* ── Kart / borç takip ayarları ──────────────────────────────────────────────
   Hedefin varsayılanları: ödeme günü, ödeme hesabı, aylık tutar, takip
   başlangıcı. Kartta ödeme günü ZORUNLU — girilene kadar kart takvime ve
   toplamlara katılmaz (varsayım yapılmaz). Ay bazındaki özel değerler ve
   ödenmiş aylar korunur; bu aydan önceki aylar eski değerleriyle sabitlenir
   (bkz. actions.freezeBefore). */

interface Props {
  target: PaymentTarget | null
  accounts: Account[]
  onClose: () => void
}

export function PlanSettingsModal({ target, accounts, onClose }: Props) {
  return (
    <Modal open={!!target} onClose={onClose} title={target ? `${target.name} · takip ayarları` : undefined} size="md">
      {target && <PlanForm key={target.key} target={target} accounts={accounts} onClose={onClose} />}
    </Modal>
  )
}

function PlanForm({ target, accounts, onClose }: { target: PaymentTarget; accounts: Account[]; onClose: () => void }) {
  const plan = target.plan
  const cur = target.currency
  const isCard = target.kind === 'card'
  const payable = accounts.filter(a => !a.isArchived && a.id !== target.id)

  const [dayStr, setDayStr] = useState(target.dayOfMonth !== null ? String(target.dayOfMonth) : '')
  const [fromAccountId, setFromAccountId] = useState(target.defaultFromAccountId ?? '')
  const [amountStr, setAmountStr] = useState(plan?.amount != null ? formatNumberForInput(plan.amount) : '')
  const [startMonth, setStartMonth] = useState(target.startMonth)
  const [isActive, setIsActive] = useState(target.isActive)
  const [notes, setNotes] = useState(plan?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const amountHint = isCard
    ? 'Boş bırakırsan her ay ekstre gelince tutarı sen girersin. Kartta her ay aynı tutar ödeniyorsa (ör. sabit taksit) buraya yaz.'
    : target.debt?.monthlyPayment
      ? `Boş bırakırsan borcun aylık taksiti kullanılır (${formatCurrency(target.debt.monthlyPayment)}).`
      : 'Borçta aylık taksit tanımlı değil; tutar girmezsen aylar "tutar girilmedi" görünür.'

  async function save() {
    const raw = amountStr.trim()
    const amount = raw ? parseCurrencyInput(raw) : null
    const day = Number(dayStr)
    if (!dayStr.trim() || !Number.isInteger(day) || day < 1 || day > 31) {
      setError(isCard ? 'Kartın son ödeme gününü 1 ile 31 arasında girin.' : 'Ödeme günü 1 ile 31 arasında olmalı.')
      return
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) { setError('Geçerli bir tutar girin.'); return }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) { setError('Takip başlangıcını YYYY-AA biçiminde girin.'); return }
    setBusy(true)
    setError('')
    try {
      await savePlanSettings(target, {
        amount: amount === null ? null : roundMoney(amount),
        fromAccountId: fromAccountId || null,
        dayOfMonth: day,
        startMonth,
        isActive,
        notes: notes.trim() || null,
      })
      onClose()
    } catch (err) {
      console.error('[payments:plan]', err)
      setError('Kaydedilemedi. Tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
        <TargetMark target={target} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{target.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {kindLabel(target)} · {isCard ? 'uygulamadaki bakiye' : 'kalan'} {formatCurrency(target.outstanding, cur)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Takipte</span>
          <Toggle checked={isActive} onChange={() => setIsActive(v => !v)} label="Takipte" />
        </div>
      </div>

      {target.needsSetup && (
        <p className="text-[12px] rounded-lg border border-dashed border-amber-500/50 px-3 py-2">
          <span className="font-semibold text-amber-600">Ödeme günü girilmedi.</span>{' '}
          <span className="text-muted-foreground">
            Ekstrendeki son ödeme gününü gir. Gün girilene kadar bu kart listeye, gecikme uyarılarına ve toplamlara katılmaz.
          </span>
        </p>
      )}

      {!isActive && (
        <p className="text-[12px] text-amber-600">
          Takipten çıkarılınca bu {isCard ? 'kart' : 'borç'} hiçbir görünümde çıkmaz. Girdiğin aylık kayıtlar silinmez.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={isCard ? 'Son ödeme günü' : 'Ödeme günü'}
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          value={dayStr}
          onChange={e => { setDayStr(e.target.value); if (error) setError('') }}
          placeholder="Örn. 15"
          hint="Kısa aylarda ayın son günü kullanılır."
          autoFocus={target.needsSetup}
        />
        {/* '' seçeneği şart: Radix değer eşleşmeyince placeholder yerine boş çizer. */}
        <Select
          label="Varsayılan ödeme hesabı"
          value={fromAccountId}
          onChange={e => setFromAccountId(e.target.value)}
          options={[
            { value: '', label: 'Hesap seçilmedi' },
            ...payable.map(a => ({ value: a.id, label: `${a.name} (${a.currency})` })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <CurrencyInput label="Aylık sabit tutar (isteğe bağlı)" value={amountStr} currency={cur} onChange={setAmountStr} placeholder="Boş = her ay girilir" />
        <p className="text-[11px] text-muted-foreground">{amountHint}</p>
      </div>

      <Input
        label="Takip başlangıcı"
        type="month"
        value={startMonth}
        onChange={e => setStartMonth(e.target.value)}
        placeholder="2026-09"
        hint={`${/^\d{4}-\d{2}$/.test(startMonth) ? monthTitle(startMonth) : 'Bu ay'}dan önceki ödenmemiş aylar gecikmiş sayılmaz.`}
      />

      <Input label="Not" value={notes} onChange={e => setNotes(e.target.value)} placeholder="İsteğe bağlı" />

      <p className="text-[11px] text-muted-foreground rounded-lg bg-secondary/40 px-3 py-2">
        Varsayılanlar bu aydan itibaren geçerli olur. Önceki aylar şimdiki değerleriyle korunur; ödenmiş aylar ve
        tek tek düzenlediğin aylar değişmez.
      </p>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={save} loading={busy} fullWidth>Kaydet</Button>
        <Button variant="secondary" onClick={onClose} fullWidth>Vazgeç</Button>
      </div>
    </div>
  )
}
