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
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import {
  TxIcon, DeleteConfirmDialog, PencilIcon, RefundIcon, installmentLabel,
} from '@/components/transactions/TransactionList'
import { dayTotals, sortDates, sortWithinDay, splitFuture, type TxViewProps } from './shared'
import type { Account, Category, ModalPayload, ModalType, Person, Transaction } from '@/types'

/* ── Gün Kartı görünümü ──────────────────────────────────────────────────────
   Her gün, kendi çerçevesi olan bir kart; günler arasındaki boşluk ayracın
   kendisidir (ayrıca çizgi çekilmez). Kart başlığında tarih, gün adı ve günün
   net etkisi durur.

   Tablodan farkı sütun olmaması: her satırın tüm ayrıntısı — hesap, alıcı hesap,
   alıcı, aile üyesi, kategori, etiketler — açıklamanın altında TEK bir meta
   satırında, her biri kendi ikonuyla akar. Böylece uzun isimler kolon sınırına
   takılıp kesilmez ve satırda anlam taşıyan renk sayısı ikiye iner (tutar +
   kategori noktası). */

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | { kind: 'day'; date: string; txs: Transaction[]; future: boolean }

export function DayCardView({
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
      for (const date of sortDates([...grouped.keys()], sort)) {
        out.push({ kind: 'day', date, txs: sortWithinDay(grouped.get(date)!, sort), future: isFuture })
      }
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
      // kart başlığı (38) + satırlar (~60) + kartlar arası boşluk (14)
      return r.kind === 'section' ? 46 : 52 + r.txs.length * 60
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
    <div
      ref={parentRef}
      className={`${heightClass} overflow-auto mx-6 my-3 rounded-xl border border-border/70 bg-background dark:bg-[#101010]`}
    >
      <div className="px-3 py-2">
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
                ) : (
                  <DayCard
                    date={row.date}
                    txs={row.txs}
                    future={row.future}
                    account={account}
                    balances={balances}
                    catById={catById}
                    accById={accById}
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

/* ── Bölüm bandı (Gelecek / Gerçekleşen) ───────────────────────────────────── */
function SectionBand({ id, count, first }: { id: 'future' | 'past'; count: number; first: boolean }) {
  const future = id === 'future'
  return (
    <div className={`flex items-center gap-3 px-1 pb-2.5 ${first ? 'pt-1' : 'pt-4'}`}>
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

/* ── Bir gün = bir kart ────────────────────────────────────────────────────── */
function DayCard({
  date, txs, future, account, balances, catById, accById, personById, projectedIds,
  openModal, removeTx, selectable, selectedIds, onToggleSelect,
}: {
  date: string
  txs: Transaction[]
  future: boolean
  account: Account
  balances: Map<string, number>
  catById: Map<string, Category>
  accById: Map<string, Account>
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

  return (
    <div className={[
      'mb-3.5 overflow-hidden rounded-xl border',
      future
        ? 'border-sky-500/25 bg-sky-500/[0.045]'
        : 'border-border dark:border-[#232323] bg-card',
    ].join(' ')}>
      {/* Kart başlığı — tarih, gün adı, günün neti */}
      <div className="flex items-baseline gap-2 border-b border-border/50 dark:border-white/[0.06] px-4 py-2.5">
        <span className={`text-[13px] font-bold tracking-tight ${
          future ? 'text-sky-600 dark:text-sky-400' : isToday ? 'text-primary' : 'text-foreground'
        }`}>
          {formatDate(date, 'd MMMM')}
        </span>
        <span className="text-[11.5px] text-muted-foreground/70">{formatDate(date, 'EEEE')}</span>
        {isToday && (
          <span className="rounded-sm bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
            Bugün
          </span>
        )}
        <span className="ml-auto flex items-baseline gap-2.5 whitespace-nowrap">
          <span className={`text-[12px] font-semibold tabular-nums ${
            totals.net > 0 ? 'text-green-600' : totals.net < 0 ? 'text-muted-foreground' : 'text-muted-foreground/60'
          }`}>
            {totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}
            {formatCurrency(Math.abs(totals.net), account.currency)}
          </span>
          <span className="text-[10.5px] text-muted-foreground/45">{txs.length} hareket</span>
        </span>
      </div>

      {txs.map((tx, i) => (
        <DayCardRow
          key={tx.id}
          tx={tx}
          first={i === 0}
          account={account}
          cat={tx.categoryId ? catById.get(tx.categoryId) : undefined}
          srcAccount={accById.get(tx.accountId)}
          toAccount={tx.toAccountId ? accById.get(tx.toAccountId) : undefined}
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
  )
}

/* ── İşlem satırı: ikon · gövde (başlık + meta) · tutar/bakiye · eylemler ──── */
const DayCardRow = memo(function DayCardRow({
  tx, first, account, cat, srcAccount, toAccount, recipient, family, balanceAfter,
  projected, openModal, removeTx, selectable, selected, onToggleSelect,
}: {
  tx: Transaction
  first: boolean
  account: Account
  cat?: Category
  srcAccount?: Account
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
  const isIncome = tx.type === 'income'
  const isXfer   = tx.type === 'transfer'
  const isRefund = tx.type === 'expense' && tx.amount < 0
  const positive = isIncome || isRefund
  const isPending = tx.approvalStatus === 'pending'

  return (
    <div className={[
      'group flex items-center gap-2.5 px-4 py-2.5 transition-colors',
      first ? '' : 'border-t border-border/40 dark:border-white/[0.055]',
      selected ? 'bg-[var(--batch-accent-soft)]' : 'hover:bg-accent/40',
      projected ? 'opacity-75' : '',
    ].join(' ')}>
      {selectable && (
        <div className="flex w-5 flex-shrink-0 items-center justify-center">
          {/* Planlanan satır henüz gerçek bir kayıt değil → toplu düzenlenemez */}
          {!projected && (
            <Checkbox checked={!!selected} onChange={() => onToggleSelect?.(tx.id)} aria-label="İşlemi seç" />
          )}
        </div>
      )}

      <TxIcon description={tx.description} />

      <div className="min-w-0 flex-1">
        {/* Başlık + durum rozetleri */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px] font-medium leading-tight text-foreground">
          <span className="truncate">{tx.description}</span>
          {tx.isInstallment && (
            <span className="rounded-sm border border-orange-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
              {installmentLabel(tx)}
            </span>
          )}
          {isRefund && (
            <span className="rounded-sm border border-green-600/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-green-600">
              İade
            </span>
          )}
          {projected && (
            <span className="rounded-sm border border-sky-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-500">
              Planlandı
            </span>
          )}
          {isPending && (
            <span className="rounded-sm border border-orange-500/40 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-500">
              Onay bekliyor
            </span>
          )}
        </div>

        {/* Tek meta satırı — her alan kendi ikonuyla. Sütun sınırı olmadığı için
            uzun isimler kesilmez; ayraç olarak yalnızca ince bir nokta kullanılır. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] leading-tight text-muted-foreground">
          {srcAccount && (
            <Link href={`/accounts/${tx.accountId}`} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
              <AccountAvatar account={srcAccount} size="xs" className="!h-[15px] !w-[15px]" />
              <span>{srcAccount.name}</span>
            </Link>
          )}
          {isXfer && toAccount && (
            <>
              <span className="text-muted-foreground/40">→</span>
              <Link href={`/accounts/${tx.toAccountId}`} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                <AccountAvatar account={toAccount} size="xs" className="!h-[15px] !w-[15px]" />
                <span>{toAccount.name}</span>
              </Link>
            </>
          )}
          {recipient && (
            <>
              <Dot />
              <Link href={`/alicilar/${tx.recipientId}`} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                <PersonAvatar person={recipient} size="xs" className="!h-[15px] !w-[15px]" />
                <span>{recipient.name}</span>
              </Link>
            </>
          )}
          {family && (
            <>
              <Dot />
              <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
                <PersonAvatar person={family} size="xs" className="!h-[15px] !w-[15px]" />
                <span>{family.name}</span>
              </Link>
            </>
          )}
          {cat && (
            <>
              <Dot />
              <Link href={`/categories/${tx.categoryId}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground">
                <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: cat.color }} />
                <span>{cat.name}</span>
              </Link>
            </>
          )}
          <TagBadges tags={tx.tags} />
        </div>
      </div>

      {/* Tutar + o işlemden sonraki bakiye */}
      <div className="flex flex-shrink-0 flex-col items-end whitespace-nowrap leading-tight">
        <span className={[
          'text-[14px] font-semibold tabular-nums tracking-tight',
          positive ? 'text-green-600' : isXfer ? 'text-muted-foreground' : 'text-foreground',
        ].join(' ')}>
          {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
        </span>
        <span className="mt-px text-[11px] tabular-nums text-muted-foreground/55">
          {balanceAfter !== undefined
            ? formatCurrency(balanceAfter, account.currency)
            : isPending ? 'bakiyeye işlenmedi' : '—'}
        </span>
      </div>

      {/* Eylemler — planlanan satır yalnızca düzenlenebilir (örn. erken yatan
          maaş için tarih öne çekme); iade/silme yok, henüz gerçek kayıt değil. */}
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

function Dot() {
  return <span className="text-muted-foreground/35">·</span>
}
