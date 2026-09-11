'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { DateStepperInput } from '@/components/ui/DateStepperInput'
import { SelectField as Select } from '@/components/ui/Select'
import { formatCurrency, formatNumberForInput, parseCurrencyInput } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { roundMoney } from '@/lib/utils/money'
import {
  dueDateFor, estimateStatement, isActionable, statementWindow,
  type PaymentRow, type PaymentTarget,
} from '@/lib/payments/schedule'
import { resetRowOverrides, saveRowEdit, setRowStatus, unpayRow } from '@/lib/payments/actions'
import type { Account, Transaction } from '@/types'
import { StatusPill, TargetMark, dayMonth, dueLabel, kindLabel, monthTitle, rowTone } from './board/bits'

/* ── Tek bir ayın ödemesini düzenleme ────────────────────────────────────────
   Tutar, ödeme tarihi ve ödeme hesabı bu ay için (ya da bu ve sonraki aylar
   için) değiştirilir. Durum eylemleri — öde, atla, ödendi işaretini kaldır,
   varsayılana dön — da buradan. */

interface Props {
  row: PaymentRow | null
  accounts: Account[]
  transactions: Transaction[]
  onClose: () => void
  onPay: (row: PaymentRow) => void
  onSettings: (target: PaymentTarget) => void
}

export function PaymentEditModal({ row, ...rest }: Props) {
  return (
    <Modal
      open={!!row}
      onClose={rest.onClose}
      title={row ? `${row.target.name} · ${monthTitle(row.month)}` : undefined}
      size="md"
    >
      {/* key: başka bir satıra geçince form durumu sıfırlansın */}
      {row && <EditForm key={`${row.target.key}|${row.month}`} row={row} {...rest} />}
    </Modal>
  )
}

type Scope = 'month' | 'forward'

function quickAmounts(target: PaymentTarget, estimate: number | null): { label: string; value: number }[] {
  const all: { label: string; value: number }[] = []
  if (target.kind === 'card') {
    if (estimate) all.push({ label: 'Ekstre tahmini', value: estimate })
    all.push({ label: 'Güncel borç', value: target.outstanding })
    const pct = target.account?.minPayPct ?? 3
    all.push({ label: `Asgari %${pct}`, value: roundMoney((target.outstanding * pct) / 100) })
  } else {
    if (target.debt?.monthlyPayment) all.push({ label: 'Aylık taksit', value: target.debt.monthlyPayment })
    all.push({ label: 'Kalan borç', value: target.outstanding })
  }
  const seen = new Set<number>()
  const out: { label: string; value: number }[] = []
  for (const c of all) {
    if (c.value <= 0 || seen.has(c.value)) continue
    seen.add(c.value)
    out.push(c)
  }
  return out
}

