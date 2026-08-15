'use client'

import { useMemo, useState } from 'react'
import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore, useUIStore } from '@/store'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { groupByDate } from '@/lib/utils/calculations'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardTxRow } from '@/components/transactions/TransactionList'
import { dayTotals, sortWithinDay, type DayTotals, type TxViewProps } from './shared'
import type { Account, Transaction } from '@/types'

/* ── Takvim görünümü ─────────────────────────────────────────────────────────
   Ay ızgarası: her gün hücresinde o günün net etkisi ve gelir/gider oranını
   gösteren mini bar. Gelecek günler gök mavisi zeminle işaretlenir, böylece
   "ayın kalanında ne olacak" doğrudan takvimde görünür. Bir güne tıklanınca o
   günün işlemleri ızgaranın altında listelenir. */

// Aynı anda basılacak en fazla ay — "Tüm Zamanlar" döneminde yıllarca veri
// olabilir; kırpma sessiz kalmasın diye altta bilgi satırı gösterilir.
const MAX_MONTHS = 12

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

export function CalendarView({
  transactions, account, projectedIds, sort, emptyTitle, emptyDescription, heightClass,
}: TxViewProps) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const openModal  = useUIStore(s => s.openModal)
  const removeTx   = useTransactionStore(s => s.remove)

  const catById    = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById    = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])

  const todayStr = today()

  // Gün → işlemler + gün toplamları
  const byDate = useMemo(() => groupByDate(transactions), [transactions])
  const totalsByDate = useMemo(() => {
    const map = new Map<string, DayTotals>()
    for (const [date, txs] of byDate) map.set(date, dayTotals(account, txs))
    return map
  }, [byDate, account])

  // Ölçek: en hareketli günün mutlak hacmi — bar uzunlukları buna göre normalize
  const maxVolume = useMemo(() => {
    let max = 0
    for (const t of totalsByDate.values()) max = Math.max(max, t.inflow + t.outflow)
    return max || 1
  }, [totalsByDate])

  // Basılacak aylar: veri OLAN ayların hepsi (kronolojik yön seçili sıralamadan)
  const { months, hiddenCount } = useMemo(() => {
    const keys = [...new Set([...byDate.keys()].map(d => d.slice(0, 7)))]
    const asc = sort === 'date-asc' || sort === 'amount-asc'
    keys.sort((a, b) => (asc ? a.localeCompare(b) : b.localeCompare(a)))
    return { months: keys.slice(0, MAX_MONTHS), hiddenCount: Math.max(0, keys.length - MAX_MONTHS) }
  }, [byDate, sort])

  // Seçili gün. Filtre/dönem değişince o gün listeden düşmüş olabilir; state'i
  // efektle temizlemek yerine render sırasında doğrularız (bayat seçim yok,
  // ekstra render turu da yok).
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked && byDate.has(picked) ? picked : null

  if (transactions.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  const selectedTxs = selected ? sortWithinDay(byDate.get(selected)!, sort) : []

  return (
    <div className={`${heightClass} overflow-auto mx-6 my-3 rounded-xl border border-border/70 bg-background dark:bg-[#101010]`}>
      <div className="p-4 space-y-6">
        {months.map(ym => (
          <MonthGrid
            key={ym}
            ym={ym}
            account={account}
            byDate={byDate}
            totalsByDate={totalsByDate}
            maxVolume={maxVolume}
            todayStr={todayStr}
            selected={selected}
            onSelect={d => setPicked(cur => (cur === d ? null : d))}
          />
        ))}

        {hiddenCount > 0 && (
          <p className="text-center text-[11px] text-muted-foreground/60">
            {hiddenCount} ay daha var — takvimde en fazla {MAX_MONTHS} ay gösterilir.
            Daha dar bir dönem seçin ya da tablo/zaman çizelgesi görünümünü kullanın.
          </p>
        )}

        {/* Seçili günün işlemleri */}
        {selected && (
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold text-foreground">
                {formatDate(selected, 'd MMMM yyyy')}
              </span>
              <span className="text-[11px] text-muted-foreground/60">{formatDate(selected, 'EEEE')}</span>
              <span className="text-[11px] text-muted-foreground/50">· {selectedTxs.length} hareket</span>
              <button
                onClick={() => setPicked(null)}
                className="ml-auto text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Kapat
              </button>
            </div>
            <div className="p-2">
              {selectedTxs.map(tx => (
                <CardTxRow
                  key={tx.id}
                  tx={tx}
                  future={tx.date.slice(0, 10) > todayStr}
                  cat={tx.categoryId ? catById.get(tx.categoryId) : undefined}
                  account={accById.get(tx.accountId)}
                  recipient={tx.recipientId ? personById.get(tx.recipientId) : undefined}
                  family={tx.familyMemberId ? personById.get(tx.familyMemberId) : undefined}
                  showAccount={false}
                  projected={projectedIds.has(tx.id)}
                  openModal={openModal}
                  removeTx={removeTx}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Tek ay ızgarası ───────────────────────────────────────────────────────── */
function MonthGrid({
  ym, account, byDate, totalsByDate, maxVolume, todayStr, selected, onSelect,
}: {
  /** 'yyyy-MM' */
  ym: string
  account: Account
  byDate: Map<string, Transaction[]>
  totalsByDate: Map<string, DayTotals>
  maxVolume: number
  todayStr: string
  selected: string | null
  onSelect: (date: string) => void
}) {
  const monthStart = startOfMonth(parseISO(`${ym}-01`))
  const monthKey   = ym

  // Pazartesi başlangıçlı tam haftalar (tr locale) — ızgara hep 7'nin katı
  const days = useMemo(() => {
    const first = startOfWeek(monthStart, { locale: tr })
    const last  = endOfWeek(endOfMonth(monthStart), { locale: tr })
    const out: string[] = []
    for (let d = first; d <= last; d = addDays(d, 1)) out.push(format(d, 'yyyy-MM-dd'))
    return out
  }, [monthStart])

  // Ay toplamı — yalnızca bu aya ait günler
  const monthTotals = useMemo(() => {
    let inflow = 0, outflow = 0
    for (const [date, t] of totalsByDate) {
      if (date.slice(0, 7) !== monthKey) continue
      inflow += t.inflow; outflow += t.outflow
    }
    return { inflow, outflow, net: inflow - outflow }
  }, [totalsByDate, monthKey])

  return (
    <div>
      {/* Ay başlığı + toplamlar */}
      <div className="mb-2 flex items-baseline gap-3 flex-wrap">
        <span className="text-sm font-semibold text-foreground">
          {format(monthStart, 'MMMM yyyy', { locale: tr })}
        </span>
        <span className="text-[11px] tabular-nums text-green-600">+{formatCompact(monthTotals.inflow)}</span>
        <span className="text-[11px] tabular-nums text-destructive">−{formatCompact(monthTotals.outflow)}</span>
        <span className={`ml-auto text-[11px] font-semibold tabular-nums ${monthTotals.net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
          net {monthTotals.net >= 0 ? '+' : '−'}{formatCurrency(Math.abs(monthTotals.net), account.currency)}
        </span>
      </div>

      {/* Hafta günü başlıkları */}
      <div className="grid grid-cols-7 gap-1 pb-1">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50 select-none">
            {w}
          </div>
        ))}
      </div>

      {/* Gün hücreleri */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(date => (
          <DayCell
            key={date}
            date={date}
            inMonth={date.slice(0, 7) === monthKey}
            account={account}
            txs={byDate.get(date)}
            totals={totalsByDate.get(date)}
            maxVolume={maxVolume}
            isToday={date === todayStr}
            isFuture={date > todayStr}
            isSelected={date === selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Gün hücresi ───────────────────────────────────────────────────────────── */
function DayCell({
  date, inMonth, account, txs, totals, maxVolume, isToday, isFuture, isSelected, onSelect,
}: {
  date: string
  inMonth: boolean
  account: Account
  txs?: Transaction[]
  totals?: DayTotals
  maxVolume: number
  isToday: boolean
  isFuture: boolean
  isSelected: boolean
  onSelect: (date: string) => void
}) {
  const has = !!txs?.length
  const inPct  = totals ? (totals.inflow  / maxVolume) * 100 : 0
  const outPct = totals ? (totals.outflow / maxVolume) * 100 : 0

  return (
    <button
      type="button"
      disabled={!has}
      onClick={() => onSelect(date)}
      aria-label={`${formatDate(date, 'd MMMM yyyy')}${has ? ` — ${txs!.length} hareket` : ''}`}
      className={[
        'flex h-[74px] flex-col rounded-lg border p-1.5 text-left transition-colors',
        !inMonth ? 'opacity-35' : '',
        isSelected
          ? 'border-primary bg-primary/[0.07]'
          : isFuture
            ? 'border-sky-500/20 bg-sky-500/[0.05]'
            : 'border-border dark:border-[#232323] bg-card',
        has ? 'cursor-pointer hover:border-primary/50' : 'cursor-default',
      ].join(' ')}
    >
      {/* Gün numarası */}
      <div className="flex items-center justify-between">
        <span className={[
          'text-[11px] font-semibold tabular-nums leading-none',
          isToday ? 'flex h-[17px] w-[17px] items-center justify-center rounded-full bg-primary text-primary-foreground'
            : isFuture ? 'text-sky-500/80' : 'text-foreground/70',
        ].join(' ')}>
          {date.slice(8)}
        </span>
        {has && (
          <span className="text-[9px] tabular-nums text-muted-foreground/50">{txs!.length}</span>
        )}
      </div>

      {has && totals && (
        <>
          {/* Net tutar */}
          <span className={[
            'mt-auto truncate text-[10px] font-semibold tabular-nums leading-none',
            totals.net > 0 ? 'text-green-600' : totals.net < 0 ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}>
            {totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}{formatCompact(Math.abs(totals.net))}
          </span>
          {/* Gelir/gider hacmi — en hareketli güne göre normalize */}
          <div className="mt-1 flex h-[3px] gap-px overflow-hidden rounded-full bg-muted/60">
            <span className="h-full rounded-full bg-green-600/70" style={{ width: `${Math.min(inPct, 100)}%` }} />
            <span className="h-full rounded-full bg-destructive/70" style={{ width: `${Math.min(outPct, 100)}%` }} />
          </div>
        </>
      )}
      {/* Hesabın para birimi hücreye sığmaz; net tutar formatCompact ile kısaltılır,
          tam değer seçilen günün panelinde görünür. */}
      <span className="sr-only">{totals ? formatCurrency(totals.net, account.currency) : ''}</span>
    </button>
  )
}
