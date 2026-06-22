'use client'

import { useMemo, useEffect } from 'react'
import { useTransactionStore } from '@/store'
import { TransactionList } from '@/components/transactions/TransactionList'
import type { Person } from '@/types'

interface Props {
  person: Person | null
  onClose: () => void
}

export function PersonTransactionsOverlay({ person, onClose }: Props) {
  const transactions = useTransactionStore(s => s.transactions)

  const filtered = useMemo(() => {
    if (!person) return []
    return transactions.filter(t =>
      person.role === 'family_member'
        ? t.familyMemberId === person.id
        : t.recipientId === person.id
    )
  }, [transactions, person])

  useEffect(() => {
    if (!person) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [person, onClose])

  if (!person) return null

  const roleLabel = person.role === 'family_member' ? 'Aile Üyesi' : 'Alıcı'

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer — slides in from right */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-surface shadow-2xl flex flex-col border-l border-line">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-ink">{person.name}</h2>
              <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-white/[0.08] text-muted rounded">
                {roleLabel}
              </span>
            </div>
            <p className="text-[10px] text-muted mt-0.5">
              {filtered.length > 0 ? `${filtered.length} işlem` : 'Henüz işlem yok'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-white/[0.08] transition-colors text-lg leading-none"
            aria-label="Kapat"
          >
            ×
          </button>
        </div>

        {/* Transaction list */}
        <div className="flex-1 overflow-y-auto">
          <TransactionList
            transactions={filtered}
            showAccount
            emptyTitle="İşlem bulunamadı"
            emptyDescription={`${person.name} için henüz işlem eklenmemiş.`}
          />
        </div>
      </div>
    </div>
  )
}
