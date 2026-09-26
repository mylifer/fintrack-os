'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { useAccountStore, usePaymentsStore, useTransactionStore } from '@/store'
import { buildCardStatements, type CardStatement, type StatementStatus } from '@/lib/utils/card-statement'
import { assignCardPayments } from '@/lib/payments/schedule'
import { planIdFor } from '@/lib/payments/ids'
import { cardCycle, dayOf, shiftMonthKey, type CardDays, type CycleOverride, type MonthKey } from '@/lib/payments/card-cycles'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import type { Account, PaymentOccurrence } from '@/types'

/* ── Kart Takvimi ─────────────────────────────────────────────────────────────
   Tüm kredi kartlarının ay ay kesim ve son ödeme tarihleri tek tabloda.
   Satır = kart (solda varsayılan günler), sütun = ÖDEME AYI (o ay ödenecek
   ekstre). Hücredeki tarih değiştirilince yalnız o ay için saklanır
   (PaymentOccurrence.statementDate / dueDate); varsayılana eşitlenirse özel
   kayıt kalkar. Aynı tarihler hesap sayfasındaki ekstrede, Ödeme Takibi'nde
   ve bildirimlerde kullanılır (lib/payments/card-cycles). */

const MONTHS_SHOWN = 6

const STATUS: Record<StatementStatus, { label: string; cls: string }> = {
  clear:   { label: 'Borç yok', cls: 'text-muted-foreground' },
  paid:    { label: 'Ödendi',   cls: 'text-green-600' },
  partial: { label: 'Kısmi',    cls: 'text-amber-600' },
  open:    { label: 'Bekliyor', cls: 'text-muted-foreground' },
  overdue: { label: 'Gecikti',  cls: 'text-destructive' },
}

const monthTitle = (m: MonthKey) => formatDate(`${m}-01`, 'MMMM yyyy')

function overrideMap(occurrences: PaymentOccurrence[], cardId: string): Map<MonthKey, CycleOverride> {
  return new Map(occurrences
    .filter(o => o.targetKind === 'card' && o.targetId === cardId && !o.deleted_at)
    .map(o => [o.month, { statementDate: o.statementDate ?? null, dueDate: o.dueDate ?? null }]))
}

