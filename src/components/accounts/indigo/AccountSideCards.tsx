'use client'

import { useMemo } from 'react'
import { useCategoryStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { isFlowTx } from '@/lib/utils/calculations'
import { expandByCategory } from '@/lib/utils/categorySplits'
import { baseAmount } from '@/lib/utils/fx'
import { useCardStatements } from '../useCardStatements'
import type { Account, Transaction } from '@/types'

/* İndigo sağ sütunu — demodaki dört kart: Bu dönem, Nereye gitti?, Haftalık
   harcama (bir haftaya dokununca liste süzülür), Taksitler. Harcama tutarları
   ₺-normalize (baseAmount) ve isFlowTx ile dönem akışıyla aynı tabanda. */

export type WeekRange = { from: string; to: string; label: string }

export interface InstallmentPlan {
  first: Transaction
  rows: Transaction[]
  done: number
  n: number
  left: number
  next?: Transaction
}

const OTHER = '#94a3b8'
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
const panel = 'rounded-3xl border border-[var(--ip-line)] bg-[var(--ip-panel)] p-[22px]'

const daysUntil = (iso: string) =>
  Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(today() + 'T12:00:00').getTime()) / 86_400_000)

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Hesabın süren taksit planları (gelecek taksiti kalanlar), kalan tutara göre */
export function useInstallmentPlans(accountId: string, accountTxs: Transaction[]): InstallmentPlan[] {
  return useMemo(() => {
    const todayStr = today()
    const m = new Map<string, Transaction[]>()
    for (const t of accountTxs) {
      if (t.type !== 'expense' || t.accountId !== accountId || !t.installGroupId) continue
      if (!m.has(t.installGroupId)) m.set(t.installGroupId, [])
      m.get(t.installGroupId)!.push(t)
    }
    return [...m.values()].map(rows => {
      rows.sort((a, b) => a.date.localeCompare(b.date))
      const future = rows.filter(r => r.date.slice(0, 10) > todayStr)
      return {
        first: rows[0], rows,
        done: rows.length - future.length,
        n: rows[0].installTotal ?? rows.length,
        left: future.reduce((s, r) => s + Math.abs(r.amount), 0),
        next: future[0],
      }
    }).filter(p => p.left > 0).sort((a, b) => b.left - a.left)
  }, [accountTxs, accountId])
}

