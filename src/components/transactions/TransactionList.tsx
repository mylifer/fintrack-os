'use client'

import { useMemo } from 'react'
import Link from 'next/link'
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

const PencilIcon = ({ size = 13 }: { size?: number }) => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const TrashIcon = ({ size = 13 }: { size?: number }) => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)

function DeleteConfirmDialog({
  tx,
  onDelete,
  compact,
}: {
  tx: Transaction
  onDelete: () => void
  compact?: boolean
}) {
  const btnCls = compact
    ? 'w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
    : 'w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button className={btnCls} title="Sil">
          <TrashIcon size={compact ? 12 : 13} />
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

// CSS grid template columns for table layout.
const TABLE_COLS = 'minmax(130px,1.4fr) minmax(96px,1fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(72px,0.85fr) minmax(84px,0.9fr) 76px'
const TABLE_MIN_W = 130 + 96 + 76 + 76 + 76 + 72 + 84 + 76 + 24

type MetaItem = { text: string; href?: string }

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
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const openModal  = useUIStore(s => s.openModal)
  const removeTx   = useTransactionStore(s => s.remove)
  const allTxs     = useTransactionStore(s => s.transactions)

  const grouped     = useMemo(() => groupByDate(transactions), [transactions])
  const sortedDates = useMemo(() => [...grouped.keys()].sort((a, b) => b.localeCompare(a)), [grouped])

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

  // ── TABLE layout ─────────────────────────────────────────────────────────
  if (layout === 'table') {
    return (
      <div style={{ minWidth: TABLE_MIN_W }}>

        {/* Sticky column headers */}
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          <div className="mx-3 grid" style={{ gridTemplateColumns: TABLE_COLS }}>
            {['Açıklama', 'Hesap', 'Alıcı', 'Aile Üyesi', 'Kategori', 'Miktar', 'Güncel Bakiye', ''].map((h, i) => (
              <div
                key={i}
                className={[
                  'py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 select-none',
                  i === 0 ? 'px-3' : i === 5 || i === 6 ? 'px-3 text-right' : 'px-2',
                ].join(' ')}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

        {/* Date group sections */}
        <div className="flex flex-col px-4 py-2">
          {sortedDates.map((date, dateIdx) => {
            const sorted = sortDay(grouped.get(date)!)
            return (
              <div key={date}>

                {/* Date separator */}
                <div className={`flex items-center gap-3 py-1 ${dateIdx > 0 ? 'mt-3' : 'mt-1'}`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none">
                    {formatDate(date, 'd MMM')} · {formatDate(date, 'EEEE')}
                  </span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>

                {/* Rows */}
                <div className="rounded-lg overflow-hidden border border-border/60 bg-card">
                  {sorted.map((tx, txIdx) => {
                    const cat         = categories.find(c => c.id === tx.categoryId)
                    const account     = accounts.find(a => a.id === tx.accountId)
                    const recipient   = tx.recipientId    ? people.find(p => p.id === tx.recipientId)    : null
                    const family      = tx.familyMemberId ? people.find(p => p.id === tx.familyMemberId) : null
                    const isIncome    = tx.type === 'income'
                    const isXfer      = tx.type === 'transfer'
                    const iconBg      = cat?.color ? `${cat.color}18` : isXfer ? '#00E5FF18' : 'rgba(255,255,255,0.04)'
                    const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
                    const iconIsText  = !cat?.icon && !!tx.icon
                    const balanceAfter = runningBalances.get(tx.id)
                    return (
                      <div
                        key={tx.id}
                        className={[
                          'group grid transition-colors hover:bg-accent/40',
                          txIdx > 0 ? 'border-t border-border/60' : '',
                        ].join(' ')}
                        style={{ gridTemplateColumns: TABLE_COLS }}
                      >
                        {/* Açıklama */}
                        <div className="px-3 py-2 flex items-center gap-2 min-w-0 overflow-hidden">
                          {recipient ? (
                            <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
                          ) : (
                            <div
                              className={[
                                'w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-sm',
                                iconIsText ? 'text-[10px] font-medium text-foreground/50' : 'text-[11px]',
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
                                <span className="ml-1 font-normal text-orange-500/80">
                                  ({tx.installIndex}/{tx.installTotal})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Hesap */}
                        <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
                          {account ? (
                            <Link href={`/accounts/${tx.accountId}`} className="flex items-center gap-1.5 min-w-0 group/link">
                              <AccountAvatar account={account} size="xs" className="flex-shrink-0" />
                              <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">{account.name}</span>
                            </Link>
                          ) : null}
                        </div>

                        {/* Alıcı */}
                        <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
                          {recipient ? (
                            <Link href={`/alicilar/${tx.recipientId}`} className="flex items-center gap-1.5 min-w-0 group/link">
                              <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
                              <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">
                                {recipient.name}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground/25">—</span>
                          )}
                        </div>

                        {/* Aile Üyesi */}
                        <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
                          {family ? (
                            <Link href={`/aile-uyeleri/${tx.familyMemberId}`} className="flex items-center gap-1.5 min-w-0 group/link">
                              <PersonAvatar person={family} size="xs" className="flex-shrink-0" />
                              <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">
                                {family.name}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground/25">—</span>
                          )}
                        </div>

                        {/* Kategori */}
                        <div className="px-2 py-2 flex items-center gap-1.5 min-w-0 overflow-hidden">
                          {cat ? (
                            <Link href={`/categories/${tx.categoryId}`} className="flex items-center gap-1.5 min-w-0 group/link">
                              <CategoryIcon icon={cat.icon} color={cat.color} size={10} className="flex-shrink-0" />
                              <span className="text-xs text-muted-foreground truncate min-w-0 group-hover/link:text-primary transition-colors">{cat.name}</span>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground/25">—</span>
                          )}
                        </div>

                        {/* Miktar */}
                        <div className="px-3 py-2 flex items-center justify-end">
                          <span className={[
                            'text-xs font-semibold tabular-nums',
                            isIncome ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
                          ].join(' ')}>
                            {isIncome ? '+' : isXfer ? '' : '−'}
                            {formatCurrency(tx.amount, tx.currency)}
                          </span>
                        </div>

                        {/* Güncel Bakiye */}
                        <div className="px-3 py-2 flex items-center justify-end">
                          {balanceAfter !== undefined ? (
                            <span className={[
                              'text-xs tabular-nums',
                              balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground/60',
                            ].join(' ')}>
                              {formatCurrency(balanceAfter, account?.currency)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/25">—</span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="px-2 py-2 flex items-center justify-end gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openModal('edit-transaction', { id: tx.id })}
                            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            title="Düzenle"
                          >
                            <PencilIcon size={12} />
                          </button>
                          <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── CARDS layout (compact minimal) ────────────────────────────────────────
  return (
    <div className="flex flex-col px-4 py-2">
      {sortedDates.map((date, dateIdx) => {
        const sorted = sortDay(grouped.get(date)!)

        return (
          <div key={date}>

            {/* Date separator */}
            <div className={`flex items-center gap-3 py-1 ${dateIdx > 0 ? 'mt-4' : 'mt-1'}`}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap select-none">
                {formatDate(date, 'd MMM')} · {formatDate(date, 'EEEE')}
              </span>
              <div className="flex-1 h-px bg-border/60" />
            </div>

            {/* Transaction rows */}
            {sorted.map(tx => {
              const cat       = categories.find(c => c.id === tx.categoryId)
              const account   = accounts.find(a => a.id === tx.accountId)
              const recipient = tx.recipientId    ? people.find(p => p.id === tx.recipientId)    : null
              const family    = tx.familyMemberId ? people.find(p => p.id === tx.familyMemberId) : null
              const isIncome  = tx.type === 'income'
              const isXfer    = tx.type === 'transfer'
              const iconBg    = cat?.color ? `${cat.color}18` : isXfer ? '#00E5FF15' : 'rgba(255,255,255,0.04)'
              const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
              const iconIsText  = !cat?.icon && !!tx.icon

              // Build meta items — each can have an href for navigation
              const metaItems: MetaItem[] = []
              if (showAccount && account) metaItems.push({ text: account.name, href: `/accounts/${tx.accountId}` })
              if (cat) metaItems.push({ text: cat.name, href: `/categories/${tx.categoryId}` })
              if (tx.isInstallment) metaItems.push({ text: `${tx.installIndex}/${tx.installTotal}` })
              if (recipient) metaItems.push({ text: recipient.name, href: `/alicilar/${tx.recipientId}` })
              if (family)    metaItems.push({ text: family.name,    href: `/aile-uyeleri/${tx.familyMemberId}` })

              const hasSubline = metaItems.length > 0

              return (
                <div
                  key={tx.id}
                  className="group flex items-center gap-2.5 px-2 py-[5px] rounded-lg hover:bg-accent/40 transition-colors"
                >
                  {/* Icon / Avatar */}
                  {recipient ? (
                    <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
                  ) : (
                    <div
                      className={[
                        'w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-sm',
                        iconIsText ? 'text-[10px] font-medium text-foreground/50' : 'text-[11px]',
                      ].join(' ')}
                      style={{ background: iconBg }}
                    >
                      {displayIcon}
                    </div>
                  )}

                  {/* Description + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate leading-snug">
                      {tx.description}
                    </div>
                    {hasSubline && (
                      <div className="text-[11px] text-muted-foreground/60 truncate leading-snug">
                        {metaItems.map((item, i) => (
                          <span key={i}>
                            {i > 0 && <span className="opacity-40"> · </span>}
                            {item.href ? (
                              <Link
                                href={item.href}
                                onClick={e => e.stopPropagation()}
                                className="hover:text-foreground transition-colors"
                              >
                                {item.text}
                              </Link>
                            ) : item.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Amount */}
                  <span className={[
                    'text-[13px] font-medium tabular-nums flex-shrink-0',
                    isIncome ? 'text-green-600' : isXfer ? 'text-foreground/50' : 'text-foreground',
                  ].join(' ')}>
                    {isIncome ? '+' : isXfer ? '' : '−'}{formatCurrency(tx.amount, tx.currency)}
                  </span>

                  {/* Actions — visible only on row hover */}
                  <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openModal('edit-transaction', { id: tx.id })}
                      className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Düzenle"
                    >
                      <PencilIcon size={12} />
                    </button>
                    <DeleteConfirmDialog tx={tx} onDelete={() => removeTx(tx.id)} compact />
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
