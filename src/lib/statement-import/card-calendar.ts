import { cardCycle, shiftMonthKey, type CardDays, type CycleOverride, type MonthKey } from '@/lib/payments/card-cycles'
import { MAX_GAP, MIN_GAP, nominalDueDay, resolveCardDays } from '@/lib/payments/bank-rules'
import { occurrenceIdFor, planIdFor } from '@/lib/payments/ids'
import type { BatchOp } from '@/lib/sync/engine'
import type { Account, PaymentOccurrence, PaymentPlan } from '@/types'
import type { ParsedStatement } from './statement'

/* ── Ekstreden Kart Takvimi ──────────────────────────────────────────────────
   Ekstre kartın gerçek tarihlerini söyler: bu dönemin kesimi ve son ödemesi,
   bir önceki kesim, bir sonraki kesim ve son ödeme. Bunlar Kart Takvimi'ne
   (PaymentOccurrence.statementDate/dueDate, ay = ÖDEME ayı) ve kartın
   varsayılan günlerine (statementDay, dueGapDays, plan.dayOfMonth) yazılır —
   Kart Takvimi'nin elle düzenleme kuralıyla aynı: varsayılana eşit tarih özel
   kayıt olarak saklanmaz.

   Yanlış aya girilmiş kayıt: komşu ayda aynı kesim tarihini taşıyan özel kayıt
   (ör. Ekim'de ödenen ekstre Eylül sütununa girilmiş) aynı ekstrenin kopyasıdır;
   tarihleri temizlenir (ödeme durumu vb. alanlarına dokunulmaz).

   SAF: değişiklik listesi + localBatch işlemleri + geri alma işlemleri. */

export interface CalendarChange {
  label: string
  from: string | null
  to: string | null
}

export interface CalendarUpdate {
  changes: CalendarChange[]
  ops: BatchOp[]
  undo: BatchOp[]
}

