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
import { SplitCountBadge } from '@/components/transactions/SplitCountBadge'
import {
  TxIcon, DeleteConfirmDialog, PencilIcon, RefundIcon, installmentLabel,
} from '@/components/transactions/TransactionList'
import { dayTotals, sortDates, sortWithinDay, splitFuture, type TxViewProps } from './shared'
import type { Account, Category, CurrencyCode, ModalPayload, ModalType, Person, Transaction } from '@/types'

/* ── Ayraçsız Tablo görünümü ─────────────────────────────────────────────────
   Kolonlar duruyor, çizgiler gidiyor. Ne satır ayracı, ne zebra, ne dikey kenar
   — okunabilirliği tamamen HİZA taşıyor. Kategori, alıcı ve aile üyesi her
   satırda tam olarak aynı x konumunda başladığı için göz konumu bir kez öğrenip
   bir daha aramıyor; dikey karşılaştırma (bütün Migros'ları görmek) en güçlü
   burada.

   Satır 32px (tablonun 64px'lik gün bloklu satırının yarısı). Gün ayracı kart
   değil, tek satırlık dolgulu bir bant: tarih, gün adı, hareket sayısı ve günün
   neti. Hesap kolonu yok — hesabın KENDİ detay sayfasındayız, her satırda aynı
   adı basmak sadece yer yerdi; transferin hedef hesabı "Alıcı" kolonunda
   "→ Bonus Kart" olarak görünür. */

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

const COLS     = '18px minmax(150px,1.6fr) 124px 116px 92px 108px 104px 64px'
const SELECT_W = 30
const MIN_W    = 18 + 150 + 124 + 116 + 92 + 108 + 104 + 64 + 24
const colsFor = (selectable: boolean) => (selectable ? `${SELECT_W}px ${COLS}` : COLS)

const HEADERS = ['', 'Açıklama', 'Kategori', 'Alıcı', 'Aile Üyesi', 'Miktar', 'Güncel Bakiye', '']

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | { kind: 'day'; date: string; count: number; net: number; future: boolean }
  | { kind: 'tx'; tx: Transaction; future: boolean }