function EditForm({ row, accounts, transactions, onClose, onPay, onSettings }: Omit<Props, 'row'> & { row: PaymentRow }) {
  const { target } = row
  const cur = target.currency

  const [amountStr, setAmountStr] = useState(
    row.custom.amount && row.amount !== null ? formatNumberForInput(row.amount) : '',
  )
  const [fromAccountId, setFromAccountId] = useState(row.fromAccountId ?? '')
  const [dueDate, setDueDate] = useState(row.dueDate)
  const [note, setNote] = useState(row.note ?? '')
  const [scope, setScope] = useState<Scope>('month')
  const [busy, setBusy] = useState(false)
  const [confirmUnpay, setConfirmUnpay] = useState(false)
  const [error, setError] = useState('')

  const estimate = target.account && dueDate ? estimateStatement(target.account, dueDate, transactions) : null
  const defaultAmount = target.defaultAmount ?? estimate
  const defaultDue = dueDateFor(row.month, target.dayOfMonth)
  const payable = accounts.filter(a => !a.isArchived && a.id !== target.id)
  const chips = quickAmounts(target, estimate)
  const tone = rowTone(row)
  const linkedTxId = row.occurrence?.transactionId ?? null
  const linkedTxExists = !!linkedTxId && transactions.some(t => t.id === linkedTxId)
  const hasCustom = row.custom.amount || row.custom.dueDate || row.custom.fromAccount

  let amountHint: string
  if (target.defaultAmount !== null) {
    amountHint = target.defaultAmountSource === 'derived'
      ? `Boş bırakırsan borcun aylık taksiti kullanılır: ${formatCurrency(target.defaultAmount, cur)}.`
      : `Boş bırakırsan varsayılan tutar kullanılır: ${formatCurrency(target.defaultAmount, cur)}.`
  } else if (target.account && dueDate) {
    const w = statementWindow(target.account, dueDate)
    amountHint = `Boş bırakırsan ekstre tahmini kullanılır: ${formatCurrency(estimate ?? 0, cur)} (${dayMonth(w.from)} – ${dayMonth(w.to)} kart harcaması).`
  } else {
    amountHint = 'Bu borç için aylık tutar tanımlı değil. Tutarı gir ya da borç ayarlarından varsayılan belirle.'
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      onClose()
    } catch (err) {
      console.error('[payments:edit]', err)
      setError('Kaydedilemedi. Tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  function save() {
    const raw = amountStr.trim()
    const amount = raw ? parseCurrencyInput(raw) : null
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError('Geçerli bir tutar girin.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError('Ödeme tarihini seçin.')
      return
    }
    void run(() => saveRowEdit(row, {
      amount: amount === null ? null : roundMoney(amount),
      fromAccountId: fromAccountId || null,
      dueDate,
      note: note.trim() || null,
    }, scope))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Künye */}
      <div className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
        <TargetMark target={target} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-muted-foreground truncate">
            {kindLabel(target)} · vade {formatDate(row.dueDate, 'd MMMM EEEE')}
          </div>
          <div className={`text-[12.5px] font-medium ${tone.text}`}>{dueLabel(row)}</div>
        </div>
        <StatusPill row={row} />
      </div>

      {row.paidVia === 'detected' && (
        <p className="text-[12px] text-muted-foreground rounded-lg bg-secondary/40 px-3 py-2">
          {target.kind === 'card' ? 'Karta' : 'Bu borca'} bu ayın ödeme döneminde{' '}
          <span className="font-semibold text-foreground">{formatCurrency(row.paidAmount, cur)}</span> ödeme işlemi bulundu
          {row.paidDate ? ` (son: ${dayMonth(row.paidDate)})` : ''}; ay otomatik olarak {row.state === 'paid' ? 'ödendi' : 'kısmen ödendi'} sayılıyor.
        </p>
      )}
      {row.paidVia === 'manual' && (
        <p className="text-[12px] text-muted-foreground rounded-lg bg-secondary/40 px-3 py-2">
          {row.paidDate ? `${formatDate(row.paidDate, 'd MMMM')} tarihinde ` : ''}
          <span className="font-semibold text-foreground">{formatCurrency(row.paidAmount, cur)}</span> ödendi olarak işaretlendi
          {linkedTxExists ? ' (hesaptan işlem olarak kaydedildi).' : ' (işlem oluşturulmadı).'}
        </p>
      )}

      {/* Tutar */}
      <div className="flex flex-col gap-1.5">
        <CurrencyInput
          label="Ödenecek tutar"
          value={amountStr}
          currency={cur}
          onChange={v => { setAmountStr(v); if (error) setError('') }}
          placeholder={defaultAmount !== null ? formatNumberForInput(defaultAmount) : 'Tutar girin'}
        />
        <p className="text-[11px] text-muted-foreground">{amountHint}</p>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map(c => (
              <button
                key={c.label}
                type="button"
                onClick={() => setAmountStr(formatNumberForInput(c.value))}
                className="h-6 px-2 rounded-md bg-secondary text-[11px] font-medium tabular-nums hover:bg-secondary/70 transition-colors"
              >
                {c.label}: {formatCurrency(c.value, cur)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tarih + hesap */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Ödeme tarihi</span>
          <DateStepperInput value={dueDate} onValueChange={setDueDate} aria-label="Ödeme tarihi" />
          {dueDate !== defaultDue && (
            <button
              type="button"
              onClick={() => setDueDate(defaultDue)}
              className="self-start text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Varsayılana al: {formatDate(defaultDue, 'd MMMM')}
            </button>
          )}
        </div>
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
      </div>

      <Input label="Not" value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı" />

      {/* Kapsam */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Değişiklik nereye uygulansın?</span>
        <div role="radiogroup" aria-label="Kapsam" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-secondary/60">
          {([['month', 'Yalnız bu ay'], ['forward', 'Bu ve sonraki aylar']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={scope === key}
              onClick={() => setScope(key)}
              className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                scope === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {scope === 'month'
            ? `Yalnız ${monthTitle(row.month)} değişir; diğer aylar varsayılanı kullanmaya devam eder.`
            : `${monthTitle(row.month)} ve sonraki aylar için varsayılan olur (ödeme günü = seçtiğin tarihin günü). Önceki aylar şimdiki değerleriyle korunur; kendine özel değeri olan aylar değişmez.`}
        </p>
      </div>

      {error && <p className="text-[12px] text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={save} loading={busy} fullWidth>Kaydet</Button>
        <Button variant="secondary" onClick={onClose} fullWidth>Vazgeç</Button>
      </div>

      {/* Durum eylemleri */}
      <div className="border-t border-border pt-3 flex flex-wrap items-center gap-2">
        {isActionable(row) && (
          <Button size="sm" variant="ok" onClick={() => onPay(row)} disabled={busy}>Öde…</Button>
        )}
        {isActionable(row) && (
          <Button size="sm" variant="outline" onClick={() => run(() => setRowStatus(row, 'skipped'))} disabled={busy}>
            Bu ayı atla
          </Button>
        )}
        {row.state === 'skipped' && (
          <Button size="sm" variant="outline" onClick={() => run(() => setRowStatus(row, null))} disabled={busy}>
            Atlamayı geri al
          </Button>
        )}
        {row.paidVia === 'manual' && !confirmUnpay && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => (linkedTxExists
              ? setConfirmUnpay(true)
              : run(() => unpayRow(row, { deleteTransaction: false })))}
          >
            Ödendi işaretini kaldır
          </Button>
        )}
        {hasCustom && row.paidVia !== 'manual' && (
          <Button size="sm" variant="ghost" onClick={() => run(() => resetRowOverrides(row))} disabled={busy}>
            Varsayılana dön
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onSettings(target)}>
          {target.kind === 'card' ? 'Kart' : 'Borç'} ayarları
        </Button>
      </div>

      {confirmUnpay && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex flex-col gap-2">
          <p className="text-[12.5px]">Bu ödeme kaydedilirken hesaptan bir işlem de oluşturulmuştu. İşlem de silinsin mi?</p>
          <p className="text-[11px] text-muted-foreground">
            Silersen hesap bakiyesi{target.kind === 'debt' ? ' ve borcun ödenen tutarı' : ' ve kart borcu'} eski haline döner;
            silme bildiriminden geri alabilirsin. Silmezsen işlem kalır, yalnız bu ayın işareti kalkar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => run(() => unpayRow(row, { deleteTransaction: true }))} disabled={busy}>
              İşlemi de sil
            </Button>
            <Button size="sm" variant="outline" onClick={() => run(() => unpayRow(row, { deleteTransaction: false }))} disabled={busy}>
              Yalnız işareti kaldır
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmUnpay(false)} disabled={busy}>Vazgeç</Button>
          </div>
        </div>
      )}
    </div>
  )
}
