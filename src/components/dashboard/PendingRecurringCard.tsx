'use client'

import Link from 'next/link'
import { useRecurringStore, useTransactionStore, useAccountStore, useCategoryStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

export function PendingRecurringCard() {
  const getDue          = useRecurringStore(s => s.getDue)
  const markGenerated   = useRecurringStore(s => s.markGenerated)
  const addTransaction  = useTransactionStore(s => s.add)
  const accounts        = useAccountStore(useShallow(s => s.accounts))
  const categories      = useCategoryStore(s => s.categories)

  const todayStr = today()
  const due = getDue(todayStr)

  const [generatingId, setGeneratingId] = useState<string | null>(null)

  if (due.length === 0) return null

  async function handleGenerate(id: string) {
    const r = due.find(x => x.id === id)
    if (!r || generatingId) return
    setGeneratingId(id)
    const now = new Date().toISOString()
    await addTransaction({
      id:            crypto.randomUUID(),
      type:          r.type,
      amount:        r.amount,
      currency:      r.currency,
      date:          r.nextDueDate,
      accountId:     r.accountId,
      toAccountId:   r.toAccountId,
      categoryId:    r.categoryId,
      description:   r.description,
      notes:         r.notes,
      isInstallment: false,
      familyMemberId: r.familyMemberId,
      recipientId:   r.recipientId,
      createdAt:     now,
      updatedAt:     now,
    })
    await markGenerated(id, todayStr)
    setGeneratingId(null)
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
          <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-amber font-semibold">
            Bekleyen Tekrarlayan — {due.length}
          </span>
        </div>
        <Link href="/recurring" className="text-[10px] text-muted-foreground hover:text-primary font-mono transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {due.slice(0, 5).map(r => {
            const category = categories.find(c => c.id === r.categoryId)
            const account  = accounts.find(a => a.id === r.accountId)
            const isLoading = generatingId === r.id

            return (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                {category ? (
                  <span className="text-lg flex-shrink-0">{category.icon}</span>
                ) : (
                  <span className="w-7 h-7 rounded flex items-center justify-center text-xs bg-secondary text-muted-foreground flex-shrink-0">↻</span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{r.name}</div>
                  {account && (
                    <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: account.color }} />
                      {account.name}
                    </div>
                  )}
                </div>

                <span className={`font-semibold tabular text-sm flex-shrink-0 ${r.type === 'income' ? 'text-ok' : 'text-destructive'}`}>
                  {r.type === 'income' ? '+' : '−'}{formatCurrency(r.amount)}
                </span>

                <button
                  onClick={() => handleGenerate(r.id)}
                  disabled={!!generatingId}
                  className="flex-shrink-0 px-3 py-1 text-[10px] font-semibold bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border transition-colors disabled:opacity-40"
                >
                  {isLoading ? '…' : 'Kaydet'}
                </button>
              </div>
            )
          })}
        </div>

        {due.length > 5 && (
          <div className="px-5 py-3 border-t border-border">
            <Link href="/recurring" className="text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors">
              +{due.length - 5} bekleyen daha →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
