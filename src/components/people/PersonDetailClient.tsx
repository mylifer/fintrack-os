'use client'

import { useMemo } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { usePeopleStore, useTransactionStore } from '@/store'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { TransactionList } from '@/components/transactions/TransactionList'
import { formatCurrency } from '@/lib/utils/currency'
import type { PersonRole } from '@/types'

interface Props {
  id: string
  role: PersonRole
  backHref: string
  backLabel: string
}

export default function PersonDetailClient({ id, role, backHref, backLabel }: Props) {
  const router      = useRouter()
  const people      = usePeopleStore(s => s.people)
  const peopleReady = usePeopleStore(s => s.ready)
  const transactions = useTransactionStore(s => s.transactions)
  const txsReady    = useTransactionStore(s => s.ready)

  const person = people.find(p => p.id === id && p.role === role)

  const filteredTxs = useMemo(
    () => transactions.filter(t =>
      role === 'family_member' ? t.familyMemberId === id : t.recipientId === id,
    ),
    [transactions, id, role],
  )

  const totalIncome  = filteredTxs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const totalExpense = filteredTxs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  if (!peopleReady || !txsReady) return null
  if (!person) return notFound()

  return (
    <>
      {/* Back header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0">
        <button
          onClick={() => router.push(backHref)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          {backLabel}
        </button>
      </div>

      {/* Person summary */}
      <div className="px-6 py-5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <PersonAvatar person={person} size="md" />
          <div>
            <div className="text-base font-semibold text-foreground">{person.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {role === 'family_member' ? 'Aile Üyesi' : 'Alıcı'}
            </div>
          </div>
        </div>

        <div className="flex gap-6 pt-4 border-t border-border">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gelir</div>
            <div className="text-sm font-medium tabular-nums text-green-600">+{formatCurrency(totalIncome)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gider</div>
            <div className="text-sm font-medium tabular-nums text-destructive">−{formatCurrency(totalExpense)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">İşlem</div>
            <div className="text-sm font-medium tabular-nums text-foreground">{filteredTxs.length}</div>
          </div>
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={filteredTxs}
          showAccount
          emptyTitle="İşlem bulunamadı"
          emptyDescription={`${person.name} için henüz işlem eklenmemiş.`}
        />
      </div>
    </>
  )
}
