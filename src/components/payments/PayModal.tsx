'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { Checkbox } from '@/components/ui/Checkbox'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { DateStepperInput } from '@/components/ui/DateStepperInput'
import { SelectField as Select } from '@/components/ui/Select'
import { formatCurrency, formatNumberForInput, parseCurrencyInput } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { fromBaseTry, toBaseTry } from '@/lib/utils/fx'
import { roundMoney } from '@/lib/utils/money'
import { payRow } from '@/lib/payments/actions'
import type { PaymentRow } from '@/lib/payments/schedule'
import type { Account } from '@/types'
import { TargetMark, fmtAmount, monthTitle } from './board/bits'

/* ── Ödeme yap ───────────────────────────────────────────────────────────────
   Varsayılan: kaynak hesaptan gerçek bir işlem oluşturulur (kart → transfer,
   borç → borç ödemesi) ve ay "ödendi" işaretlenir. Ödemeyi zaten işlem olarak
   girmiş kullanıcı kutuyu kaldırıp yalnız işaretleyebilir — bakiyeler değişmez. */

interface Props {
  row: PaymentRow | null
  accounts: Account[]
  onClose: () => void
}

export function PayModal({ row, accounts, onClose }: Props) {
  return (
    <Modal open={!!row} onClose={onClose} title="Ödeme Yap" size="sm">
      {row && <PayForm key={`${row.target.key}|${row.month}`} row={row} accounts={accounts} onClose={onClose} />}
    </Modal>
  )
}

function PayForm({ row, accounts, onClose }: { row: PaymentRow; accounts: Account[]; onClose: () => void }) {
  const { target } = row
  const cur = target.currency
  const payable = accounts.filter(a => !a.isArchived && a.id !== target.id)
  const suggested = row.remaining > 0 ? row.remaining : (row.amount ?? 0)
  const initialFrom = row.fromAccountId && payable.some(a => a.id === row.fromAccountId)
    ? row.fromAccountId
    : (payable.find(a => a.type !== 'credit_card')?.id ?? '')

  const [amountStr, setAmountStr] = useState(suggested > 0 ? formatNumberForInput(suggested) : '')
  const [fromAccountId, setFromAccountId] = useState(initialFrom)
  const [date, setDate] = useState(today())
  const [createTx, setCreateTx] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const from = payable.find(a => a.id === fromAccountId)
  const amount = parseCurrencyInput(amountStr)
  const converted = from && from.currency !== cur && amount > 0
    ? roundMoney(fromBaseTry(toBaseTry(amount, cur), from.currency))
    : null

  async function submit() {
    if (!amount || amount <= 0) { setError('Ödeme tutarını girin.'); return }
    if (createTx && !from) { setError('Ödemenin çıkacağı hesabı seçin.'); return }
    setBusy(true)
    setError('')
    try {
      await payRow(row, {
        amount: roundMoney(amount),
        fromAccountId: fromAccountId || null,
        date,
        createTransaction: createTx,
        note: note.trim() || null,
      })
      onClose()
    } catch (err) {
      console.error('[payments:pay]', err)
      setError('Ödeme kaydedilemedi. Tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  const sourceName = from?.name ?? 'Seçilen hesap'
  const txExplain = target.kind === 'card'
    ? `${sourceName} → ${target.name} transferi oluşturulur; kart borcu ve hesap bakiyesi güncellenir.`
    : `${sourceName} hesabından "${target.name} ödemesi" kaydedilir; borcun ödenen tutarı artar.`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
        <TargetMark target={target} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{target.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {monthTitle(row.month)} · vade {formatDate(row.dueDate, 'd MMMM')} · {fmtAmount(row)}
          </div>
        </div>
      </div>

      {row.state === 'partial' && (
        <p className="text-[12px] text-amber-600">
          Bu ay için {formatCurrency(row.paidAmount, cur)} ödeme zaten bulundu; kalan {formatCurrency(row.remaining, cur)}.
        </p>
      )}

      <CurrencyInput
        label="Ödeme tutarı"
        value={amountStr}
        currency={cur}
        onChange={v => { setAmountStr(v); if (error) setError('') }}
        autoFocus
      />
      {converted !== null && from && (
        <p className="text-[11px] text-muted-foreground -mt-1">
          ≈ {formatCurrency(converted, from.currency)} olarak {from.name} hesabından çıkar (güncel kurla).
        </p>
      )}

      {/* '' seçeneği şart: Radix değer eşleşmeyince placeholder yerine boş çizer. */}
      <Select
        label="Ödeme hesabı"
        value={fromAccountId}
        onChange={e => setFromAccountId(e.target.value)}
        options={[
          { value: '', label: 'Hesap seçilmedi' },
          ...payable.map(a => ({ value: a.id, label: `${a.name} (${a.currency})` })),
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Ödeme tarihi</span>
        <DateStepperInput value={date} onValueChange={setDate} aria-label="Ödeme tarihi" />
      </div>

      <Input label="Not" value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı" />

      <div className="flex items-start gap-2.5 rounded-xl border border-border p-3">
        <Checkbox checked={createTx} onChange={() => setCreateTx(v => !v)} aria-label="Hesaptan işlem olarak kaydet" className="mt-0.5" />
        <button type="button" onClick={() => setCreateTx(v => !v)} className="text-left min-w-0">
          <span className="block text-sm font-medium">Hesaptan işlem olarak kaydet</span>
          <span className="block text-[11px] text-muted-foreground">
            {createTx
              ? txExplain
              : 'Yalnızca bu ay ödendi olarak işaretlenir; hiçbir bakiye değişmez. Ödemeyi zaten işlem olarak girdiysen bunu seç.'}
          </span>
        </button>
      </div>

      {createTx && date > today() && (
        <p className="text-[11px] text-sky-600">İleri tarihli işlem, tarihi gelince bildirim merkezinde onay bekler.</p>
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex flex-col gap-2 pt-1">
        <Button onClick={submit} loading={busy} fullWidth>Ödemeyi Kaydet</Button>
        <Button variant="secondary" onClick={onClose} fullWidth>İptal</Button>
      </div>
    </div>
  )
}
