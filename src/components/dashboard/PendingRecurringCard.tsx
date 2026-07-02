'use client'

import Link from 'next/link'
import { useRecurringStore, useTransactionStore, useAccountStore, useCategoryStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { CategoryIcon } from '@/components/categories/CategoryIcon'

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
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-medium text-amber-400">
            Bekleyen Tekrarlayan — {due.length}
          </span>
        </div>
        <Link href="/recurring" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        <div className="divide-y divide-border/50">
          {due.slice(0, 5).map(r => {
            const category = categories.find(c => c.id === r.categoryId)
            const account  = accounts.find(a => a.id === r.accountId)
            const isLoading = generatingId === r.id

            return (
              <div key={r.id} className="flex items-center gap-3 px-6 py-3.5">
                {category ? (
                  <CategoryIcon icon={category.icon} color={category.color} size={18} />
                ) : (
                  <span className="w-[28px] h-[28px] rounded-xl flex items-center justify-center text-sm bg-secondary text-muted-foreground flex-shrink-0">↻</span>
                )}

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{r.name}</div>
                  {account && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: account.color }} />
                      {account.name}
                    </div>
                  )}
                </div>

                <span className={`font-medium tabular-nums text-sm flex-shrink-0 ${r.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                  {r.type === 'income' ? '+' : '−'}{formatCurrency(r.amount)}
                </span>

                <button
                  onClick={() => handleGenerate(r.id)}
                  disabled={!!generatingId}
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 rounded-xl border border-border/50 transition-colors disabled:opacity-40"
                >
                  {isLoading ? '…' : 'Kaydet'}
                </button>
              </div>
            )
          })}
        </div>

        {due.length > 5 && (
          <div className="px-6 py-3.5 border-t border-border/50">
            <Link href="/recurring" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              +{due.length - 5} bekleyen daha →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
