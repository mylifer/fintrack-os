'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useAccountStore, useCategoryStore, usePeopleStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { awaitsApproval, computeTransactionEffect, groupByDate } from '@/lib/utils/calculations'
import { DEFAULT_ICON } from '@/lib/category-palette'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { Checkbox } from '@/components/ui/Checkbox'
import { installmentLabel } from '@/components/transactions/TransactionList'
import { TxDetailSheet } from '@/components/transactions/views/TxDetailSheet'
import { sortDates, sortWithinDay } from '@/components/transactions/views/shared'
import type { TxSortOption } from '@/components/transactions/TransactionList'
import type { Account, Transaction } from '@/types'

/* İndigo "İşlemler" paneli — demodaki akış: arama, süzgeç düğmeleri, güne
   göre gruplu satırlar, "Daha fazla göster". Veri (dönem + süzgeçler) sayfada
   hazırlanır; panel yalnız sunar. Toplu düzenleme "Seç" ile açılır, tam
   kolonlu tablo "Tablo" seçeneğiyle (tableSlot) durur. */

export type FeedChip = 'all' | 'inst' | 'big' | 'pay'
export const FEED_CHIPS: { id: FeedChip; label: string }[] = [
  { id: 'all',  label: 'Tümü' },
  { id: 'inst', label: 'Taksitli' },
  { id: 'big',  label: '₺2.000 üstü' },
  { id: 'pay',  label: 'Ödeme ve iadeler' },
]

const PAGE = 15

function dayLabel(date: string): string {
  const t = today()
  if (date === t) return 'Bugün'
  const y = new Date(t + 'T12:00:00'); y.setDate(y.getDate() - 1)
  if (date === y.toISOString().slice(0, 10)) return 'Dün'
  return formatDate(date, 'd MMMM, EEEE')
}