export function CardCalendar() {
  const cards = useAccountStore(useShallow(s => s.accounts.filter(a => a.type === 'credit_card' && !a.isArchived)))
  const [start, setStart] = useState<MonthKey>(() => shiftMonthKey(today().slice(0, 7), -1))
  const months = useMemo(
    () => Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonthKey(start, i)),
    [start],
  )
  const current = today().slice(0, 7)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Önceki ay" onClick={() => setStart(shiftMonthKey(start, -1))}
            className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent">‹</button>
          <button type="button" onClick={() => setStart(shiftMonthKey(current, -1))}
            className="px-3 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent">Bugün</button>
          <button type="button" aria-label="Sonraki ay" onClick={() => setStart(shiftMonthKey(start, 1))}
            className="w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent">›</button>
        </div>
        <p className="text-xs text-muted-foreground flex-1 min-w-64">
          Her sütun o ay <span className="font-medium text-foreground">ödenecek</span> ekstredir. Bankanız bir ay tarihi kaydırdıysa
          (hafta sonu, tatil) o hücredeki tarihi değiştirin — yalnız o ay için saklanır ve <span className="text-primary font-medium">mavi</span> görünür;
          ↺ varsayılana döndürür. Soldaki günler her ay için varsayılandır.
        </p>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
          Kredi kartı hesabı yok. <Link href="/accounts" className="text-primary hover:underline">Hesaplar</Link>&apos;dan ekleyin.
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
          <table className="text-sm border-collapse min-w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card text-left font-medium px-3 sm:px-4 py-3 min-w-[150px] sm:min-w-[240px] border-b border-border/60">Kart · varsayılan günler</th>
                {months.map(m => (
                  <th key={m} className={`text-left font-medium px-3 py-3 min-w-[140px] sm:min-w-[168px] border-b border-border/60 capitalize ${m === current ? 'text-foreground' : ''}`}>
                    {monthTitle(m)}{m === current && <span className="ml-1 normal-case text-primary">· bu ay</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map(card => <CardRow key={card.id} card={card} months={months} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CardRow({ card, months }: { card: Account; months: MonthKey[] }) {
  const plan        = usePaymentsStore(s => s.plans.find(p => p.id === planIdFor('card', card.id)))
  const occurrences = usePaymentsStore(s => s.occurrences)
  const savePlan    = usePaymentsStore(s => s.savePlan)
  const saveOcc     = usePaymentsStore(s => s.saveOccurrence)
  const updateAcc   = useAccountStore(s => s.update)
  const accounts    = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)

  const days: CardDays = { statementDay: card.statementDay ?? null, dueDay: plan?.dayOfMonth ?? null }
  // %3 eski formun her karta yazdığı değerdi — girilmemiş sayılır
  const minPct = card.minPayPct && card.minPayPct !== 3 ? card.minPayPct : null
  const overrides = useMemo(() => overrideMap(occurrences, card.id), [occurrences, card.id])

  const todayStr = today()
  const byClosing = useMemo(() => {
    const r = buildCardStatements(card, transactions, {
      payments: assignCardPayments(accounts, transactions).get(card.id) ?? [],
      dueDay: days.dueDay, minPayPct: minPct, todayStr, count: 12, overrides,
    })
    const map = new Map<string, CardStatement | { open: true; total: number }>()
    for (const s of r.statements) map.set(s.period.to, s)
    map.set(r.open.period.to, { open: true, total: r.open.total })
    return map
  }, [card, transactions, accounts, days.dueDay, minPct, todayStr, overrides])

  const money = (n: number) => formatCurrency(n, card.currency)

  return (
    <tr className="border-b border-border/40 align-top">
      <td className="sticky left-0 z-10 bg-card px-3 sm:px-4 py-3 border-r border-border/40 max-w-[150px] sm:max-w-none">
        <Link href={`/accounts/${card.id}`} className="font-semibold text-foreground hover:underline flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: card.color }} />
          <span className="truncate">{card.name}</span>
        </Link>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <DayInput label="Kesim" value={card.statementDay ?? null} max={31}
            onCommit={v => updateAcc(card.id, { statementDay: v ?? undefined })} />
          <DayInput label="Son ödeme" value={days.dueDay} max={31}
            onCommit={v => savePlan('card', card.id, { dayOfMonth: v })} />
          <DayInput label="Asgari %" value={minPct} max={100} decimal
            onCommit={v => updateAcc(card.id, { minPayPct: v ?? undefined })} />
        </div>
        {!days.dueDay && (
          <p className="mt-1.5 text-[11px] text-amber-600">Son ödeme gününü girin — ay ay düzenleme ve Ödeme Takibi bununla açılır.</p>
        )}
        {card.statementDay === 1 && !days.dueDay && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">Kesim günü 1 görünüyor; hiç girilmemiş olabilir.</p>
        )}
      </td>
      {months.map(m => {
        const ov = overrides.get(m) ?? null
        const prevOv = overrides.get(shiftMonthKey(m, -1)) ?? null
        const c = cardCycle(days, m, ov, prevOv)
        // Bu ayın özel tarihleri olmasaydı hesaplanacak değerler (varsayılana eşitlenen tarih özel sayılmaz)
        const defaultDue = days.dueDay ? dayOf(m, days.dueDay) : null
        const defaultClosing = cardCycle(days, m, { dueDate: c.dueDate }, prevOv).closing
        const editable = !!days.dueDay
        const st = byClosing.get(c.closing)

        const setClosing = (v: string) =>
          saveOcc('card', card.id, m, { statementDate: !v || v === defaultClosing ? null : v })
        const setDue = (v: string) =>
          saveOcc('card', card.id, m, { dueDate: !v || v === defaultDue ? null : v })

        return (
          <td key={m} className="px-3 py-3">
            <div className="flex flex-col gap-1.5">
              <DateField label="Kesim" value={c.closing} custom={c.closingCustom} invalid={c.invalid}
                disabled={!editable} onChange={setClosing} />
              <DateField label="Son ödeme" value={c.dueDate ?? ''} custom={c.dueCustom} invalid={c.invalid}
                disabled={!editable} onChange={setDue} />
              {c.invalid && <span className="text-[10px] text-destructive">Kesim, son ödemeden önce olmalı</span>}
              <div className="text-[11px] tabular-nums min-h-4">
                {st && 'open' in st ? (
                  <span className="text-muted-foreground">Dönem sürüyor · {money(st.total)}</span>
                ) : st ? (
                  <span>
                    <span className="font-semibold text-foreground">{money(st.total)}</span>
                    <span className={`ml-1 ${STATUS[st.status].cls}`}>· {STATUS[st.status].label}</span>
                    {st.minPayment !== null && st.total > 0 && (
                      <span className="block text-muted-foreground">asgari {money(st.minPayment)}</span>
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          </td>
        )
      })}
    </tr>
  )
}

function DateField({ label, value, custom, invalid, disabled, onChange }: {
  label: string; value: string; custom: boolean; invalid: boolean; disabled: boolean
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:w-[62px] flex-shrink-0">{label}</span>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
        className={[
          'h-7 w-[122px] rounded-md border bg-background px-1.5 text-xs tabular-nums disabled:opacity-60',
          invalid ? 'border-destructive' : custom ? 'border-primary text-primary font-semibold' : 'border-border',
        ].join(' ')}
      />
      {custom && !disabled && (
        <button type="button" onClick={() => onChange('')} title="Varsayılana döndür" aria-label={`${label}: varsayılana döndür`}
          className="text-xs text-muted-foreground hover:text-foreground">↺</button>
      )}
    </label>
  )
}

function DayInput({ label, value, max, decimal, onCommit }: {
  label: string; value: number | null; max: number; decimal?: boolean
  onCommit: (v: number | null) => void
}) {
  const shown = value === null ? '' : String(value).replace('.', ',')
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const raw = draft.trim().replace(',', '.')
    setDraft(null)
    const n = raw === '' ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < (decimal ? 0 : 1) || n > max)) return   // geçersiz: eski değer kalır
    const next = n === null ? null : decimal ? n : Math.round(n)
    if (next !== value) onCommit(next)
  }

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={draft ?? shown}
        placeholder="—"
        onChange={e => setDraft(e.target.value.replace(decimal ? /[^0-9.,]/g : /[^0-9]/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-7 w-full rounded-md border border-border bg-background px-1.5 text-xs tabular-nums"
      />
    </label>
  )
}
