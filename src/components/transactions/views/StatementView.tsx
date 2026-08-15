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
import type { Account, Category, CurrencyCode, ModalPayload, ModalType, Person, Transaction } from '@/types'

/* ── Ekstre görünümü ─────────────────────────────────────────────────────────
   Bankanın hesap özeti mantığı: kart yok, gün bloğu yok — kesintisiz tek akış.
   Tarih yalnızca DEĞİŞTİĞİNDE yazılır, gün bitince ince bir "gün neti" ara
   toplam satırı düşer. Yürüyen bakiye sağda, hep aynı hizada.

   Satır tek katlıdır (41px): açıklamanın hemen ardından kategori, alıcı ve aile
   üyesi sessiz bir kuyruk olarak akar — yer kalmazsa kuyruk kısalır, açıklama
   ve para asla kısalmaz. */

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

const COLS      = '58px minmax(200px,1fr) 132px 124px 70px'
const SELECT_W  = 32
const MIN_W     = 58 + 200 + 132 + 124 + 70 + 32
const colsFor = (selectable: boolean) => (selectable ? `${SELECT_W}px ${COLS}` : COLS)

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | { kind: 'tx'; tx: Transaction; showDate: boolean; future: boolean }
  | { kind: 'subtotal'; date: string; net: number; future: boolean }