export function AccountFeedPanel({
  account, transactions, projectedIds, sort,
  search, onSearch, chip, onChip, weekLabel, onClearWeek,
  filtersSlot, filterCount, tableSlot,
  selectedIds, onToggleSelect, onSelectMany,
}: {
  account: Account
  transactions: Transaction[]
  projectedIds: Set<string>
  sort: TxSortOption
  search: string
  onSearch: (v: string) => void
  chip: FeedChip
  onChip: (c: FeedChip) => void
  /** Haftalık grafikten seçilen aralık (varsa süzgeç düğmesi olarak görünür) */
  weekLabel: string | null
  onClearWeek: () => void
  /** Kategori / aile / alıcı / sıralama seçicileri */
  filtersSlot: ReactNode
  filterCount: number
  /** Tam kolonlu tablo görünümü */
  tableSlot: ReactNode
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectMany: (ids: string[], selected: boolean) => void
}) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const catById    = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById    = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])

  const [searchOpen, setSearchOpen] = useState(!!search)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mode, setMode] = useState<'feed' | 'table'>('feed')
  const [selecting, setSelecting] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [openTx, setOpenTx] = useState<Transaction | null>(null)

  // Süzgeç / arama değişince sayfalama başa döner (render sırasında ayarlanır)
  const listKey = `${transactions.length}|${search}|${chip}|${weekLabel}`
  const [seenKey, setSeenKey] = useState(listKey)
  if (seenKey !== listKey) { setSeenKey(listKey); setLimit(PAGE) }

  // Gelecek tarihli kayıtlar (taksit, planlanan) üstte ayrı grupta
  const todayStr = today()
  const ordered = useMemo(() => {
    const dateSorted = sort === 'date-desc' || sort === 'date-asc'
    const fut = transactions.filter(t => t.date.slice(0, 10) > todayStr)
    const past = transactions.filter(t => t.date.slice(0, 10) <= todayStr)
    const arrange = (txs: Transaction[]) => {
      if (!dateSorted) return sortWithinDay(txs, sort)
      const g = groupByDate(txs)
      return sortDates([...g.keys()], sort).flatMap(d => sortWithinDay(g.get(d)!, sort))
    }
    return [...arrange(fut), ...arrange(past)]
  }, [transactions, sort, todayStr])
  const shown = ordered.slice(0, limit)
  const dayGroups = sort === 'date-desc' || sort === 'date-asc'

  const eligible = useMemo(() => transactions.filter(t => !projectedIds.has(t.id)).map(t => t.id), [transactions, projectedIds])
  const allSel = eligible.length > 0 && eligible.every(id => selectedIds.has(id))

  const items: ReactNode[] = []
  let lastDate = ''
  let futureHeader = false
  for (const t of shown) {
    const d = t.date.slice(0, 10)
    if (d > todayStr && !futureHeader) {
      futureHeader = true
      items.push(<div key="fut" className="px-1.5 pt-4 pb-1 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--ip-sub)]">Gelecek</div>)
    }
    if (dayGroups && d !== lastDate) {
      lastDate = d
      const net = ordered.filter(r => r.date.slice(0, 10) === d).reduce((s, r) => s + computeTransactionEffect(account, [r]), 0)
      items.push(
        <div key={`d:${d}`} className="flex justify-between px-1.5 pt-4 pb-1.5 text-[13px] font-bold text-[var(--ip-sub)]">
          <span>{dayLabel(d)}</span>
          <span className="tabular-nums">{net < 0 ? '−' : '+'}{formatCurrency(Math.abs(net), account.currency)}</span>
        </div>,
      )
    }
    items.push(
      <FeedRow
        key={t.id}
        tx={t}
        account={account}
        catName={t.categoryId ? catById.get(t.categoryId)?.name : undefined}
        catIcon={t.categoryId ? catById.get(t.categoryId)?.icon : undefined}
        catColor={t.categoryId ? catById.get(t.categoryId)?.color : undefined}
        otherAccount={t.type === 'transfer' ? accById.get(t.toAccountId === account.id ? t.accountId : t.toAccountId ?? '')?.name : undefined}
        recipient={t.recipientId ? personById.get(t.recipientId)?.name : undefined}
        projected={projectedIds.has(t.id)}
        selecting={selecting}
        selected={selectedIds.has(t.id)}
        onToggle={onToggleSelect}
        onOpen={setOpenTx}
      />,
    )
  }

  const chipCls = 'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors'
  const chipOff = `${chipCls} bg-[var(--ip-chip)] text-[var(--ip-fg)] hover:brightness-95`
  const chipOn  = `${chipCls} bg-[var(--ip-fg)] text-[var(--ip-page)]`

  return (
    <section className="rounded-3xl border border-[var(--ip-line)] bg-[var(--ip-panel)] p-[22px] min-w-0" aria-labelledby="feed-title">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="feed-title" className="text-lg font-bold tracking-tight">İşlemler</h2>
        <div className="flex items-center gap-4 text-sm font-bold">
          <button type="button" className="text-[var(--ip-accent)] hover:underline" aria-expanded={searchOpen}
            onClick={() => { if (searchOpen) onSearch(''); setSearchOpen(o => !o) }}>
            {searchOpen ? 'Aramayı kapat' : 'Ara'}
          </button>
          {mode === 'feed' && (
            <button type="button" className="text-[var(--ip-accent)] hover:underline" aria-pressed={selecting}
              onClick={() => setSelecting(s => !s)}>
              {selecting ? 'Seçimi bitir' : 'Seç'}
            </button>
          )}
          <div role="group" aria-label="Görünüm" className="flex rounded-full bg-[var(--ip-chip)] p-0.5 text-xs">
            {(['feed', 'table'] as const).map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 ${mode === m ? 'bg-[var(--ip-panel)] shadow-sm' : 'text-[var(--ip-sub)]'}`}>
                {m === 'feed' ? 'Akış' : 'Tablo'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {searchOpen && (
        <label className="mb-2.5 flex h-11 items-center gap-2.5 rounded-full bg-[var(--ip-surface2)] px-4">
          <Search className="size-[18px] text-[var(--ip-sub)]" aria-hidden="true" />
          <input
            autoFocus
            type="search"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Mağaza, kategori, kişi, not ya da etiket ara"
            aria-label="İşlem ara"
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[var(--ip-sub)]"
          />
        </label>
      )}

      <div className="mb-1.5 flex flex-wrap gap-2" role="group" aria-label="Süzgeç">
        {FEED_CHIPS.map(c => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => onChip(c.id)} className={chip === c.id ? chipOn : chipOff}>
            {c.label}
          </button>
        ))}
        {weekLabel && (
          <button type="button" aria-pressed="true" onClick={onClearWeek} className={chipOn}>{weekLabel} ✕</button>
        )}
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)} className={filterCount ? chipOn : chipOff}>
          Diğer süzgeçler{filterCount ? ` · ${filterCount}` : ''}
        </button>
      </div>
      {filtersOpen && <div className="mt-2 mb-1 flex flex-wrap gap-2">{filtersSlot}</div>}

      {mode === 'table' ? (
        <div className="-mx-[22px] mt-3">{tableSlot}</div>
      ) : (
        <>
          {selecting && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-[var(--ip-surface2)] px-3 py-2 text-sm">
              <Checkbox checked={allSel} indeterminate={!allSel && eligible.some(id => selectedIds.has(id))}
                onChange={() => onSelectMany(eligible, !allSel)} disabled={!eligible.length} aria-label="Tümünü seç" />
              <span className="text-[var(--ip-sub)]">
                {selectedIds.size ? `${selectedIds.size} işlem seçili · alttaki çubuktan toplu düzenle` : 'Toplu düzenlemek için işlemleri seç'}
              </span>
            </div>
          )}
          {items.length ? items : (
            <div className="p-7 text-center text-[var(--ip-sub)]">Bu süzgece uyan işlem yok.</div>
          )}
          {ordered.length > limit && (
            <button type="button" onClick={() => setLimit(l => l + PAGE)}
              className="mt-2.5 h-[46px] w-full rounded-full bg-[var(--ip-surface2)] font-bold hover:brightness-95">
              Daha fazla göster · {ordered.length - limit} işlem kaldı
            </button>
          )}
        </>
      )}

      {openTx && (
        <TxDetailSheet tx={openTx} account={account} projected={projectedIds.has(openTx.id)} onClose={() => setOpenTx(null)} />
      )}
    </section>
  )
}

function FeedRow({
  tx, account, catName, catIcon, catColor, otherAccount, recipient, projected,
  selecting, selected, onToggle, onOpen,
}: {
  tx: Transaction
  account: Account
  catName?: string
  catIcon?: string
  catColor?: string
  otherAccount?: string
  recipient?: string
  projected: boolean
  selecting: boolean
  selected: boolean
  onToggle: (id: string) => void
  onOpen: (tx: Transaction) => void
}) {
  const isXfer   = tx.type === 'transfer'
  const incoming = isXfer && tx.toAccountId === account.id
  const isRefund = tx.type === 'expense' && tx.amount < 0
  const positive = tx.type === 'income' || isRefund || incoming
  const inst     = tx.isInstallment || !!tx.installGroupId
  const sub = isXfer
    ? `${incoming ? '←' : '→'} ${otherAccount ?? 'Transfer'}`
    : [catName ?? 'Kategorisiz', recipient].filter(Boolean).join(' · ')

  return (
    <div className={`flex items-center gap-2 rounded-2xl ${selected ? 'bg-[var(--ip-accent)]/10' : ''}`}>
      {selecting && !projected && (
        <span className="pl-1.5">
          <Checkbox checked={selected} onChange={() => onToggle(tx.id)} aria-label={`${tx.description} seç`} />
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(tx)}
        className={`flex min-w-0 flex-1 items-center gap-3.5 rounded-2xl px-1.5 py-2.5 text-left hover:bg-[var(--ip-surface2)] ${projected || tx.date.slice(0, 10) > today() ? 'opacity-75' : ''}`}
      >
        {isXfer ? (
          <span className="inline-flex size-11 flex-none items-center justify-center rounded-[14px] bg-[#64748b] text-white" aria-hidden="true">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
          </span>
        ) : (
          <CategoryIcon icon={catIcon ?? DEFAULT_ICON} color={catColor ?? '#94a3b8'} size={24} className="!size-11 !rounded-[14px]" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span className="truncate">{tx.description}</span>
            {inst && <Tag>{installmentLabel(tx)}</Tag>}
            {isRefund && <Tag tone="pos">İade</Tag>}
            {projected && <Tag tone="accent">Planlandı</Tag>}
            {awaitsApproval(tx) && <Tag tone="warn">Onay bekliyor</Tag>}
          </b>
          <span className="truncate text-[13px] text-[var(--ip-sub)]">{sub}</span>
        </span>
        <span className="flex flex-none flex-col items-end text-right">
          <b className={`font-bold whitespace-nowrap tabular-nums ${positive ? 'text-[var(--ip-pos)]' : ''}`}>
            {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(tx.amount), tx.currency)}
          </b>
          {inst && tx.installTotal ? (
            <span className="text-xs text-[var(--ip-sub)] tabular-nums">toplam {formatCurrency(Math.abs(tx.amount) * tx.installTotal, tx.currency)}</span>
          ) : null}
        </span>
      </button>
    </div>
  )
}

function Tag({ tone, children }: { tone?: 'pos' | 'accent' | 'warn'; children: ReactNode }) {
  const cls = tone === 'pos' ? 'bg-[var(--ip-pos)]/15 text-[var(--ip-pos)]'
    : tone === 'accent' ? 'bg-[var(--ip-accent)]/15 text-[var(--ip-accent)]'
    : tone === 'warn' ? 'bg-orange-500/15 text-orange-600'
    : 'bg-[var(--ip-chip)] text-[var(--ip-fg)]'
  return <span className={`inline-flex h-5 flex-none items-center rounded-full px-[7px] text-[11px] font-bold ${cls}`}>{children}</span>
}
