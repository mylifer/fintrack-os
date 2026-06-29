'use client'

import Link from 'next/link'
import { useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'

const TYPE_LABELS: Record<string, string> = {
  cash:        'Nakit',
  checking:    'Vadesiz',
  savings:     'Vadeli',
  credit_card: 'Kredi Kartı',
  investment:  'Yatırım',
  loan:        'Kredi',
}

export function AccountsWidget() {
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border/50 pb-4">
        <span className="text-xs font-medium text-muted-foreground">Hesaplar</span>
        <Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Yönet →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {accounts.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">Henüz hesap yok.</p>
            <Link href="/accounts" className="text-xs text-primary hover:underline mt-2 inline-block">
              Hesap ekle →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {accounts.map(account => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}`}
                className="flex items-center gap-3 px-6 py-3.5 hover:bg-secondary/50 transition-colors"
              >
                {account.icon ? (
                  <span
                    className="w-7 h-7 rounded-md flex items-center justify-center text-base flex-shrink-0"
                    style={{ background: account.color + '22' }}
                  >
                    {account.icon}
                  </span>
                ) : (
                  <span
                    className="w-7 h-7 rounded-md flex-shrink-0"
                    style={{ background: account.color + '33' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-foreground">{account.name}</div>
                  <div className="text-xs text-muted-foreground">{TYPE_LABELS[account.type]}</div>
                </div>
                <span className={`text-sm tabular-nums flex-shrink-0 ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {formatCurrency(account.balance, account.currency)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
