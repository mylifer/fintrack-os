'use client'

import { useMemo, useState } from 'react'
import { useCategoryStore, useAccountStore, useUIStore, usePeopleStore, useTransactionStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { groupByDate } from '@/lib/utils/calculations'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Transaction, PersonRole } from '@/types'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'

const PERSON_BADGE: Record<PersonRole, { bg: string; color: string }> = {
  family_member: { bg: 'rgba(125,211,252,0.12)', color: '#7DD3FC' },
  recipient:     { bg: 'rgba(167,139,250,0.12)', color: '#A78BFA' },
}

// CSS grid template columns for table layout.
// All fr-based so every column shares available space proportionally;
// description gets 1.4fr (slightly more for icon+text), money columns get 0.9fr.
const TABLE_COLS = 'minmax(130px,1.4fr) minmax(96px,1fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(76px,0.85fr) minmax(72px,0.85fr) minmax(84px,0.9fr) 52px'
// Minimum container width = sum of column minimums + 24px (mx-3 margins on sticky header)
const TABLE_MIN_W = 130 + 96 + 76 + 76 + 76 + 72 + 84 + 52 + 24 // = 686px

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

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

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
        <div className="sticky top-0 z-10 bg-ground border-b border-line">
          <div className="mx-3 grid" style={{ gridTemplateColumns: TABLE_COLS }}>
            {['Açıklama', 'Hesap', 'Alıcı', 'Aile Üyesi', 'Kategori', 'Miktar', 'Güncel Bakiye', ''].map((h, i) => (
              <div
                key={i}
                className={[
                  'py-2 text-[9px] font-bold uppercase tracking-widest text-muted/50 select-none',
                  i === 0 ? 'px-3' : i === 5 || i === 6 ? 'px-3 text-right' : 'px-2',
                ].join(' ')}
              >
                {h}
              </div>
            ))}
          </div>
        </div>

        {/* Date group cards */}
        <div className="flex flex-col gap-2 px-3 py-2">
          {sortedDates.map(date => {
            const sorted = sortDay(grouped.get(date)!)
            return (
              <div key={date} className="rounded-xl overflow-hidden border border-line bg-surface">

                {/* Date header — same style as cards layout */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-ground border-b-2 border-line">
                  <div
                    className="w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center"
                    style={{ background: 'rgba(14,165,233,0.12)' }}
                  >
                    <span className="text-[15px] font-black tabular leading-none text-accent">
                      {formatDate(date, 'd')}
                    </span>
                  </div>
                  <div className="leading-none">
                    <div className="text-[12px] font-bold text-ink/80 tracking-wide">
                      {formatDate(date, 'MMMM yyyy')}
                    </div>
                    <div className="text-[10px] text-muted capitalize mt-[3px]">
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
                  const iconBg      = cat?.color ? `${cat.color}20` : isXfer ? '#0EA5E920' : 'rgba(255,255,255,0.04)'
                  const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
                  const iconIsText  = !cat?.icon && !!tx.icon
                  const balanceAfter = runningBalances.get(tx.id)
                  const isConfirming = confirmDeleteId === tx.id

                  return (
                    <div
                      key={tx.id}
                      className={[
                        'group grid border-t border-line transition-colors',
                        isConfirming ? 'bg-danger/5' : 'hover:bg-white/[0.03]',
                      ].join(' ')}
                      style={{ gridTemplateColumns: TABLE_COLS }}
                    >
                      {/* Açıklama — single line, installment number inlined */}
                      <div className="px-3 py-2.5 flex items-center gap-2 min-w-0 overflow-hidden">
                        {recipient ? (
                          <PersonAvatar person={recipient} size="sm" className="flex-shrink-0" />
                        ) : (
                          <div
                            className={[
                              'w-6 h-6 flex-shrink-0 flex items-center justify-center rounded',
                              iconIsText ? 'text-[10px] font-bold text-ink/50' : 'text-xs',
                            ].join(' ')}
                            style={{ background: iconBg }}
                          >
                            {displayIcon}
                          </div>
                        )}
                        <div className="min-w-0 overflow-hidden">
                          <div className="text-[12px] font-medium text-ink truncate leading-none">
                            {tx.description}
                            {tx.isInstallment && (
                              <span className="ml-1 text-[10px] font-normal text-amber/80">
                                ({tx.installIndex}/{tx.installTotal})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Hesap */}
                      <div className="px-2 py-2.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {account && (
                          <>
                            <AccountAvatar account={account} size="xs" className="flex-shrink-0" />
                            <span className="text-[11px] text-muted truncate min-w-0">{account.name}</span>
                          </>
                        )}
                      </div>

                      {/* Alıcı */}
                      <div className="px-2 py-2.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {recipient ? (
                          <>
                            <PersonAvatar person={recipient} size="xs" className="flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => onPersonClick?.('recipient', tx.recipientId!)}
                              className="text-[11px] text-muted truncate min-w-0 hover:text-accent transition-colors text-left"
                            >
                              {recipient.name}
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted/25">—</span>
                        )}
                      </div>

                      {/* Aile Üyesi */}
                      <div className="px-2 py-2.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {family ? (
                          <>
                            <PersonAvatar person={family} size="xs" className="flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => onPersonClick?.('family_member', tx.familyMemberId!)}
                              className="text-[11px] text-muted truncate min-w-0 hover:text-accent transition-colors text-left"
                            >
                              {family.name}
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted/25">—</span>
                        )}
                      </div>

                      {/* Kategori */}
                      <div className="px-2 py-2.5 flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {cat ? (
                          <>
                            <span className="text-xs leading-none flex-shrink-0">{cat.icon}</span>
                            <span className="text-[11px] text-muted truncate min-w-0">{cat.name}</span>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted/25">—</span>
                        )}
                      </div>

                      {/* Miktar */}
                      <div className="px-3 py-2.5 flex items-center justify-end">
                        <span
                          className={[
                            'text-[13px] font-semibold tabular',
                            isIncome ? 'text-ok' : isXfer ? 'text-ink/50' : 'text-ink',
                          ].join(' ')}
                        >
                          {isIncome ? '+' : isXfer ? '' : '−'}
                          {formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </div>

                      {/* Güncel Bakiye */}
                      <div className="px-3 py-2.5 flex items-center justify-end">
                        {balanceAfter !== undefined ? (
                          <span
                            className={[
                              'text-[11px] font-medium tabular',
                              balanceAfter < 0 ? 'text-danger' : 'text-muted/70',
                            ].join(' ')}
                          >
                            {formatCurrency(balanceAfter, account?.currency)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted/25">—</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="px-2 py-2.5 flex items-center justify-end gap-0.5 flex-shrink-0">
                        {isConfirming ? (
                          <>
                            <button
                              onClick={() => { removeTx(tx.id); setConfirmDeleteId(null) }}
                              className="w-6 h-6 flex items-center justify-center text-[12px] font-bold text-ok hover:bg-white/[0.08] rounded transition-colors"
                              title="Evet, sil"
                            >✓</button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="w-6 h-6 flex items-center justify-center text-[12px] font-bold text-muted hover:bg-white/[0.08] rounded transition-colors"
                              title="İptal"
                            >✕</button>
                          </>
                        ) : (
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                            <button
                              onClick={() => openModal('edit-transaction', { id: tx.id })}
                              className="w-6 h-6 flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] transition-colors text-sm rounded"
                              title="Düzenle"
                            >⋯</button>
                            <button
                              onClick={() => setConfirmDeleteId(tx.id)}
                              className="w-6 h-6 flex items-center justify-center text-muted hover:text-danger hover:bg-white/[0.08] transition-colors text-sm rounded"
                              title="Sil"
                            >×</button>
                          </div>
                        )}
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
    <div className="flex flex-col gap-2 p-3">
      {sortedDates.map(date => {
        const sorted = sortDay(grouped.get(date)!)

        return (
          <div key={date} className="rounded-xl overflow-hidden border border-line bg-surface">

            {/* Date header */}
            <div className="flex items-center gap-2.5 px-4 py-2 bg-ground border-b border-line">
              <span className="text-[20px] font-black tabular leading-none text-muted w-7 text-center flex-shrink-0">
                {formatDate(date, 'd')}
              </span>
              <div className="leading-none">
                <div className="text-[11px] font-semibold text-ink/50">
                  {formatDate(date, 'MMMM yyyy')}
                </div>
                <div className="text-[10px] text-ink/30 capitalize mt-[3px]">
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
              const iconBg    = cat?.color ? `${cat.color}20` : isXfer ? '#0EA5E920' : 'rgba(255,255,255,0.04)'
              const displayIcon = cat?.icon ?? tx.icon ?? (isXfer ? '↔' : '·')
              const iconIsText  = !cat?.icon && !!tx.icon

              return (
                <div
                  key={tx.id}
                  className={[
                    'group flex items-center gap-3 px-4 py-2.5',
                    'hover:bg-white/[0.03] transition-colors',
                    txIdx > 0 ? 'border-t border-line' : '',
                  ].join(' ')}
                >
                  {/* Icon */}
                  {recipient ? (
                    <PersonAvatar person={recipient} size="sm" />
                  ) : (
                    <div
                      className={[
                        'w-7 h-7 flex-shrink-0 flex items-center justify-center',
                        iconIsText ? 'text-[11px] font-bold text-ink/50' : 'text-sm',
                      ].join(' ')}
                      style={{ background: iconBg }}
                    >
                      {displayIcon}
                    </div>
                  )}

                  {/* Description + sub */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate leading-tight">
                      {tx.description}
                    </div>
                    <div className="text-[11px] text-muted truncate leading-tight mt-[2px]">
                      {showAccount && account
                        ? account.name
                        : tx.isInstallment
                          ? `Taksit ${tx.installIndex}/${tx.installTotal}`
                          : null}
                      {tx.isInstallment && showAccount && account && (
                        <span className="text-amber ml-1">
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
                                'inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none',
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
                        className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide truncate max-w-full"
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
                      'w-[104px] flex-shrink-0 text-right text-[13px] font-semibold tabular',
                      isIncome ? 'text-ok' : isXfer ? 'text-ink/50' : 'text-ink',
                    ].join(' ')}
                  >
                    {isIncome ? '+' : isXfer ? '' : '−'}
                    {formatCurrency(tx.amount, tx.currency)}
                  </span>

                  {/* Row actions */}
                  {confirmDeleteId === tx.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[11px] text-danger font-semibold mr-0.5">Sil?</span>
                      <button
                        onClick={() => { removeTx(tx.id); setConfirmDeleteId(null) }}
                        className="w-6 h-6 flex items-center justify-center text-[11px] font-bold text-ok hover:bg-white/[0.08] rounded transition-colors"
                        title="Evet, sil"
                      >✓</button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="w-6 h-6 flex items-center justify-center text-[11px] font-bold text-muted hover:bg-white/[0.08] rounded transition-colors"
                        title="İptal"
                      >✕</button>
                    </div>
                  ) : (
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
                      <button
                        onClick={() => openModal('edit-transaction', { id: tx.id })}
                        className="w-6 h-6 flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] transition-colors text-sm rounded"
                        title="Düzenle"
                      >⋯</button>
                      <button
                        onClick={() => setConfirmDeleteId(tx.id)}
                        className="w-6 h-6 flex items-center justify-center text-muted hover:text-danger hover:bg-white/[0.08] transition-colors text-sm rounded"
                        title="Sil"
                      >×</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
