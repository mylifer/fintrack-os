'use client'

import { memo, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore, useUIStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { groupByDate } from '@/lib/utils/calculations'
import { computeRunningBalances } from '@/lib/utils/runningBalance'
import { EmptyState } from '@/components/ui/EmptyState'
import { Checkbox } from '@/components/ui/Checkbox'
import { TagBadges } from '@/components/transactions/TagBadges'
import {
  TxIcon, DeleteConfirmDialog, PencilIcon, RefundIcon, installmentLabel,
} from '@/components/transactions/TransactionList'
import { dayTotals, sortDates, sortWithinDay, splitFuture, type TxViewProps } from './shared'
import type { Account, Category, ModalPayload, ModalType, Person, Transaction } from '@/types'

/* ── Zaman çizelgesi görünümü ────────────────────────────────────────────────
   Dikey bir ray üzerinde gün gün akış. Her gün bir düğüm: tarih, gün içi
   hareket sayısı, günün net etkisi ve GÜN SONU bakiyesi. Gelecek günler ayrı
   bir bölümde ve gök mavisi kesikli rayla — bakiyenin nereye gittiği tek bakışta
   okunur. Tablo görünümünden farkı: sütun değil, kronolojik anlatı. */

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

// Rayın (dikey çizgi) sol ekseni ve içeriğin ondan sonraki inseti.
const RAIL_X = 11

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | { kind: 'day'; date: string; txs: Transaction[]; future: boolean; last: boolean }

export function TimelineView({
  transactions, account, projectedIds, plannedTxs, sort,
  emptyTitle, emptyDescription, heightClass,
  selectable, selectedIds, onToggleSelect,
}: TxViewProps) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const allTxs     = useTransactionStore(s => s.transactions)
  const openModal  = useUIStore(s => s.openModal)
  const removeTx   = useTransactionStore(s => s.remove)

  const catById    = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById    = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])

  // Bakiye tablo görünümüyle ORTAK kaynaktan; planlananlar defterin sonuna
  // eklenerek ileriye dönük projeksiyon üretir.
  const balances = useMemo(
    () => computeRunningBalances(
      plannedTxs.length ? [...allTxs, ...plannedTxs] : allTxs,
      [account.id],
      accById,
    ),
    [allTxs, plannedTxs, account.id, accById],
  )

  const rows = useMemo<Row[]>(() => {
    const { future, past } = splitFuture(transactions, today())
    const out: Row[] = []

    const pushDays = (txs: Transaction[], isFuture: boolean) => {
      const grouped = groupByDate(txs)
      const dates = sortDates([...grouped.keys()], sort)
      dates.forEach((date, i) => {
        out.push({
          kind:   'day',
          date,
          txs:    sortWithinDay(grouped.get(date)!, sort),
          future: isFuture,
          last:   i === dates.length - 1,
        })
      })
    }

    if (future.length > 0) {
      out.push({ kind: 'section', id: 'future', count: future.length, first: true })
      pushDays(future, true)
      if (past.length > 0) out.push({ kind: 'section', id: 'past', count: past.length, first: false })
    }
    pushDays(past, false)
    return out
  }, [transactions, sort])

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: i => {
      const r = rows[i]
      return r.kind === 'section' ? 48 : 60 + r.txs.length * 46
    },
    overscan: 4,
    getItemKey: i => {
      const r = rows[i]
      return r.kind === 'section' ? `s:${r.id}` : `d:${r.future ? 'f' : 'p'}:${r.date}`
    },
  })

  if (transactions.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div ref={parentRef} className={`${heightClass} overflow-auto mx-6 my-3 rounded-xl border border-border/70 bg-background dark:bg-[#101010]`}>
      <div className="px-4 py-3">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map(vi => {
            const row = rows[vi.index]
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {row.kind === 'section' ? (
                  <SectionMarker id={row.id} count={row.count} first={row.first} />
                ) : (
                  <DayBlock
                    date={row.date}
                    txs={row.txs}
                    future={row.future}
                    last={row.last}
                    account={account}
                    balances={balances}
                    catById={catById}
                    personById={personById}
                    projectedIds={projectedIds}
                    openModal={openModal}
                    removeTx={removeTx}
                    selectable={selectable}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Bölüm işareti (Gelecek / Gerçekleşen) ─────────────────────────────────── */
function SectionMarker({ id, count, first }: { id: 'future' | 'past'; count: number; first: boolean }) {
  const future = id === 'future'
  return (
    <div className={`flex items-center gap-3 pb-3 ${first ? 'pt-0' : 'pt-5'}`}>
      <span className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider select-none',
        future ? 'bg-sky-500/10 text-sky-500' : 'bg-muted text-muted-foreground',
      ].join(' ')}>
        {future ? 'Gelecek İşlemler' : 'Gerçekleşen İşlemler'}
        <span className="font-semibold opacity-70">{count}</span>
      </span>
      <div className={`flex-1 h-px ${future ? 'bg-sky-500/25' : 'bg-border'}`} />
    </div>
  )
}

/* ── Bir gün: ray düğümü + başlık + o günün işlem kartı ────────────────────── */
function DayBlock({
  date, txs, future, last, account, balances, catById, personById, projectedIds,
  openModal, removeTx, selectable, selectedIds, onToggleSelect,
}: {
  date: string
  txs: Transaction[]
  future: boolean
  last: boolean
  account: Account
  balances: Map<string, number>
  catById: Map<string, Category>
  personById: Map<string, Person>
  projectedIds: Set<string>
  openModal: OpenModal
  removeTx: (id: string) => void
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}) {
  const totals  = dayTotals(account, txs)
  const isToday = date.slice(0, 10) === today()

  // Gün sonu bakiye: günün KRONOLOJİK olarak son işleminden sonraki bakiye.
  // (Ekrandaki sıra tutara göre olabilir, bakiye sırası değişmez.)
  const endBalance = useMemo(() => {
    const chrono = [...txs].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    for (let i = chrono.length - 1; i >= 0; i--) {
      const b = balances.get(chrono[i].id)
      if (b !== undefined) return b
    }
    return undefined
  }, [txs, balances])

  return (
    <div className="relative pl-9">
      {/* Ray — bloklar bitişik olduğu için segmentler kesintisiz bir çizgiye
          birleşir. Son günde düğümden sonrası çizilmez (çizgi boşlukta bitmesin). */}
      <span
        aria-hidden
        className={`absolute top-0 w-px ${last ? 'h-[18px]' : 'bottom-0'} ${future ? 'bg-sky-500/25' : 'bg-border'}`}
        style={{ left: RAIL_X }}
      />
      {/* Düğüm */}
      <span
        aria-hidden
        className={[
          'absolute top-[6px] h-[11px] w-[11px] rounded-full border-2 bg-background dark:bg-[#101010]',
          isToday ? 'border-primary' : future ? 'border-sky-500/60' : 'border-border',
        ].join(' ')}
        style={{ left: RAIL_X - 5 }}
      />

      {/* Gün başlığı */}
      <div className="flex items-baseline gap-2 flex-wrap pb-2">
        <span className={`text-[11px] font-bold uppercase tracking-[0.08em] ${future ? 'text-sky-500/90' : isToday ? 'text-primary' : 'text-foreground/80'}`}>
          {formatDate(date, 'd MMM')}
        </span>
        <span className="text-[11px] text-muted-foreground/70">{formatDate(date, 'EEEE')}</span>
        {isToday && (
          <span className="rounded-sm bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">Bugün</span>
        )}
        <span className="text-[11px] text-muted-foreground/50">· {txs.length} hareket</span>

        <span className="ml-auto flex items-baseline gap-3">
          <span className={`text-[11px] font-semibold tabular-nums ${totals.net > 0 ? 'text-green-600' : totals.net < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}{formatCurrency(Math.abs(totals.net), account.currency)}
          </span>
          {endBalance !== undefined && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60">
              bakiye {formatCurrency(endBalance, account.currency)}
            </span>
          )}
        </span>
      </div>

      {/* Günün işlemleri — tek kart, ince ayraçlı satırlar */}
      <div className={[
        'mb-4 overflow-hidden rounded-[10px] border',
        future ? 'border-sky-500/20 bg-sky-500/[0.04]' : 'border-border dark:border-[#232323] bg-card',
      ].join(' ')}>
        {txs.map((tx, i) => (
          <TimelineTxRow
            key={tx.id}
            tx={tx}
            first={i === 0}
            account={account}
            cat={tx.categoryId ? catById.get(tx.categoryId) : undefined}
            recipient={tx.recipientId ? personById.get(tx.recipientId) : undefined}
            family={tx.familyMemberId ? personById.get(tx.familyMemberId) : undefined}
            balanceAfter={balances.get(tx.id)}
            projected={projectedIds.has(tx.id)}
            openModal={openModal}
            removeTx={removeTx}
            selectable={selectable}
            selected={selectedIds?.has(tx.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Zaman çizelgesi satırı ────────────────────────────────────────────────── */
const TimelineTxRow = memo(function TimelineTxRow({
  tx, first, account, cat, recipient, family, balanceAfter, projected,
  openModal, removeTx, selectable, selected, onToggleSelect,
}: {
  tx: Transaction
  first: boolean
  account: Account
  cat?: Category
  recipient?: Person
  family?: Person
  balanceAfter?: number
  projected: boolean
  openModal: OpenModal
  removeTx: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const isIncome = tx.type === 'income'
  const isXfer   = tx.type === 'transfer'
  const isRefund = tx.type === 'expense' && tx.amount < 0
  const positive = isIncome || isRefund

  return (
    <div className={[
      'group flex items-center gap-2.5 px-3 py-2 transition-colors',
      first ? '' : 'border-t border-border/40 dark:border-white/[0.06]',
      selected ? 'bg-[var(--batch-accent-soft)]' : 'hover:bg-accent/40',
      projected ? 'opacity-70' : '',
    ].join(' ')}>
      {selectable && (
        <div className="flex w-5 flex-shrink-0 items-center justify-center">
          {!projected && (
            <Checkbox checked={!!selected} onChange={() => onToggleSelect?.(tx.id)} aria-label="İşlemi seç" />
          )}
        </div>
      )}

      <TxIcon description={tx.description} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-snug text-foreground">
          {tx.description}
          {tx.isInstallment && (
            <span className="ml-1 font-normal text-orange-500/80">({installmentLabel(tx)})</span>
          )}
          {isRefund && (
            <span className="ml-1.5 align-middle rounded-sm bg-green-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">İade</span>
          )}
          {projected && (
            <span className="ml-1.5 align-middle rounded-sm bg-sky-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-500">Planlandı</span>
          )}
          {tx.approvalStatus === 'pending' && (
            <span className="ml-1.5 align-middle rounded-sm bg-orange-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">Onay bekliyor</span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-snug text-muted-foreground/60">
          {cat && (
            <Link href={`/categories/${tx.categoryId}`} className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground">
              <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: cat.color }} />
              <span className="truncate">{cat.name}</span>
            </Link>
          )}
          {recipient && (
            <>
              {cat && <span className="opacity-40">·</span>}
              <Link href={`/alicilar/${tx.recipientId}`} className="truncate transition-colors hover:text-foreground">{recipient.name}</Link>
            </>
          )}
          {family && (
            <>
              {(cat || recipient) && <span className="opacity-40">·</span>}
              <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="truncate transition-colors hover:text-foreground">{family.name}</Link>
            </>
          )}
        </div>
        <TagBadges tags={tx.tags} className="mt-1" />
      </div>

      {/* Tutar + o işlemden sonraki bakiye */}
      <div className="flex flex-shrink-0 flex-col items-end leading-tight">
        <span className={[
          'text-[13px] font-semibold tabular-nums',
          positive ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
        ].join(' ')}>
          {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/50">
          {balanceAfter !== undefined ? formatCurrency(balanceAfter, account.currency) : '—'}
        </span>
      </div>

      {/* Eylemler — planlanan satırlar yalnızca düzenlenebilir (tarih öne çekme) */}
      <div className="row-actions flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {projected ? (
          <button
            onClick={() => openModal('edit-transaction', { id: tx.id, plannedTx: tx })}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Tarihi Düzenle"
          >
            <PencilIcon size={12} />
          </button>
        ) : (
          <>
            {tx.type === 'expense' && tx.amount > 0 && (
              <button
                onClick={() => openModal('refund-transaction', { id: tx.id })}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-green-500/10 hover:text-green-600"
                title="İade İşle"
              >
                <RefundIcon size={12} />
              </button>
            )}
            <button
              onClick={() => openModal('edit-transaction', { id: tx.id })}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Düzenle"
            >
              <PencilIcon size={12} />
            </button>
            <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
          </>
        )}
      </div>
    </div>
  )
})