export function PlanRow({ plan, currency, onOpen }: { plan: InstallmentPlan; currency: Account['currency']; onOpen: (t: Transaction) => void }) {
  const r = 16, c = 2 * Math.PI * r
  return (
    <button type="button" onClick={() => onOpen(plan.next ?? plan.first)}
      className="flex w-full items-center gap-3 rounded-xl border-t border-[var(--ip-line)] px-1.5 py-2.5 text-left first:border-t-0 hover:bg-[var(--ip-surface2)]">
      <svg width={42} height={42} viewBox="0 0 42 42" className="flex-none" aria-hidden="true">
        <circle cx="21" cy="21" r={r} fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="5" />
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--ip-accent)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(plan.done / plan.n) * c} ${c}`} transform="rotate(-90 21 21)" />
        <text x="21" y="25" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">{plan.done}/{plan.n}</text>
      </svg>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate font-semibold">{plan.first.description}</b>
        <span className="text-[13px] text-[var(--ip-sub)]">Sıradaki {plan.next ? formatDate(plan.next.date.slice(0, 10), 'd MMM') : '—'}</span>
      </span>
      <span className="flex flex-none flex-col items-end">
        <b className="font-bold tabular-nums">{formatCurrency(plan.left, currency)}</b>
        <span className="text-xs text-[var(--ip-sub)]">kaldı</span>
      </span>
    </button>
  )
}

function PeriodCardCredit({ account }: { account: Account }) {
  const { result } = useCardStatements(account)
  const money = (n: number) => formatCurrency(n, account.currency)
  const last = result.statements[0]
  const unpaid = last?.dueDate && (last.status === 'open' || last.status === 'partial' || last.status === 'overdue') ? last : null
  const cutIn = daysUntil(result.open.period.to)
  const due = unpaid?.dueDate ?? null
  const d = due ? new Date(due + 'T12:00:00') : null
  const dueIn = due ? daysUntil(due) : null
  const lateHistory = result.statements.slice(0, 3).filter(s => s.status === 'overdue').length

  return (
    <section className={panel} aria-labelledby="pc-title">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 id="pc-title" className="text-lg font-bold">Bu dönem</h2>
        <span className="inline-flex h-6 items-center rounded-full bg-[var(--ip-accent)]/15 px-2.5 text-xs font-bold text-[var(--ip-accent)]">
          {cutIn <= 0 ? 'Bugün kesim' : `${cutIn} gün sonra kesim`}
        </span>
      </div>
      <div className="text-[34px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums">{money(result.open.total)}</div>
      <p className="text-sm text-[var(--ip-sub)]">
        {formatDate(result.open.period.from, 'd MMM')}&apos;dan bu yana {result.open.charges.length} harcama
      </p>
      <div className="mt-4 flex items-center gap-3.5 rounded-[18px] bg-[var(--ip-surface2)] p-3.5">
        {d ? (
          <div className="flex h-14 w-[52px] flex-none flex-col items-center justify-center rounded-[14px] bg-[var(--ip-accent)] leading-none text-[var(--ip-accent-fg)]">
            <b className="text-[22px] font-extrabold">{d.getDate()}</b>
            <span className="mt-1 text-[11px] font-bold uppercase">{MON[d.getMonth()]}</span>
          </div>
        ) : null}
        <div className="min-w-0">
          {unpaid ? (
            <>
              <b>{dueIn! < 0 ? `Son ödeme ${-dueIn!} gün geçti` : dueIn === 0 ? 'Son ödeme bugün' : `Son ödeme ${dueIn} gün sonra`}</b>
              <p className="text-sm text-[var(--ip-sub)]">
                Ödenecek {money(Math.max(0, unpaid.total - unpaid.paid))}
                {unpaid.minPayment !== null ? ` · asgari ${money(unpaid.minPayment)}` : ''}
              </p>
            </>
          ) : (
            <>
              <b>Ödenmemiş ekstre yok</b>
              <p className="text-sm text-[var(--ip-sub)]">
                Sıradaki ekstre {formatDate(result.open.period.to, 'd MMMM')}&apos;da kesilecek.
                {lateHistory ? ' Son ekstrelerden biri geç ödendi; bu sefer zamanında öde.' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function PeriodCardFlow({ income, expense, periodLabel }: { income: number; expense: number; periodLabel: string }) {
  return (
    <section className={panel} aria-labelledby="pc-title">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 id="pc-title" className="text-lg font-bold">Bu dönem</h2>
        <span className="inline-flex h-6 items-center rounded-full bg-[var(--ip-accent)]/15 px-2.5 text-xs font-bold text-[var(--ip-accent)]">{periodLabel}</span>
      </div>
      <div className={`text-[34px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums ${income - expense >= 0 ? 'text-[var(--ip-pos)]' : ''}`}>
        {income - expense < 0 ? '−' : '+'}{formatCurrency(Math.abs(income - expense))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[18px] bg-[var(--ip-surface2)] p-3.5">
          <span className="text-sm text-[var(--ip-sub)]">Gelir</span>
          <div className="font-bold tabular-nums text-[var(--ip-pos)]">+{formatCurrency(income)}</div>
        </div>
        <div className="rounded-[18px] bg-[var(--ip-surface2)] p-3.5">
          <span className="text-sm text-[var(--ip-sub)]">Gider</span>
          <div className="font-bold tabular-nums">−{formatCurrency(expense)}</div>
        </div>
      </div>
    </section>
  )
}

export function AccountSideCards({
  account, accountTxs, from, to, periodLabel, income, expense,
  week, onWeek, plans, onOpenTx, onOpenPlans,
}: {
  account: Account
  accountTxs: Transaction[]
  from: string
  to: string
  periodLabel: string
  income: number
  expense: number
  week: WeekRange | null
  onWeek: (w: WeekRange | null) => void
  plans: InstallmentPlan[]
  onOpenTx: (t: Transaction) => void
  onOpenPlans: () => void
}) {
  const categories = useCategoryStore(s => s.categories)
  const todayStr = today()

  const spend = useMemo(
    () => accountTxs.filter(t =>
      t.type === 'expense' && t.accountId === account.id && isFlowTx(t)
      && (!from || t.date.slice(0, 10) >= from) && (!to || t.date.slice(0, 10) <= to)),
    [accountTxs, account.id, from, to],
  )
  const total = spend.reduce((s, t) => s + baseAmount(t), 0)

  const segs = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]))
    const m = new Map<string, number>()
    for (const t of expandByCategory(spend)) m.set(t.categoryId ?? '', (m.get(t.categoryId ?? '') ?? 0) + baseAmount(t))
    const list = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const top = list.slice(0, 4).map(([id, v]) => ({ id, v, name: byId.get(id)?.name ?? 'Kategorisiz', color: byId.get(id)?.color ?? OTHER }))
    const rest = list.slice(4).reduce((s, [, v]) => s + v, 0)
    return rest > 0 ? [...top, { id: '_other', v: rest, name: 'Diğer', color: OTHER }] : top
  }, [spend, categories])
  const segSum = segs.reduce((s, c) => s + c.v, 0)

  // Haftalık kovalar dönemin başından bugüne (en çok 9 hafta; daha uzun
  // dönemde son 9 hafta) — demodaki gibi bir haftaya dokununca liste süzülür.
  const weeks = useMemo(() => {
    const end = to && to < todayStr ? to : todayStr
    let start = from || spend.reduce((m, t) => (t.date < m ? t.date.slice(0, 10) : m), end)
    const minStart = addDays(end, -62)
    if (start < minStart) start = minStart
    const out: (WeekRange & { v: number; short: string })[] = []
    for (let s = start, i = 1; s <= end; s = addDays(s, 7), i++) {
      const e = addDays(s, 6) < end ? addDays(s, 6) : end
      const v = spend.filter(t => t.date.slice(0, 10) >= s && t.date.slice(0, 10) <= e).reduce((a, t) => a + baseAmount(t), 0)
      out.push({ from: s, to: e, label: `${formatDate(s, 'd MMM')}–${formatDate(e, 'd MMM')}`, v, short: `${i}. hafta` })
    }
    return out
  }, [spend, from, to, todayStr])
  const maxW = Math.max(1, ...weeks.map(w => w.v))
  const plansLeft = plans.reduce((s, p) => s + p.left, 0)

  return (
    <aside className="flex flex-col gap-6" aria-label="Özet kartları">
      {account.type === 'credit_card'
        ? <PeriodCardCredit account={account} />
        : <PeriodCardFlow income={income} expense={expense} periodLabel={periodLabel} />}

      <section className={panel} aria-labelledby="where-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="where-title" className="text-lg font-bold">Nereye gitti?</h2>
          <span className="text-sm font-bold tabular-nums">{formatCurrency(total)}</span>
        </div>
        {segs.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ip-sub)]">Bu dönemde harcama yok.</p>
        ) : (
          <>
            <div className="my-3.5 flex h-3.5 gap-[3px] overflow-hidden rounded-full" role="img" aria-label="Kategori dağılımı">
              {segs.map(s => <i key={s.id} className="block h-full" style={{ width: `${(s.v / segSum) * 100}%`, background: s.color }} />)}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
              {segs.map(s => (
                <div key={s.id} className="contents">
                  <span className="flex min-w-0 items-center gap-2"><i className="size-2.5 flex-none rounded-full" style={{ background: s.color }} /><span className="truncate">{s.name}</span></span>
                  <b className="tabular-nums">{formatCurrency(s.v)}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {weeks.length > 0 && (
        <section className={panel} aria-labelledby="weeks-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="weeks-title" className="text-lg font-bold">Haftalık harcama</h2>
            <span className="text-sm text-[var(--ip-sub)]">Haftaya dokun, liste süzülsün</span>
          </div>
          <div className="mt-2 flex h-[150px] items-end gap-2.5">
            {weeks.map(w => {
              const on = week?.from === w.from
              return (
                <button key={w.from} type="button" aria-pressed={on} aria-label={`${w.label}: ${formatCurrency(w.v)}`}
                  onClick={() => onWeek(on ? null : { from: w.from, to: w.to, label: w.label })}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <b className="text-xs tabular-nums">{w.v >= 1000 ? `${(w.v / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}B` : Math.round(w.v)}</b>
                  <i className="block w-full max-w-[54px] rounded-xl bg-[var(--ip-accent)] transition-opacity"
                    style={{ height: `${Math.max(6, Math.round((w.v / maxW) * 100))}px`, opacity: on || (!week && w.v === maxW) ? 1 : 0.35 }} />
                  <span className="text-xs font-semibold text-[var(--ip-sub)]">{w.short}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className={panel} aria-labelledby="plans-title">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 id="plans-title" className="text-lg font-bold">Taksitler</h2>
            <button type="button" onClick={onOpenPlans} className="text-sm font-bold text-[var(--ip-accent)] hover:underline">Tümü ({plans.length})</button>
          </div>
          {plans.slice(0, 4).map(p => <PlanRow key={p.first.installGroupId} plan={p} currency={account.currency} onOpen={onOpenTx} />)}
          <p className="mt-2 text-sm text-[var(--ip-sub)]">Kalan toplam {formatCurrency(plansLeft, account.currency)} · {plans.reduce((s, p) => s + (p.n - p.done), 0)} taksit</p>
        </section>
      )}
    </aside>
  )
}
