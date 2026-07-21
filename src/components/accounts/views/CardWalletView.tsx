'use client'

import Link from 'next/link'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm 3 — Cüzdan / Kart
 * Her hesap fiziksel banka kartı gibi; hesabın kendi rengiyle degrade zemin,
 * beyaz metin. Bakiye büyük ve öne çıkar. Kredi kartlarında limit halkası/çubuğu.
 */
export function CardWalletView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {rows.map(({ account, available, usedPct, income, expense, hasActivity }) => {
        const isCredit = account.type === 'credit_card' && !!account.creditLimit
        return (
          <div
            key={account.id}
            className="group relative aspect-[1.9/1] rounded-2xl p-5 flex flex-col justify-between overflow-hidden shadow-sm text-white"
            style={{ background: `linear-gradient(135deg, ${account.color} 0%, ${account.color}cc 55%, ${account.color}99 100%)` }}
          >
            {/* Parıltı */}
            <div className="pointer-events-none absolute -top-1/2 -right-1/4 w-2/3 h-full rounded-full bg-white/10 blur-2xl" />

            <div className="relative flex items-start justify-between">
              <div className="min-w-0">
                <Link
                  href={`/accounts/${account.id}`}
                  className="text-sm font-semibold hover:underline truncate block max-w-[12rem]"
                >
                  {account.name}
                </Link>
                <span className="text-[11px] font-medium text-white/70 uppercase tracking-wide">
                  {TYPE_LABELS[account.type]} · {account.currency}
                </span>
              </div>
              <button
                onClick={() => onEdit(account)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 backdrop-blur-sm"
              >
                Düzenle
              </button>
            </div>

            <div className="relative">
              <div className="text-2xl font-semibold tabular-nums tracking-tight">
                <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
              </div>

              {isCredit ? (
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-white/80 mb-1">
                    <span><AnimatedNumber value={available ?? 0} format={v => formatCompact(v, account.currency)} /> boşta</span>
                    <span><AnimatedNumber value={account.creditLimit ?? 0} format={v => formatCompact(v, account.currency)} /> limit</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/25 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-white"
                      style={{ width: `${Math.min(usedPct, 100)}%` }}
                    />
                  </div>
                </div>
              ) : hasActivity ? (
                <div className="mt-2 flex items-center gap-3 text-xs font-medium">
                  {income > 0 && <span className="text-white/90">↑ <AnimatedNumber value={income} format={formatCompact} /></span>}
                  {expense > 0 && <span className="text-white/70">↓ <AnimatedNumber value={expense} format={formatCompact} /></span>}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
