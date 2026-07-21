'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import { balanceSeries } from './trend'
import { Sparkline } from './Sparkline'
import type { Account, Transaction } from '@/types'

/**
 * Görünüm A — Trend
 * Her hesap satırında seçili dönem boyunca gün-sonu bakiye trendini gösteren
 * mini sparkline + dönem başına göre net değişim rozeti. Zaman boyutunu ekler.
 */
export function TrendView({
  rows, transactions, from, to, onEdit,
}: {
  rows: AccountRow[]
  transactions: Transaction[]
  from: string
  to: string
  onEdit: (a: Account) => void
}) {
  const series = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const { account } of rows) {
      const acctTxs = transactions.filter(t => t.accountId === account.id || t.toAccountId === account.id)
      map.set(account.id, balanceSeries(account, acctTxs, from, to))
    }
    return map
  }, [rows, transactions, from, to])

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {rows.map(({ account }, i) => {
        const data = series.get(account.id) ?? [account.balance, account.balance]
        const change = data[data.length - 1] - data[0]
        const up = change >= 0
        const trendColor = change === 0 ? 'var(--muted-foreground)' : up ? '#16a34a' : 'var(--destructive)'

        return (
          <div
            key={account.id}
            className={`group flex items-center gap-3 px-4 h-[72px] transition-colors hover:bg-secondary/40 ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <AccountAvatar account={account} size="sm" />

            <div className="min-w-0 w-40">
              <Link
                href={`/accounts/${account.id}`}
                className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate block"
              >
                {account.name}
              </Link>
              <span className="text-xs text-muted-foreground">{TYPE_LABELS[account.type]}</span>
            </div>

            {/* Sparkline */}
            <div className="flex-1 flex items-center justify-center min-w-0">
              <Sparkline data={data} color={trendColor} uid={account.id} width={160} height={36} />
            </div>

            {/* Dönem değişimi */}
            <div className="hidden sm:block w-28 text-right">
              <div className={`text-xs font-medium tabular-nums ${change === 0 ? 'text-muted-foreground' : up ? 'text-green-600' : 'text-destructive'}`}>
                {change === 0 ? '—' : `${up ? '+' : '−'}`}
                {change !== 0 && <AnimatedNumber value={Math.abs(change)} format={v => formatCompact(v, account.currency)} />}
              </div>
              <div className="text-[11px] text-muted-foreground">dönem</div>
            </div>

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
        )
      })}
    </div>
  )
}
