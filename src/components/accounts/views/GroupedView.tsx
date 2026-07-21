'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, TYPE_ORDER, isLiability, type AccountRow } from './shared'
import type { Account, AccountType } from '@/types'

/**
 * Görünüm 2 — Türe Göre Gruplu
 * Hesaplar türüne göre bölümlenir (Nakit, Vadesiz, … Kredi Kartı, Kredi) ve her
 * grup TRY-normalize alt toplamıyla gösterilir. Varlıklar üstte, borçlar altta.
 */
export function GroupedView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const groups = useMemo(() => {
    return TYPE_ORDER
      .map(type => ({
        type,
        rows: rows.filter(r => r.account.type === type),
      }))
      .filter(g => g.rows.length > 0)
      .map(g => ({
        ...g,
        subtotal: g.rows.reduce((s, r) => s + r.tryBalance, 0),
      }))
  }, [rows])

  return (
    <div className="space-y-6">
      {groups.map(({ type, rows: groupRows, subtotal }) => (
        <section key={type}>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[type]}
              <span className="ml-2 text-muted-foreground/60 font-normal normal-case">{groupRows.length}</span>
            </h2>
            <span className={`text-sm font-semibold tabular-nums ${isLiability(type as AccountType) || subtotal < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {isLiability(type as AccountType) && subtotal < 0 ? '−' : ''}
              <AnimatedNumber value={Math.abs(subtotal)} format={v => formatCurrency(v)} />
            </span>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {groupRows.map(({ account, available, income, expense, hasActivity }, i) => (
              <div
                key={account.id}
                className={`group flex items-center gap-3 px-4 h-14 transition-colors hover:bg-secondary/40 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <AccountAvatar account={account} size="sm" />
                <Link
                  href={`/accounts/${account.id}`}
                  className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate flex-1"
                >
                  {account.name}
                </Link>

                {hasActivity && (
                  <div className="hidden sm:flex items-center gap-2 text-xs font-medium">
                    {income > 0 && <span className="text-green-600">+<AnimatedNumber value={income} format={formatCompact} /></span>}
                    {expense > 0 && <span className="text-destructive">−<AnimatedNumber value={expense} format={formatCompact} /></span>}
                  </div>
                )}

                {account.type === 'credit_card' && account.creditLimit && (
                  <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
                    <AnimatedNumber value={available ?? 0} format={v => formatCompact(v, account.currency)} /> boşta
                  </span>
                )}

                <div className={`w-32 text-right text-sm font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
                </div>

                <button
                  onClick={() => onEdit(account)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-secondary"
                >
                  Düzenle
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
