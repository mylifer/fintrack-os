'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm C — Bento
 * Asimetrik ızgara: en büyük bakiyeli hesap büyük "hero" karo (2×2), sonraki
 * ikisi geniş (2×1), kalanlar standart. Görsel hiyerarşi bakiyeye göre.
 */
export function BentoView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.tryBalance) - Math.abs(a.tryBalance)),
    [rows],
  )

  // Karo boyutu: 0 → hero (2×2), 1-2 → geniş (2×1), gerisi → 1×1
  const spanFor = (i: number) =>
    i === 0 ? 'sm:col-span-2 sm:row-span-2' : i <= 2 ? 'sm:col-span-2' : ''

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-[128px] gap-4">
      {sorted.map(({ account, available, usedPct, income, expense, hasActivity }, i) => {
        const hero = i === 0
        const isCredit = account.type === 'credit_card' && !!account.creditLimit
        return (
          <div
            key={account.id}
            className={`group relative rounded-2xl border border-border bg-card p-4 flex flex-col justify-between overflow-hidden hover:shadow-md transition-shadow ${spanFor(i)}`}
          >
            {/* Renk şeridi */}
            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: account.color }} />

            <div className="flex items-start justify-between gap-2 pl-1">
              <div className="flex items-center gap-2 min-w-0">
                <AccountAvatar account={account} size={hero ? 'md' : 'sm'} />
                <div className="min-w-0">
                  <Link href={`/accounts/${account.id}`} className={`font-semibold text-foreground hover:text-primary transition-colors truncate block ${hero ? 'text-base' : 'text-sm'}`}>
                    {account.name}
                  </Link>
                  <span className="text-[11px] text-muted-foreground">{TYPE_LABELS[account.type]} · {account.currency}</span>
                </div>
              </div>
              <button
                onClick={() => onEdit(account)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-secondary"
              >
                Düzenle
              </button>
            </div>

            <div className="pl-1">
              <div className={`font-semibold tabular-nums ${hero ? 'text-3xl' : 'text-lg'} ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
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
          </div>
        )
      })}
    </div>
  )
}