export function StatementView({
  transactions, account, projectedIds, plannedTxs, sort,
  emptyTitle, emptyDescription, heightClass,
  selectable, selectedIds, onToggleSelect, onSelectMany,
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

  const balances = useMemo(
    () => computeRunningBalances(
      plannedTxs.length ? [...allTxs, ...plannedTxs] : allTxs,
      [account.id],
      accById,
    ),
    [allTxs, plannedTxs, account.id, accById],
  )

  // Tarih bazlı sıralamada gün grupları ve ara toplamlar vardır; tutar
  // sıralamasında gün kavramı kalmaz → her satır kendi tarihini yazar.
  const dateGrouped = sort === 'date-desc' || sort === 'date-asc'

  const rows = useMemo<Row[]>(() => {
    const { future, past } = splitFuture(transactions, today())
    const out: Row[] = []

    const pushFlat = (txs: Transaction[], isFuture: boolean) => {
      for (const tx of sortWithinDay(txs, sort)) {
        out.push({ kind: 'tx', tx, showDate: true, future: isFuture })
      }
    }

    const pushGrouped = (txs: Transaction[], isFuture: boolean) => {
      const grouped = groupByDate(txs)
      for (const date of sortDates([...grouped.keys()], sort)) {
        const day = sortWithinDay(grouped.get(date)!, sort)
        day.forEach((tx, i) => {
          out.push({ kind: 'tx', tx, showDate: i === 0, future: isFuture })
        })
        out.push({ kind: 'subtotal', date, net: dayTotals(account, day).net, future: isFuture })
      }
    }

    const push = dateGrouped ? pushGrouped : pushFlat

    if (future.length > 0) {
      out.push({ kind: 'section', id: 'future', count: future.length, first: true })
      push(future, true)
      if (past.length > 0) out.push({ kind: 'section', id: 'past', count: past.length, first: false })
    }
    push(past, false)
    return out
  }, [transactions, sort, dateGrouped, account])

  const eligibleIds = useMemo(
    () => (selectable ? transactions.filter(t => !projectedIds.has(t.id)).map(t => t.id) : []),
    [selectable, transactions, projectedIds],
  )
  const allSelected  = eligibleIds.length > 0 && eligibleIds.every(id => selectedIds?.has(id))
  const someSelected = !allSelected && eligibleIds.some(id => selectedIds?.has(id))

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: i => {
      const r = rows[i]
      if (r.kind === 'section')  return 40
      if (r.kind === 'subtotal') return 26
      return 41
    },
    overscan: 14,
    getItemKey: i => {
      const r = rows[i]
      if (r.kind === 'section')  return `s:${r.id}`
      if (r.kind === 'subtotal') return `n:${r.future ? 'f' : 'p'}:${r.date}`
      return `t:${r.tx.id}`
    },
  })

  if (transactions.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  const cols = colsFor(!!selectable)

  return (
    <div
      ref={parentRef}
      className={`${heightClass} overflow-auto mx-6 my-3 rounded-xl border border-border/70 bg-card`}
    >
      <div style={{ minWidth: MIN_W + (selectable ? SELECT_W : 0) }}>
        {/* Sticky sütun başlığı — sticky olduğu için zemin opak olmalı */}
        <div className="sticky top-0 z-10 border-b border-border bg-background dark:bg-[#101010]">
          <div className="grid px-3" style={{ gridTemplateColumns: cols }}>
            {selectable && (
              <div className="flex items-center justify-center py-1.5">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => onSelectMany?.(eligibleIds, !allSelected)}
                  disabled={eligibleIds.length === 0}
                  aria-label="Tümünü seç"
                />
              </div>
            )}
            {['Tarih', 'Açıklama', 'Tutar', 'Bakiye', ''].map((h, i) => (
              <div
                key={i}
                className={[
                  'py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 select-none',
                  h === 'Tutar' || h === 'Bakiye' ? 'px-2 text-right' : 'px-2',
                ].join(' ')}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

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
                  <SectionBand id={row.id} count={row.count} first={row.first} />
                ) : row.kind === 'subtotal' ? (
                  <SubtotalRow
                    date={row.date}
                    net={row.net}
                    currency={account.currency}
                    cols={cols}
                    future={row.future}
                  />
                ) : (
                  <StatementRow
                    tx={row.tx}
                    showDate={row.showDate}
                    future={row.future}
                    cols={cols}
                    account={account}
                    cat={row.tx.categoryId ? catById.get(row.tx.categoryId) : undefined}
                    toAccount={row.tx.toAccountId ? accById.get(row.tx.toAccountId) : undefined}
                    recipient={row.tx.recipientId ? personById.get(row.tx.recipientId) : undefined}
                    family={row.tx.familyMemberId ? personById.get(row.tx.familyMemberId) : undefined}
                    balanceAfter={balances.get(row.tx.id)}
                    projected={projectedIds.has(row.tx.id)}
                    openModal={openModal}
                    removeTx={removeTx}
                    selectable={selectable}
                    selected={selectedIds?.has(row.tx.id)}
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

/* ── Bölüm bandı (Gelecek / Gerçekleşen) ───────────────────────────────────── */
function SectionBand({ id, count, first }: { id: 'future' | 'past'; count: number; first: boolean }) {
  const future = id === 'future'
  return (
    <div className={`flex items-center gap-3 px-4 pb-2 ${first ? 'pt-2.5' : 'pt-4'}`}>
      <span className={[
        'text-[10px] font-bold uppercase tracking-[0.11em] select-none whitespace-nowrap',
        future ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground/70',
      ].join(' ')}>
        {future ? 'Gelecek İşlemler' : 'Gerçekleşen İşlemler'} · {count}
      </span>
      <div className={`flex-1 h-px ${future ? 'bg-sky-500/25' : 'bg-border'}`} />
    </div>
  )
}

/* ── Gün ara toplamı — günün son satırından sonra düşen ince şerit ─────────── */
function SubtotalRow({
  date, net, currency, cols, future,
}: {
  date: string
  net: number
  currency?: CurrencyCode
  cols: string
  future: boolean
}) {
  return (
    <div
      className={`grid border-b border-border/60 px-3 ${future ? 'bg-sky-500/[0.04]' : 'bg-muted/40'}`}
      style={{ gridTemplateColumns: cols }}
    >
      <div />
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {formatDate(date, 'd MMMM')} · gün neti
      </div>
      <div className={`px-2 py-1 text-right text-[11px] font-bold tabular-nums ${
        net > 0 ? 'text-green-600' : net < 0 ? 'text-destructive' : 'text-muted-foreground'
      }`}>
        {net > 0 ? '+' : net < 0 ? '−' : ''}{formatCurrency(Math.abs(net), currency)}
      </div>
      <div />
      <div />
    </div>
  )
}

/* ── Ekstre satırı ─────────────────────────────────────────────────────────── */
const StatementRow = memo(function StatementRow({
  tx, showDate, future, cols, account, cat, toAccount, recipient, family, balanceAfter,
  projected, openModal, removeTx, selectable, selected, onToggleSelect,
}: {
  tx: Transaction
  showDate: boolean
  future: boolean
  cols: string
  account: Account
  cat?: Category
  toAccount?: Account
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
  const isIncome  = tx.type === 'income'
  const isXfer    = tx.type === 'transfer'
  const isRefund  = tx.type === 'expense' && tx.amount < 0
  const positive  = isIncome || isRefund
  const isPending = tx.approvalStatus === 'pending'

  return (
    <div
      className={[
        'group grid border-b border-border/40 px-3 transition-colors',
        selected ? 'bg-[var(--batch-accent-soft)]' : future ? 'bg-sky-500/[0.04] hover:bg-accent/40' : 'hover:bg-accent/40',
        projected ? 'opacity-75' : '',
      ].join(' ')}
      style={{ gridTemplateColumns: cols }}
    >
      {selectable && (
        <div className="flex items-center justify-center">
          {/* Planlanan satır henüz gerçek bir kayıt değil → toplu düzenlenemez */}
          {!projected && (
            <Checkbox checked={!!selected} onChange={() => onToggleSelect?.(tx.id)} aria-label="İşlemi seç" />
          )}
        </div>
      )}

      {/* Tarih — yalnızca gün değiştiğinde; tekrar eden satırlarda boş kalır */}
      <div className="flex items-center px-2 py-2">
        {showDate && (
          <span className={`text-[10.5px] font-semibold whitespace-nowrap ${
            future ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground'
          }`}>
            {formatDate(tx.date, 'd MMM')}
          </span>
        )}
      </div>

      {/* Açıklama + sessiz detay kuyruğu (kategori · alıcı · aile · etiket) */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden px-2 py-2">
        <TxIcon description={tx.description} />
        <span className="flex-shrink-0 text-xs font-medium leading-none text-foreground">
          {tx.description}
        </span>
        {tx.isInstallment && (
          <span className="flex-shrink-0 rounded-sm border border-orange-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
            {installmentLabel(tx)}
          </span>
        )}
        {isRefund && (
          <span className="flex-shrink-0 rounded-sm border border-green-600/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">
            İade
          </span>
        )}
        {projected && (
          <span className="flex-shrink-0 rounded-sm border border-sky-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-500">
            Planlandı
          </span>
        )}
        {isPending && (
          <span className="flex-shrink-0 rounded-sm border border-orange-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
            Onay bekliyor
          </span>
        )}

        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] leading-none text-muted-foreground/70">
          {cat && (
            <Link href={`/categories/${tx.categoryId}`} className="inline-flex items-center gap-1 truncate transition-colors hover:text-foreground">
              <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: cat.color }} />
              <span className="truncate">{cat.name}</span>
            </Link>
          )}
          {isXfer && toAccount && (
            <>
              <span className="opacity-40">→</span>
              <Link href={`/accounts/${tx.toAccountId}`} className="truncate transition-colors hover:text-foreground">
                {toAccount.name}
              </Link>
            </>
          )}
          {recipient && (
            <>
              {cat && <span className="opacity-40">·</span>}
              <Link href={`/alicilar/${tx.recipientId}`} className="truncate transition-colors hover:text-foreground">
                {recipient.name}
              </Link>
            </>
          )}
          {family && (
            <>
              {(cat || recipient) && <span className="opacity-40">·</span>}
              <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="truncate transition-colors hover:text-foreground">
                {family.name}
              </Link>
            </>
          )}
          <TagBadges tags={tx.tags} />
        </span>
      </div>

      {/* Tutar */}
      <div className="flex items-center justify-end px-2 py-2">
        <span className={[
          'text-xs font-semibold tabular-nums',
          positive ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
        ].join(' ')}>
          {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
        </span>
      </div>

      {/* Yürüyen bakiye */}
      <div className="flex items-center justify-end px-2 py-2">
        <span className={`text-xs tabular-nums ${
          balanceAfter === undefined ? 'text-muted-foreground/25'
            : balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground/60'
        }`}>
          {balanceAfter !== undefined ? formatCurrency(balanceAfter, account.currency) : '—'}
        </span>
      </div>

      {/* Eylemler — planlanan satır yalnızca düzenlenebilir (tarih öne çekme) */}
      <div className="row-actions flex items-center justify-end gap-0.5 px-1 opacity-0 transition-opacity group-hover:opacity-100">
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
