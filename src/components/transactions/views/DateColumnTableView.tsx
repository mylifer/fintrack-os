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
import { sortDates, sortWithinDay, splitFuture, type TxViewProps } from './shared'
import type { Account, Category, ModalPayload, ModalType, Person, Transaction } from '@/types'

/* ── Tarih Kolonu görünümü ───────────────────────────────────────────────────
   Gün ayracı YOK — çünkü tarih bir kolon. Sol kolona güne yalnızca BİR kez
   yazılır (altındaki satırlarda hücre boş kalır) ve kolonun sağındaki dikey
   kılcal tablo boyunca kesintisiz iner. Izgara hiçbir yerde kırılmadığı için
   dikey tarama baştan sona sürer; gün sınırını yalnızca yeni tarihin belirmesi
   ve grubun üstündeki tek yatay çizgi kurar.

   Bandı olmadığı için gün neti bu görünümde gösterilmez — tek işlemli gün tek
   satır yer kaplar, bu da görünümün asıl kazancıdır. Gün özeti isteyen kullanıcı
   Tablo veya Ayraçsız görünümünü seçer. */

type OpenModal = (type: NonNullable<ModalType>, payload?: ModalPayload) => void

const COLS     = '64px 18px minmax(150px,1.6fr) 124px 116px 92px 108px 104px 64px'
const SELECT_W = 30
const MIN_W    = 64 + 18 + 150 + 124 + 116 + 92 + 108 + 104 + 64 + 24
const colsFor = (selectable: boolean) => (selectable ? `${SELECT_W}px ${COLS}` : COLS)

const HEADERS = ['Tarih', '', 'Açıklama', 'Kategori', 'Alıcı', 'Aile Üyesi', 'Miktar', 'Güncel Bakiye', '']

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number; first: boolean }
  | {
      kind: 'tx'
      tx: Transaction
      future: boolean
      /** Günün ilk satırı mı — tarih hücresi yalnızca burada dolu, grubu ayıran
       *  tek yatay çizgi de buraya çizilir. */
      dayStart: boolean
      /** Listenin en başı: üstüne ayırıcı çizgi çizilmez. */
      firstOfAll: boolean
    }

export function DateColumnTableView({
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

  // Bakiye diğer görünümlerle ORTAK kaynaktan; planlananlar defterin sonuna
  // eklenerek ileriye dönük projeksiyon üretir.
  const balances = useMemo(
    () => computeRunningBalances(
      plannedTxs.length ? [...allTxs, ...plannedTxs] : allTxs,
      [account.id],
      accById,
    ),
    [allTxs, plannedTxs, account.id, accById],
  )

  // Tutar sıralamasında gün kavramı kalmaz → gruplama yok, her satır kendi
  // tarihini yazar (kolon anlamını korur).
  const dateGrouped = sort === 'date-desc' || sort === 'date-asc'

  const rows = useMemo<Row[]>(() => {
    const { future, past } = splitFuture(transactions, today())
    const out: Row[] = []
    let seen = 0

    const push = (txs: Transaction[], isFuture: boolean) => {
      if (!dateGrouped) {
        for (const tx of sortWithinDay(txs, sort)) {
          out.push({ kind: 'tx', tx, future: isFuture, dayStart: true, firstOfAll: seen++ === 0 })
        }
        return
      }
      const grouped = groupByDate(txs)
      for (const date of sortDates([...grouped.keys()], sort)) {
        sortWithinDay(grouped.get(date)!, sort).forEach((tx, i) => {
          out.push({ kind: 'tx', tx, future: isFuture, dayStart: i === 0, firstOfAll: seen++ === 0 })
        })
      }
    }

    if (future.length > 0) {
      out.push({ kind: 'section', id: 'future', count: future.length, first: true })
      push(future, true)
      if (past.length > 0) {
        out.push({ kind: 'section', id: 'past', count: past.length, first: false })
        seen = 0   // bölüm başlığı zaten ayırıyor; altındaki ilk satıra çizgi gerekmez
      }
    }
    push(past, false)
    return out
  }, [transactions, sort, dateGrouped])

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
    estimateSize: i => (rows[i].kind === 'section' ? 34 : 34),
    overscan: 16,
    getItemKey: i => {
      const r = rows[i]
      return r.kind === 'section' ? `s:${r.id}` : `t:${r.tx.id}`
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
        {/* Sticky sütun başlığı — kolonların çapası. Sticky olduğu için zemin opak. */}
        <div className="sticky top-0 z-10 border-b border-border bg-card">
          <div className="grid items-stretch px-3" style={{ gridTemplateColumns: cols }}>
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
                  'flex items-center py-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/60 select-none',
                  // Tarih kolonunun kılcalı başlıktan itibaren başlar
                  h === 'Tarih' ? 'px-2 border-r border-border/50' : '',
                  h === 'Miktar' || h === 'Güncel Bakiye' ? 'px-2 justify-end' : h === 'Tarih' ? '' : 'px-2',
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
                ) : (
                  <DateColumnRow
                    tx={row.tx}
                    future={row.future}
                    dayStart={row.dayStart}
                    firstOfAll={row.firstOfAll}
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

/* ── İşlem satırı — 34px; tek yatay çizgi gün grubunun üstünde ────────────── */
const DateColumnRow = memo(function DateColumnRow({
  tx, future, dayStart, firstOfAll, cols, account, cat, toAccount, recipient, family,
  balanceAfter, projected, openModal, removeTx, selectable, selected, onToggleSelect,
}: {
  tx: Transaction
  future: boolean
  dayStart: boolean
  firstOfAll: boolean
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
  const isToday   = tx.date.slice(0, 10) === today()

  return (
    <div
      className={[
        // Satır ayracı YOK; tek yatay çizgi gün grubunu açan satırın üstünde.
        'group grid h-[34px] items-stretch px-3 transition-colors',
        dayStart && !firstOfAll ? 'border-t border-border' : '',
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

      {/* Tarih kolonu — güne bir kez dolu, kılcalı tablo boyunca iner */}
      <div className="flex flex-col justify-center border-r border-border/50 px-2 leading-none">
        {dayStart && (
          <>
            <span className={`text-[10.5px] font-bold ${
              future ? 'text-sky-600 dark:text-sky-400' : isToday ? 'text-primary' : 'text-foreground'
            }`}>
              {formatDate(tx.date, 'd MMM')}
            </span>
            <span className="mt-0.5 text-[9px] text-muted-foreground/60">
              {isToday ? 'Bugün' : formatDate(tx.date, 'EEE')}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-center">
        <TxIcon description={tx.description} />
      </div>

      {/* Açıklama + durum rozetleri + etiketler */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2">
        <span className="truncate text-xs font-medium leading-none text-foreground">
          {tx.description}
        </span>
        {tx.isInstallment && <Badge tone="orange">{installmentLabel(tx)}</Badge>}
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
