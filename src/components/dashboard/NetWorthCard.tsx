'use client'

import { useAccountStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcAvailableCredit } from '@/lib/utils/calculations'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { useCountUp } from '@/lib/hooks/useCountUp'
import Link from 'next/link'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

export function NetWorthCard() {
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices   = useInvestmentStore(s => s.prices)
  const netWorth = calcNetWorth(accounts, prices)
  const hasMultiCurrency = accounts.some(a => a.currency !== 'TRY')
  const currency = (hasMultiCurrency || prices) ? 'TRY' : (accounts[0]?.currency ?? 'TRY')

  const animNetWorth = useCountUp(netWorth)
  const creditCards  = accounts.filter(a => a.type === 'credit_card')

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Varlık</span>
        <Link href="/accounts" className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          Tümü →
        </Link>
      </CardHeader>

      <CardContent className="pt-5">
        <div className={`text-3xl font-normal tabular-nums mb-1 ${netWorth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCompact(animNetWorth, currency)}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground pb-1.5 border-b border-border/50">
            <span>Hesap</span>
            <span>Bakiye</span>
          </div>
          {accounts.map(account => (
            <div key={account.id} className="flex items-center gap-2 py-2">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: account.color }}
              />
              <span className="flex-1 text-sm text-muted-foreground truncate">{account.name}</span>
              <span className={`text-sm font-medium tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(account.balance, account.currency)}
              </span>
            </div>
          ))}
        </div>

        {creditCards.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Kullanılabilir Kredi</div>
            {creditCards.map(cc => {
              const available = calcAvailableCredit(cc)
              const used = cc.creditLimit ? cc.creditLimit - available : 0
              const pct = cc.creditLimit ? (used / cc.creditLimit) * 100 : 0
              return (
                <div key={cc.id} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{cc.name}</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCurrency(available, cc.currency)}
                    </span>
                  </div>
                  <div className="h-[2px] bg-border">
                    <div
                      className={`h-full ${pct > 80 ? 'bg-destructive' : pct > 60 ? 'bg-orange-500' : 'bg-primary'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs font-medium tabular-nums text-muted-foreground text-right">
                    {formatCurrency(used, cc.currency)} / {formatCurrency(cc.creditLimit ?? 0, cc.currency)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
