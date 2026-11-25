'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAccountStore, useCategoryStore, usePeopleStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { awaitsApproval, groupByDate } from '@/lib/utils/calculations'
import { EmptyState } from '@/components/ui/EmptyState'
import { Checkbox } from '@/components/ui/Checkbox'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { DEFAULT_ICON } from '@/lib/category-palette'
import { installmentLabel } from '@/components/transactions/TransactionList'
import { useFocusTxRow, FOCUS_ROW_CLASS } from '@/lib/hooks/useFocusTxRow'
import { TxDetailSheet } from './TxDetailSheet'
import { dayTotals, sortDates, sortWithinDay, splitFuture, type TxViewProps } from './shared'
import type { Account, Category, Person, Transaction } from '@/types'

/* ── Akış görünümü ───────────────────────────────────────────────────────────
   Banka uygulaması dilinde bir liste: solda kategorinin renkli simgesi, ortada
   açıklama ve tek satırlık bağlam (kategori · alıcı / hedef hesap · aile
   üyesi), sağda tutar. Tutarlar her satırda aynı sağ kenara hizalı — kolon
   hizası bu görünümde de korunur, yalnızca az kullanılan kolonlar bağlam
   satırında toplanır. Satıra dokununca ayrıntı paneli (TxDetailSheet) açılır;
   düzenleme, iade ve silme oradadır. */

type Row =
  | { kind: 'section'; id: 'future' | 'past'; count: number }
  | { kind: 'day'; date: string; net: number; future: boolean }
  | { kind: 'tx'; tx: Transaction; future: boolean }

function dayLabel(date: string): string {
  const d = date.slice(0, 10)
  const t = today()
  if (d === t) return 'Bugün'
  const y = new Date(t + 'T12:00:00'); y.setDate(y.getDate() - 1)
  if (d === y.toISOString().slice(0, 10)) return 'Dün'
  return formatDate(d, 'd MMMM, EEEE')
}

export function FeedView({
  transactions, account, projectedIds, sort,
  emptyTitle, emptyDescription, heightClass,
  selectable, selectedIds, onToggleSelect, onSelectMany,
}: TxViewProps) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)

  const catById    = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById    = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])

  const [openTx, setOpenTx] = useState<Transaction | null>(null)
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
        out.push({ kind: 'day', date, net: dayTotals(account, day).net, future: isFuture })
        for (const tx of day) out.push({ kind: 'tx', tx, future: isFuture })
      }
    }
    if (future.length > 0) {
      out.push({ kind: 'section', id: 'future', count: future.length })
      push(future, true)
      if (past.length > 0) out.push({ kind: 'section', id: 'past', count: past.length })
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
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual; derleyici bu bileşeni atlar, bilinen ve zararsız
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: i => (rows[i].kind === 'tx' ? 64 : rows[i].kind === 'day' ? 40 : 36),
    overscan: 12,
    getItemKey: i => {
      const r = rows[i]
      if (r.kind === 'section') return `s:${r.id}`
      if (r.kind === 'day') return `d:${r.future ? 'f' : 'p'}:${r.date}`
      return `t:${r.tx.id}`
    },
  })

  const scrollToRow = useCallback((i: number) => {
    parentRef.current?.scrollIntoView({ block: 'end' })
    virtualizer.scrollToIndex(i, { align: 'center' })
  }, [virtualizer])
  const focusedTxId = useFocusTxRow(account.id, rows, scrollToRow)

  if (transactions.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  return (
    <>
      <div ref={parentRef} className={`${heightClass} overflow-auto mx-4 lg:mx-6 my-3 rounded-2xl border border-border/70 bg-card`}>
        {selectable && (
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-2">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onChange={() => onSelectMany?.(eligibleIds, !allSelected)}
              disabled={eligibleIds.length === 0}
              aria-label="Tümünü seç"
            />
            <span className="text-xs text-muted-foreground">
              {selectedIds && selectedIds.size > 0 ? `${selectedIds.size} işlem seçili` : `${eligibleIds.length} işlem`}
            </span>
          </div>
        )}
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
                  <div className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {row.id === 'future' ? 'Gelecek' : 'Gerçekleşen'} · {row.count}
                  </div>
                ) : row.kind === 'day' ? (
                  <div className="flex items-center justify-between px-5 pt-4 pb-1.5 text-[13px] font-bold text-muted-foreground">
                    <span className={row.future ? 'text-sky-600 dark:text-sky-400' : ''}>{dayLabel(row.date)}</span>
                    <span className={`tabular-nums ${row.net > 0 ? 'text-green-600' : ''}`}>
                      {row.net > 0 ? '+' : row.net < 0 ? '−' : ''}{formatCurrency(Math.abs(row.net), account.currency)}
                    </span>
                  </div>
                ) : (
                  <FeedRow
                    tx={row.tx}
                    future={row.future}
                    cat={row.tx.categoryId ? catById.get(row.tx.categoryId) : undefined}
                    toAccount={row.tx.toAccountId ? accById.get(row.tx.toAccountId) : undefined}
                    fromAccount={row.tx.toAccountId === account.id ? accById.get(row.tx.accountId) : undefined}
                    recipient={row.tx.recipientId ? personById.get(row.tx.recipientId) : undefined}
                    family={row.tx.familyMemberId ? personById.get(row.tx.familyMemberId) : undefined}
                    account={account}
                    projected={projectedIds.has(row.tx.id)}
                    focused={focusedTxId === row.tx.id}
                    selectable={selectable}
                    selected={selectedIds?.has(row.tx.id)}
                    onToggleSelect={onToggleSelect}
                    onOpen={setOpenTx}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {openTx && (
        <TxDetailSheet
          tx={openTx}
          account={account}
          projected={projectedIds.has(openTx.id)}
          onClose={() => setOpenTx(null)}
        />
      )}
    </>
  )
}