const MON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const monthName = (m: MonthKey) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`
const dayDiff = (a: string, b: string) =>
  Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000)

function addDays(iso: string, n: number): string {
  const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n))
  return t.toISOString().slice(0, 10)
}

interface Cycle { month: MonthKey; closing: string; due: string | null }

export function cardCalendarUpdate(input: {
  statement: ParsedStatement
  account: Pick<Account, 'id' | 'name' | 'statementDay' | 'dueGapDays' | 'holidayRule'>
  plan: PaymentPlan | undefined
  occurrences: readonly PaymentOccurrence[]
  nowIso: string
}): CalendarUpdate {
  const { statement: st, account, plan, nowIso } = input
  const changes: CalendarChange[] = []
  const ops: BatchOp[] = []
  const undo: BatchOp[] = []

  // ── 1) Varsayılan günler: kesim günü + kesimden son ödemeye gün ──
  const cur = resolveCardDays(account, plan).days
  const sd = +st.statementDate.slice(8, 10)
  const gapRaw = st.dueDate ? dayDiff(st.statementDate, st.dueDate) : null
  const gap = gapRaw !== null && gapRaw >= MIN_GAP && gapRaw <= MAX_GAP ? gapRaw : cur.gapDays ?? null
  const days: CardDays = { ...cur, statementDay: sd, gapDays: gap, dueDay: gap ? nominalDueDay(sd, gap) : cur.dueDay }

  if (account.statementDay !== sd || (gap !== null && account.dueGapDays !== gap)) {
    const accPatch: Record<string, unknown> = { statementDay: sd }
    if (gap !== null) accPatch.dueGapDays = gap
    ops.push({ kind: 'patch', table: 'accounts', id: account.id, patch: accPatch })
    undo.push({ kind: 'patch', table: 'accounts', id: account.id, patch: { statementDay: account.statementDay ?? null, dueGapDays: account.dueGapDays ?? null } })
    if (account.statementDay !== sd) changes.push({ label: 'Kesim günü', from: account.statementDay ? String(account.statementDay) : null, to: String(sd) })
    if (gap !== null && account.dueGapDays !== gap) changes.push({ label: 'Kesimden son ödemeye', from: account.dueGapDays ? `${account.dueGapDays} gün` : null, to: `${gap} gün` })
    // Kart Takvimi'nin setStatementDay'i gibi: sabit son ödeme günü de kesim + farka eşitlenir
    if (gap !== null) {
      const dayOfMonth = nominalDueDay(sd, gap)
      const id = planIdFor('card', account.id)
      if (plan) {
        if (plan.dayOfMonth !== dayOfMonth) {
          ops.push({ kind: 'patch', table: 'payment_plans', id, patch: { dayOfMonth, updatedAt: nowIso } })
          undo.push({ kind: 'patch', table: 'payment_plans', id, patch: { dayOfMonth: plan.dayOfMonth ?? null } })
        }
      } else {
        const entity: PaymentPlan = { id, targetKind: 'card', targetId: account.id, isActive: true, dayOfMonth, createdAt: nowIso, updatedAt: nowIso }
        ops.push({ kind: 'upsert', table: 'payment_plans', entity })
        undo.push({ kind: 'patch', table: 'payment_plans', id, patch: { deleted_at: nowIso } })
      }
    }
  }

  // ── 2) Ay ay tarihler ──
  const month = (st.dueDate ?? st.statementDate).slice(0, 7)
  const cycles: Cycle[] = []
  // Önceki dönemin son ödemesini ekstre söylemez: kesim + fark (bankada sabit 10 gün)
  if (st.prevStatementDate) cycles.push({ month: shiftMonthKey(month, -1), closing: st.prevStatementDate, due: gap ? addDays(st.prevStatementDate, gap) : null })
  cycles.push({ month, closing: st.statementDate, due: st.dueDate })
  if (st.nextStatementDate) cycles.push({ month: shiftMonthKey(month, 1), closing: st.nextStatementDate, due: st.nextDueDate ?? (gap ? addDays(st.nextStatementDate, gap) : null) })

  const occ = new Map(input.occurrences.filter(o => o.targetKind === 'card' && o.targetId === account.id && !o.deleted_at).map(o => [o.month, o]))
  const overrides = new Map<MonthKey, CycleOverride>([...occ].map(([m, o]) => [m, { statementDate: o.statementDate ?? null, dueDate: o.dueDate ?? null }]))
  const written = new Set(cycles.map(c => c.month))

  const setOcc = (m: MonthKey, patch: { statementDate?: string | null; dueDate?: string | null }) => {
    const prev = occ.get(m)
    const id = prev?.id ?? occurrenceIdFor('card', account.id, m)
    if (prev) {
      ops.push({ kind: 'patch', table: 'payment_occurrences', id, patch: { ...patch, updatedAt: nowIso } })
      const back: Record<string, unknown> = {}
      for (const k of Object.keys(patch)) back[k] = (prev as unknown as Record<string, unknown>)[k] ?? null
      undo.push({ kind: 'patch', table: 'payment_occurrences', id, patch: back })
    } else {
      const entity: PaymentOccurrence = { id, targetKind: 'card', targetId: account.id, month: m, statementDate: null, dueDate: null, ...patch, createdAt: nowIso, updatedAt: nowIso }
      ops.push({ kind: 'upsert', table: 'payment_occurrences', entity })
      undo.push({ kind: 'patch', table: 'payment_occurrences', id, patch: { deleted_at: nowIso } })
    }
    overrides.set(m, { ...overrides.get(m), ...patch })
  }

  for (const c of cycles) {
    const now = overrides.get(c.month) ?? null
    const prevOv = overrides.get(shiftMonthKey(c.month, -1)) ?? null
    const effective = cardCycle(days, c.month, now, prevOv)
    const def = cardCycle(days, c.month, null, prevOv)
    const patch: { statementDate?: string | null; dueDate?: string | null } = {}
    if (effective.closing !== c.closing) patch.statementDate = c.closing === def.closing ? null : c.closing
    if (c.due && effective.dueDate !== c.due) patch.dueDate = c.due === def.dueDate ? null : c.due
    if (Object.keys(patch).length) {
      setOcc(c.month, patch)
      if (effective.closing !== c.closing) changes.push({ label: `${monthName(c.month)} kesimi`, from: effective.closing, to: c.closing })
      if (c.due && effective.dueDate !== c.due) changes.push({ label: `${monthName(c.month)} son ödemesi`, from: effective.dueDate, to: c.due })
    }
  }

  // ── 3) Yanlış aya girilmiş kopya: komşu ayda aynı kesim tarihi ──
  for (const c of cycles) {
    for (const m of [shiftMonthKey(c.month, -1), shiftMonthKey(c.month, 1)]) {
      if (written.has(m)) continue
      const o = occ.get(m)
      if (!o || o.statementDate !== c.closing) continue
      if (o.dueDate && c.due && o.dueDate !== c.due) continue
      setOcc(m, { statementDate: null, dueDate: null })
      changes.push({ label: `${monthName(m)} (yanlış aya girilmiş kopya) temizlenir`, from: [o.statementDate, o.dueDate].filter(Boolean).join(' / '), to: null })
    }
  }

  return { changes, ops, undo }
}
