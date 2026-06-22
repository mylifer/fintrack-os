'use client'

import { useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcAvailableCredit } from '@/lib/utils/calculations'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import Link from 'next/link'

export function NetWorthCard() {
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const netWorth = calcNetWorth(accounts)
  const currency = accounts[0]?.currency ?? 'TRY'

  const creditCards = accounts.filter(a => a.type === 'credit_card')

  return (
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">Net Varlık</span>
        <Link href="/accounts" className="text-[9px] font-mono tracking-wide uppercase text-muted hover:text-ink transition-colors">
          Tümü →
        </Link>
      </div>

      <div className="px-5 py-5">
        <div className={`text-4xl font-black tabular tracking-[-0.04em] leading-none mb-1 ${netWorth >= 0 ? 'text-ink' : 'text-danger'}`}>
          {formatCompact(netWorth, currency)}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex justify-between text-[10px] font-mono uppercase text-muted pb-1.5 border-b border-line">
            <span>Hesap</span>
            <span>Bakiye</span>
          </div>
          {accounts.map(account => (
            <div key={account.id} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: account.color }}
              />
              <span className="flex-1 text-xs text-muted truncate">{account.name}</span>
              <span className={`font-mono text-xs tabular ${account.balance < 0 ? 'text-danger' : 'text-ink'}`}>
                {formatCurrency(account.balance, account.currency)}
              </span>
            </div>
          ))}
        </div>

        {/* Credit card available credit */}
        {creditCards.length > 0 && (
          <div className="mt-4 pt-4 border-t border-line">
            <div className="text-[9px] font-mono tracking-[0.1em] uppercase text-muted mb-2">Kullanılabilir Kredi</div>
            {creditCards.map(cc => {
              const available = calcAvailableCredit(cc)
              const used = cc.creditLimit ? cc.creditLimit - available : 0
              const pct = cc.creditLimit ? (used / cc.creditLimit) * 100 : 0
              return (
                <div key={cc.id} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">{cc.name}</span>
                    <span className="font-mono tabular text-ink">
                      {formatCurrency(available, cc.currency)}
                    </span>
                  </div>
                  <div className="h-[2px] bg-line">
                    <div
                      className={`h-full ${pct > 80 ? 'bg-danger' : pct > 60 ? 'bg-amber' : 'bg-accent'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-muted text-right">
                    {formatCurrency(used, cc.currency)} / {formatCurrency(cc.creditLimit ?? 0, cc.currency)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
