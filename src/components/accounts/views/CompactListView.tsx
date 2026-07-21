'use client'

import Link from 'next/link'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm 1 — Kompakt Liste
 * Tek satır/hesap; hızlı tarama için yoğun. Bakiye sağa hizalı, dönem akışı ve
 * kredi kartı limit çubuğu satır içinde. Çok hesaplı kullanıcı için ideal.
 */
export function CompactListView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {rows.map(({ account, available, usedPct, income, expense, hasActivity }, i) => (
        <div
          key={account.id}
          className={`group flex items-center gap-3 px-4 h-16 transition-colors hover:bg-secondary/40 ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <AccountAvatar account={account} size="sm" />

          <div className="min-w-0 flex-1">
            <Link
              href={`/accounts/${account.id}`}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate block"
            >
              {account.name}
            </Link>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{TYPE_LABELS[account.type]}</span>
              {hasActivity && (
                <>
                  <span className="opacity-40">·</span>
                  {income > 0 && <span className="text-green-600 font-medium">+<AnimatedNumber value={income} format={formatCompact} /></span>}
                  {expense > 0 && <span className="text-destructive font-medium">−<AnimatedNumber value={expense} format={formatCompact} /></span>}
                </>
              )}
            </div>
          </div>

          {/* Kredi kartı limit mini-çubuğu */}
          {account.type === 'credit_card' && account.creditLimit && (
            <div className="hidden md:flex flex-col items-end gap-1 w-28">
              <span className="text-xs text-muted-foreground tabular-nums">
                <AnimatedNumber value={available ?? 0} format={v => formatCompact(v, account.currency)} /> boşta
              </span>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${usedPct > 80 ? 'bg-destructive' : usedPct > 60 ? 'bg-orange-500' : 'bg-green-600'}`}
                  style={{ width: `${Math.min(usedPct, 100)}%` }}
                />
              </div>
            </div>
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
  )
}
