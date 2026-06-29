'use client'

import { useMemo } from 'react'
import { AlertDialog } from 'radix-ui'
import { useCategoryStore, useAccountStore, useUIStore, usePeopleStore, useTransactionStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { groupByDate } from '@/lib/utils/calculations'
import { EmptyState } from '@/components/ui/EmptyState'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import type { Transaction, PersonRole } from '@/types'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'

const PencilIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const TrashIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)

function DeleteConfirmDialog({ tx, onDelete }: { tx: Transaction; onDelete: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Sil"
        >
          <TrashIcon />
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content className={[
          'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
          'w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-background p-6 shadow-xl',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        ].join(' ')}>
          <AlertDialog.Title className="text-base font-semibold text-foreground mb-1">
            İşlemi sil
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted-foreground mb-5">
            <span className="font-medium text-foreground">&ldquo;{tx.description}&rdquo;</span> işlemi kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </AlertDialog.Description>
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors">
                İptal
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                onClick={onDelete}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors"
              >
                Sil
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

const PERSON_BADGE: Record<PersonRole, { bg: string; color: string }> = {
  family_member: { bg: 'rgba(125,211,252,0.12)', color: '#7DD3FC' },
  recipient:     { bg: 'rgba(167,139,250,0.12)', color: '#A78BFA' },
}

// CSS grid template columns for table layout.
// All fr-based so every column shares available space proportionally;
// description gets 1.4fr (slightly more for icon+text), money columns get 0.9fr.
const TABLE_COLS = 'minmax(130px,1.4fr) minmax(96px,1fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(72px,0.85fr) minmax(84px,0.9fr) 76px'
// Minimum container width = sum of column minimums + 24px (mx-3 margins on sticky header)
const TABLE_MIN_W = 130 + 96 + 76 + 76 + 76 + 72 + 84 + 76 + 24 // = 710px

interface Props {
  transactions: Transaction[]
  layout?: 'cards' | 'table'
  showAccount?: boolean
  emptyTitle?: string
  emptyDescription?: string
  onPersonClick?: (role: PersonRole, id: string) => void
}

export function TransactionList({
  transactions,
  layout = 'cards',
  showAccount = true,
  emptyTitle = 'İşlem bulunamadı',
  emptyDescription = 'Filtrelerinizi değiştirin veya yeni işlem ekleyin.',
  onPersonClick,
}: Props) {
  const categories  = useCategoryStore(s => s.categories)
  const accounts    = useAccountStore(s => s.accounts)
  const people      = usePeopleStore(s => s.people)
  const openModal   = useUIStore(s => s.openModal)
  const removeTx    = useTransactionStore(s => s.remove)
  const allTxs      = useTransactionStore(s => s.transactions)

  const grouped     = useMemo(() => groupByDate(transactions), [transactions])
  const sortedDates = useMemo(() => [...grouped.keys()].sort((a, b) => b.localeCompare(a)), [grouped])

  // Running balance per transaction (table layout only)
  const runningBalances = useMemo(() => {
    if (layout !== 'table') return new Map<string, number>()
    const map = new Map<string, number>()
    const neededIds = new Set(transactions.map(t => t.accountId))

    for (const accountId of neededIds) {
      const account = accounts.find(a => a.id === accountId)
      if (!account) continue

      const accountTxs = allTxs
        .filter(t => t.accountId === accountId || t.toAccountId === accountId)
        .sort((a, b) =>
          (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')),
        )

      let balance = account.initialBalance
      for (const tx of accountTxs) {
        if (tx.type === 'income'   && tx.accountId === accountId) balance += tx.amount
        if (tx.type === 'expense'  && tx.accountId === accountId) balance -= tx.amount
        if (tx.type === 'transfer') {
          if (tx.accountId   === accountId) balance -= tx.amount
          if (tx.toAccountId === accountId) balance += tx.amount
        }
        if (tx.accountId === accountId) map.set(tx.id, balance)
      }
    }
    return map
  }, [layout, transactions, allTxs, accounts])

  if (sortedDates.length === 0) {
    return <EmptyState icon="↕" title={emptyTitle} description={emptyDescription} />
  }

  function sortDay(dayTxs: Transaction[]) {
    const investRank = (tx: Transaction) => {
      if (!tx.icon) return 10
      if (tx.description.includes('Alım')) return 0
      if (tx.description.includes('Kâr') || tx.description.includes('Zarar')) return 6
      return 5
    }
    return [...dayTxs].sort((a, b) => {
      const ca = a.createdAt ?? '', cb = b.createdAt ?? ''
      if (ca !== cb) return cb.localeCompare(ca)
      const ra = investRank(a), rb = investRank(b)
      if (ra !== rb) return ra - rb
      return (a.installIndex ?? 0) - (b.installIndex ?? 0)
    })
  }

  // ── TABLE layout ───────────────────────────────────────────────────────────
  if (layout === 'table') {
    return (
      <div style={{ minWidth: TABLE_MIN_W }}>

        {/* Sticky column headers — mx-3 matches card container padding so columns align */}
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          <div className="mx-3 grid" style={{ gridTemplateColumns: TABLE_COLS }}>
            {['Açıklama', 'Hesap', 'Alıcı', 'Aile Üyesi', 'Kategori', 'Miktar', 'Güncel Bakiye', ''].map((h, i) => (
              <div
                key={i}
                className={[
                  'py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground select-none',
                  i === 0 ? 'px-3' : i === 5 || i === 6 ? 'px-3 text-right' : 'px-2',
                ].join(' ')}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

        {/* Date group cards */}
        <div className="flex flex-col gap-2 px-6 py-2">
          {sortedDates.map(date => {
            const sorted = sortDay(grouped.get(date)!)
            return (
              <div key={date} className="rounded-xl overflow-hidden border border-border bg-card">

                {/* Date header */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-background border-b-2 border-border">
                  <div
                    className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(14,165,233,0.12)' }}
                  >
                    <span className="text-sm font-semibold tabular-nums leading-none text-primary">
                      {formatDate(date, 'd')}
                    </span>
                  </div>
                  <div className="leading-none">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {formatDate(date, 'MMMM yyyy')}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize mt-[3px]">
                      {formatDate(date, 'EEEE')}
                    </div>
                  </div>
                </div>

                {/* Transaction rows */}
                {sorted.map(tx => {
                  const cat         = categories.find(c => c.id === tx.categoryId)
                  const account     = accounts.find(a => a.id === tx.accountId)
                  const recipient   = tx.recipientId    ? people.find(p => p.id === tx.recipientId)    : null
                  const family      = tx.familyMemberId ? people.find(p => p.id === tx.familyMemberId) : null
                  const isIncome    = tx.type === 'income'
                  const isXfer      = tx.type === 'transfer'
                  const iconBg      = cat?.color ? `${cat.color}20` : isXfer ? '#00E5FF20' : 'rgba(255,255,255,0.04)'
                  const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
                  const iconIsText  = !cat?.icon && !!tx.icon
                  const balanceAfter = runningBalances.get(tx.id)
                  return (
                    <div
                      key={tx.id}
                      className="grid border-t border-border transition-colors hover:bg-accent"
                      style={{ gridTemplateColumns: TABLE_COLS }}
                    >
                      {/* Açıklama — single line, installment number inlined */}
                      <div className="px-3 py-3.5 flex items-center gap-2 min-w-0 overflow-hidden">
                        {recipient ? (
                          <PersonAvatar person={recipient} size="sm" className="flex-shrink-0" />
                        ) : (
                          <div
                            className={[
                              'w-6 h-6 flex-shrink-0 flex items-center justify-center rounded',
                              iconIsText ? 'text-xs font-medium text-foreground/50' : 'text-xs',
                            ].join(' ')}
                            style={{ background: iconBg }}
                          >
                            {displayIcon}
                          </div>
                        )}
                        <div className="min-w-0 overflow-hidden">
                          <div className="text-xs font-medium text-foreground truncate leading-none">
                            {tx.description}
                            {tx.isInstallment && (
                              <span className="ml-1 text-xs font-normal text-orange-500/80">
                                ({tx.installIndex}/{tx.installTotal})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Hesap */}
                      <div className="px-2 py-3.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {account && (
                          <>
                            <AccountAvatar account={account} size="xs" className="flex-shrink-0" />
                            <span className="text-xs text-muted-foreground truncate min-w-0">{account.name}</span>
                          </>
                        )}
                      </div>

                      {/* Alıcı */}
                      <div className="px-2 py-3.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {recipient ? (
                          <>
                            <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => onPersonClick?.('recipient', tx.recipientId!)}
                              className="text-xs text-muted-foreground truncate min-w-0 hover:text-primary transition-colors text-left"
                            >
                              {recipient.name}
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/25">—</span>
                        )}
                      </div>

                      {/* Aile Üyesi */}
                      <div className="px-2 py-3.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {family ? (
                          <>
                            <PersonAvatar person={family} size="xs" className="flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => onPersonClick?.('family_member', tx.familyMemberId!)}
                              className="text-xs text-muted-foreground truncate min-w-0 hover:text-primary transition-colors text-left"
                            >
                              {family.name}
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/25">—</span>
                        )}
                      </div>

                      {/* Kategori */}
                      <div className="px-2 py-3.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {cat ? (
                          <>
                            <CategoryIcon icon={cat.icon} color={cat.color} size={11} className="flex-shrink-0" />
                            <span className="text-xs text-muted-foreground truncate min-w-0">{cat.name}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/25">—</span>
                        )}
                      </div>

                      {/* Miktar */}
                      <div className="px-3 py-3.5 flex items-center justify-end">
                        <span
                          className={[
                            'text-sm font-medium tabular-nums',
                            isIncome ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
                          ].join(' ')}
                        >
                          {isIncome ? '+' : isXfer ? '' : '−'}
                          {formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </div>

                      {/* Güncel Bakiye */}
                      <div className="px-3 py-3.5 flex items-center justify-end">
                        {balanceAfter !== undefined ? (
                          <span
                            className={[
                              'text-xs font-medium tabular-nums',
                              balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground/70',
                            ].join(' ')}
                          >
                            {formatCurrency(balanceAfter, account?.currency)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/25">—</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="px-2 py-3.5 flex items-center justify-end gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => openModal('edit-transaction', { id: tx.id })}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Düzenle"
                        >
                          <PencilIcon />
                        </button>
                        <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── CARDS layout (original) ────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2 px-6 py-3">
      {sortedDates.map(date => {
        const sorted = sortDay(grouped.get(date)!)

        return (
          <div key={date} className="rounded-xl overflow-hidden border border-border bg-card">

            {/* Date header */}
            <div className="flex items-center gap-2.5 px-4 py-2 bg-background border-b border-border">
              <span className="text-xl font-semibold tabular-nums leading-none text-muted-foreground w-7 text-center flex-shrink-0">
                {formatDate(date, 'd')}
              </span>
              <div className="leading-none">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {formatDate(date, 'MMMM yyyy')}
                </div>
                <div className="text-xs text-foreground/30 capitalize mt-[3px]">
                  {formatDate(date, 'EEEE')}
                </div>
              </div>
            </div>

            {/* Transaction rows */}
            {sorted.map((tx, txIdx) => {
              const cat       = categories.find(c => c.id === tx.categoryId)
              const account   = accounts.find(a => a.id === tx.accountId)
              const recipient = tx.recipientId ? people.find(p => p.id === tx.recipientId) : null
              const isIncome  = tx.type === 'income'
              const isXfer    = tx.type === 'transfer'
              const iconBg    = cat?.color ? `${cat.color}20` : isXfer ? '#00E5FF20' : 'rgba(255,255,255,0.04)'
              const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
              const iconIsText  = !cat?.icon && !!tx.icon

              return (
                <div
                  key={tx.id}
                  className={[
                    'flex items-center gap-3 px-4 py-3.5',
                    'hover:bg-accent transition-colors',
                    txIdx > 0 ? 'border-t border-border' : '',
                  ].join(' ')}
                >
                  {/* Icon */}
                  {recipient ? (
                    <PersonAvatar person={recipient} size="sm" />
                  ) : (
                    <div
                      className={[
                        'w-7 h-7 flex-shrink-0 flex items-center justify-center',
                        iconIsText ? 'text-xs font-medium text-foreground/50' : 'text-sm',
                      ].join(' ')}
                      style={{ background: iconBg }}
                    >
                      {displayIcon}
                    </div>
                  )}

                  {/* Description + sub */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate leading-tight">
                      {tx.description}
                    </div>
                    <div className="text-xs text-muted-foreground truncate leading-tight mt-[2px]">
                      {showAccount && account
                        ? account.name
                        : tx.isInstallment
                          ? `Taksit ${tx.installIndex}/${tx.installTotal}`
                          : null}
                      {tx.isInstallment && showAccount && account && (
                        <span className="text-orange-500 ml-1">
                          · Taksit {tx.installIndex}/{tx.installTotal}
                        </span>
                      )}
                    </div>
                    {/* Person badges */}
                    {(tx.familyMemberId || tx.recipientId) && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(['family_member', 'recipient'] as PersonRole[]).map(role => {
                          const pid = role === 'family_member' ? tx.familyMemberId : tx.recipientId
                          if (!pid) return null
                          const person = people.find(p => p.id === pid)
                          if (!person) return null
                          const style = PERSON_BADGE[role]
                          return (
                            <button
                              key={role}
                              type="button"
                              onClick={e => { e.stopPropagation(); onPersonClick?.(role, pid) }}
                              className={[
                                'inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-semibold rounded-full leading-none',
                                onPersonClick ? 'cursor-pointer hover:opacity-70 transition-opacity' : 'cursor-default',
                              ].join(' ')}
                              style={{ background: style.bg, color: style.color }}
                            >
                              {person.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Category badge */}
                  <div className="hidden lg:flex w-[88px] flex-shrink-0 justify-start">
                    {cat && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold truncate max-w-full"
                        style={{
                          background: cat.color ? `${cat.color}20` : 'rgba(255,255,255,0.06)',
                          color:      cat.color ?? '#7DD3FC',
                        }}
                      >
                        {cat.name}
                      </span>
                    )}
                  </div>

                  {/* Amount */}
                  <span
                    className={[
                      'w-[104px] flex-shrink-0 text-right text-sm font-medium tabular-nums',
                      isIncome ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
                    ].join(' ')}
                  >
                    {isIncome ? '+' : isXfer ? '' : '−'}
                    {formatCurrency(tx.amount, tx.currency)}
                  </span>

                  {/* Row actions */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => openModal('edit-transaction', { id: tx.id })}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Düzenle"
                    >
                      <PencilIcon />
                    </button>
                    <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} />
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