export function RulelessTableView({
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

  // Tarih bazlı sıralamada gün bantları vardır; tutar sıralamasında gün kavramı
  // kalmaz → bant basılmaz, satırlar kesintisiz akar.
  const dateGrouped = sort === 'date-desc' || sort === 'date-asc'

  const rows = useMemo<Row[]>(() => {
    const { future, past } = splitFuture(transactions, today())
    const out: Row[] = []

    const push = (txs: Transaction[], isFuture: boolean) => {
      if (!dateGrouped) {
        for (const tx of sortWithinDay(txs, sort)) out.push({ kind: 'tx', tx, future: isFuture })
        return
      }
      const grouped = groupByDate(txs)
      for (const date of sortDates([...grouped.keys()], sort)) {
        const day = sortWithinDay(grouped.get(date)!, sort)
        out.push({
          kind:   'day',
          date,
          count:  day.length,
          net:    dayTotals(account, day).net,
          future: isFuture,
        })
        for (const tx of day) out.push({ kind: 'tx', tx, future: isFuture })
      }
    }

    if (future.length > 0) {
      out.push({ kind: 'section', id: 'future', count: future.length, first: true })
      push(future, true)
      if (past.length > 0) out.push({ kind: 'section', id: 'past', count: past.length, first: false })
    }
    push(past, false)
    return out
  }, [transactions, sort, dateGrouped, account])

  // Toplu seçim kapsamı: planlanan satırlar henüz gerçek kayıt değil, dışarıda.
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
      if (r.kind === 'section') return 34
      if (r.kind === 'day')     return 24
      return 32
    },
    overscan: 16,
    getItemKey: i => {
      const r = rows[i]
      if (r.kind === 'section') return `s:${r.id}`
      if (r.kind === 'day')     return `d:${r.future ? 'f' : 'p'}:${r.date}`
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
        {/* Sticky sütun başlığı — tek çizgi burada, kolonların çapası. Sticky
            olduğu için zemin opak olmalı. */}
        <div className="sticky top-0 z-10 border-b border-border bg-card">
          <div className="grid items-center px-3" style={{ gridTemplateColumns: cols }}>
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
            {HEADERS.map((h, i) => (
              <div
                key={i}
                className={[
                  'py-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/60 select-none',
                  h === 'Miktar' || h === 'Güncel Bakiye' ? 'px-2 text-right' : 'px-2',
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
                ) : row.kind === 'day' ? (
                  <DayBand
                    date={row.date}
                    count={row.count}
                    net={row.net}
                    currency={account.currency}
                    future={row.future}
                  />
                ) : (
                  <RulelessRow
                    tx={row.tx}
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
    <div className={`flex items-center gap-2.5 px-4 pb-1.5 ${first ? 'pt-2' : 'pt-3'}`}>
      <span className={[
        'text-[9.5px] font-bold uppercase tracking-[0.11em] select-none whitespace-nowrap',
        future ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground/60',
      ].join(' ')}>
        {future ? 'Gelecek' : 'Gerçekleşen'} · {count}
      </span>
      <div className={`flex-1 h-px ${future ? 'bg-sky-500/25' : 'bg-border'}`} />
    </div>
  )
}

/* ── Gün bandı — kart değil, 24px'lik tek satır dolgulu şerit ──────────────── */
function DayBand({
  date, count, net, currency, future,
}: {
  date: string
  count: number
  net: number
  currency?: CurrencyCode
  future: boolean
}) {
  const isToday = date.slice(0, 10) === today()
  return (
    <div className={[
      'flex h-6 items-center gap-2 border-y px-4',
      future ? 'border-sky-500/20 bg-sky-500/[0.07]' : 'border-border/70 bg-muted/60',
    ].join(' ')}>
      <span className={`text-[10.5px] font-bold tracking-tight ${
        future ? 'text-sky-600 dark:text-sky-400' : isToday ? 'text-primary' : 'text-foreground'
      }`}>
        {formatDate(date, 'd MMM')}
      </span>
      <span className="text-[10px] text-muted-foreground/70">{formatDate(date, 'EEEE')}</span>
      {isToday && (
        <span className="rounded-sm bg-primary/10 px-1 text-[8.5px] font-bold uppercase tracking-wide text-primary">
          Bugün
        </span>
      )}
      <span className="ml-auto flex items-center gap-2.5 whitespace-nowrap">
        <span className="text-[9.5px] text-muted-foreground/55">{count} hareket</span>
        <span className={`text-[10.5px] font-bold tabular-nums ${
          net > 0 ? 'text-green-600' : net < 0 ? 'text-muted-foreground' : 'text-muted-foreground/60'
        }`}>
          {net > 0 ? '+' : net < 0 ? '−' : ''}{formatCurrency(Math.abs(net), currency)}
        </span>
      </span>
    </div>
  )
}

/* ── İşlem satırı — 32px, hiçbir ayraç yok; hiza tek başına iş görür ───────── */
const RulelessRow = memo(function RulelessRow({
  tx, future, cols, account, cat, toAccount, recipient, family, balanceAfter,
  projected, openModal, removeTx, selectable, selected, onToggleSelect,
}: {
  tx: Transaction
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
        // Bilinçli olarak border/zebra YOK — görünümün tüm fikri bu.
        'group grid h-8 items-center px-3 transition-colors',
        selected ? 'bg-[var(--batch-accent-soft)]' : future ? 'bg-sky-500/[0.045] hover:bg-accent/50' : 'hover:bg-accent/50',
        projected ? 'opacity-75' : '',
      ].join(' ')}
      style={{ gridTemplateColumns: cols }}
    >
      {selectable && (
        <div className="flex items-center justify-center">
          {!projected && (
            <Checkbox checked={!!selected} onChange={() => onToggleSelect?.(tx.id)} aria-label="İşlemi seç" />
          )}
        </div>
      )}

      {/* İkon — kolon değil, açıklamanın çapası */}
      <div className="flex items-center justify-center">
        <TxIcon description={tx.description} recipient={recipient} />
      </div>

      {/* Açıklama + durum rozetleri + etiketler */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2">
        <span className="truncate text-xs font-medium leading-none text-foreground">
          {tx.description}
        </span>
        {tx.isInstallment && (
          <Badge tone="orange">{installmentLabel(tx)}</Badge>
        )}
        {isRefund  && <Badge tone="green">İade</Badge>}
        {projected && <Badge tone="sky">Planlandı</Badge>}
        {isPending && <Badge tone="orange">Onay bekliyor</Badge>}
        <TagBadges tags={tx.tags} />
      </div>

      {/* Kategori */}
      <Cell>
        {cat ? (
          <Link href={`/categories/${tx.categoryId}`} className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground">
            <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: cat.color }} />
            <span className="truncate">{cat.name}</span>
            <SplitCountBadge tx={tx} />
          </Link>
        ) : <Empty />}
      </Cell>

      {/* Alıcı — transferde hedef hesap "→ X" olarak aynı kolonda */}
      <Cell>
        {isXfer && toAccount ? (
          <Link href={`/accounts/${tx.toAccountId}`} className="flex min-w-0 items-center gap-1 transition-colors hover:text-foreground">
            <span className="flex-shrink-0 opacity-50">→</span>
            <span className="truncate">{toAccount.name}</span>
          </Link>
        ) : recipient ? (
          <Link href={`/alicilar/${tx.recipientId}`} className="min-w-0 truncate transition-colors hover:text-foreground">
            {recipient.name}
          </Link>
        ) : <Empty />}
      </Cell>

      {/* Aile üyesi */}
      <Cell>
        {family ? (
          <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="min-w-0 truncate transition-colors hover:text-foreground">
            {family.name}
          </Link>
        ) : <Empty />}
      </Cell>

      {/* Miktar */}
      <div className="flex items-center justify-end px-2">
        <span className={[
          'text-xs font-semibold tabular-nums',
          positive ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
        ].join(' ')}>
          {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
        </span>
      </div>

      {/* Güncel bakiye */}
      <div className="flex items-center justify-end px-2">
        <span className={`text-[11px] tabular-nums ${
          balanceAfter === undefined ? 'text-muted-foreground/25'
            : balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground/60'
        }`}>
          {balanceAfter !== undefined ? formatCurrency(balanceAfter, account.currency) : '—'}
        </span>
      </div>

      {/* Eylemler — planlanan satır yalnızca düzenlenebilir (örn. erken yatan
          maaş için tarih öne çekme); iade/silme yok, henüz gerçek kayıt değil. */}
      <div className="row-actions flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {projected ? (
          <ActionButton title="Tarihi Düzenle" onClick={() => openModal('edit-transaction', { id: tx.id, plannedTx: tx })}>
            <PencilIcon size={12} />
          </ActionButton>
        ) : (
          <>
            {tx.type === 'expense' && tx.amount > 0 && (
              <ActionButton title="İade İşle" tone="green" onClick={() => openModal('refund-transaction', { id: tx.id })}>
                <RefundIcon size={12} />
              </ActionButton>
            )}
            <ActionButton title="Düzenle" onClick={() => openModal('edit-transaction', { id: tx.id })}>
              <PencilIcon size={12} />
            </ActionButton>
            <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
          </>
        )}
      </div>
    </div>
  )
})

/* ── Küçük yardımcılar ─────────────────────────────────────────────────────── */
function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center overflow-hidden px-2 text-[11px] text-muted-foreground">
      {children}
    </div>
  )
}

function Empty() {
  return <span className="text-muted-foreground/25">—</span>
}

const TONES = {
  orange: 'border-orange-500/40 text-orange-500',
  green:  'border-green-600/40 text-green-600',
  sky:    'border-sky-500/40 text-sky-500',
}

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`flex-shrink-0 rounded-sm border px-1 text-[8.5px] font-bold uppercase tracking-wide leading-[1.5] ${TONES[tone]}`}>
      {children}
    </span>
  )
}

function ActionButton({
  title, onClick, tone, children,
}: {
  title: string
  onClick: () => void
  tone?: 'green'
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors',
        tone === 'green' ? 'hover:bg-green-500/10 hover:text-green-600' : 'hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
