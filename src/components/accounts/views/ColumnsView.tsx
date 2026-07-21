'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account, AccountType } from '@/types'

// Varlık sınıfına göre sütunlar
const COLUMNS: { key: string; label: string; types: AccountType[]; liability?: boolean }[] = [
  { key: 'liquid',     label: 'Nakit & Mevduat', types: ['cash', 'checking', 'savings'] },
  { key: 'investment', label: 'Yatırım',          types: ['investment'] },
  { key: 'debt',       label: 'Kredi & Kart',     types: ['credit_card', 'loan'], liability: true },
]

/**
 * Görünüm D — Sütunlu (Kanban)
 * Hesaplar varlık sınıfına göre üç sütuna dağıtılır; her sütun başlığında
 * hesap sayısı + TRY-normalize alt toplam. Paranın "nerede durduğu" zihinsel
 * modeli için ideal.
 */
export function ColumnsView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const columns = useMemo(() =>
    COLUMNS.map(col => {
      const colRows = rows.filter(r => col.types.includes(r.account.type))
      const subtotal = colRows.reduce((s, r) => s + r.tryBalance, 0)
      return { ...col, rows: colRows, subtotal }
    }).filter(c => c.rows.length > 0),
  [rows])

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
      {columns.map(col => (
        <div key={col.key} className="rounded-xl border border-border bg-secondary/30 p-3">
          <div className="flex items-baseline justify-between px-1 mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {col.label}
              <span className="ml-1.5 text-muted-foreground/60 font-normal">{col.rows.length}</span>
            </h2>
            <span className={`text-sm font-semibold tabular-nums ${col.liability || col.subtotal < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {(col.liability || col.subtotal < 0) && col.subtotal !== 0 ? '−' : ''}
              <AnimatedNumber value={Math.abs(col.subtotal)} format={v => formatCompact(v)} />
            </span>
          </div>

          <div className="space-y-2">
            {col.rows.map(({ account, available, usedPct, income, expense, hasActivity }) => {
              const isCredit = account.type === 'credit_card' && !!account.creditLimit
              return (
                <div key={account.id} className="group rounded-lg border border-border bg-card p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AccountAvatar account={account} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/accounts/${account.id}`} className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate block">
                          {account.name}
                        </Link>
                        <span className="text-[11px] text-muted-foreground">{TYPE_LABELS[account.type]}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => onEdit(account)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-secondary flex-shrink-0"
                    >
                      Düzenle
                    </button>
                  </div>

                  <div className={`text-base font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                    <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
                  </div>

                  {isCredit ? (
                    <div className="mt-2">
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span><AnimatedNumber value={available ?? 0} format={v => formatCompact(v, account.currency)} /> boşta</span>
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${usedPct > 80 ? 'bg-destructive' : usedPct > 60 ? 'bg-orange-500' : 'bg-green-600'}`} style={{ width: `${Math.min(usedPct, 100)}%` }} />
                      </div>
                    </div>
                  ) : hasActivity ? (
                    <div className="mt-1.5 flex items-center gap-3 text-xs font-medium">
                      {income > 0 && <span className="text-green-600">+<AnimatedNumber value={income} format={formatCompact} /></span>}
                      {expense > 0 && <span className="text-destructive">−<AnimatedNumber value={expense} format={formatCompact} /></span>}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