const FeedRow = memo(function FeedRow({
  tx, future, cat, toAccount, fromAccount, recipient, family, account,
  projected, focused, selectable, selected, onToggleSelect, onOpen,
}: {
  tx: Transaction
  future: boolean
  cat?: Category
  toAccount?: Account
  fromAccount?: Account
  recipient?: Person
  family?: Person
  account: Account
  projected: boolean
  focused?: boolean
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  onOpen: (tx: Transaction) => void
}) {
  const isXfer   = tx.type === 'transfer'
  const incoming = isXfer && tx.toAccountId === account.id
  const isRefund = tx.type === 'expense' && tx.amount < 0
  const positive = tx.type === 'income' || isRefund || incoming
  const pending  = awaitsApproval(tx)
  const inst     = tx.isInstallment || !!tx.installGroupId

  const context = [
    isXfer ? (incoming ? `← ${fromAccount?.name ?? 'Transfer'}` : `→ ${toAccount?.name ?? 'Transfer'}`) : cat?.name ?? 'Kategorisiz',
    !isXfer && recipient ? recipient.name : null,
    family ? family.name : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      className={[
        'group mx-2 flex items-center gap-3 rounded-xl px-2 transition-colors',
        selected ? 'bg-[var(--batch-accent-soft)]' : 'hover:bg-accent/60',
        future || projected ? 'opacity-80' : '',
        focused ? FOCUS_ROW_CLASS : '',
      ].join(' ')}
    >
      {selectable && (
        <div className="flex w-5 flex-none items-center justify-center">
          {!projected && <Checkbox checked={!!selected} onChange={() => onToggleSelect?.(tx.id)} aria-label={`${tx.description} seç`} />}
        </div>
      )}
      <button
        type="button"
        onClick={() => onOpen(tx)}
        className="flex min-w-0 flex-1 items-center gap-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-lg"
      >
        {isXfer ? (
          <span className="inline-flex size-[38px] flex-none items-center justify-center rounded-[11px] bg-slate-500 text-white" aria-hidden="true">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h11l-3-3M17 17H6l3 3" />
            </svg>
          </span>
        ) : (
          <CategoryIcon icon={cat?.icon ?? DEFAULT_ICON} color={cat?.color ?? '#94a3b8'} size={24} className="flex-none" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-foreground">{tx.description}</span>
            {inst && <Pill>{installmentLabel(tx)}</Pill>}
            {isRefund && <Pill tone="green">İade</Pill>}
            {projected && <Pill tone="sky">Planlandı</Pill>}
            {pending && <Pill tone="orange">Onay bekliyor</Pill>}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">{context}</span>
        </span>
        <span className="flex flex-none flex-col items-end">
          <span className={`text-[15px] font-bold tabular-nums ${positive ? 'text-green-600' : isXfer ? 'text-foreground/70' : 'text-foreground'}`}>
            {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
          </span>
          {inst && tx.installTotal ? (
            <span className="text-xs text-muted-foreground tabular-nums">toplam {formatCurrency(Math.abs(tx.amount) * tx.installTotal, tx.currency)}</span>
          ) : null}
        </span>
      </button>
    </div>
  )
})

const PILL_TONES = {
  default: 'bg-muted text-foreground',
  green:   'bg-green-600/12 text-green-600',
  sky:     'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  orange:  'bg-orange-500/12 text-orange-600 dark:text-orange-400',
}

function Pill({ tone = 'default', children }: { tone?: keyof typeof PILL_TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex h-5 flex-none items-center rounded-full px-2 text-[11px] font-bold ${PILL_TONES[tone]}`}>
      {children}
    </span>
  )
}
