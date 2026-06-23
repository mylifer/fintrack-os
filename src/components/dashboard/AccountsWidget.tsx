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
    <Card className="h-full gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted-foreground">Hesaplar</span>
        <Link href="/accounts" className="text-[9px] font-mono tracking-wide uppercase text-muted-foreground hover:text-primary transition-colors">
          Yönet →
        </Link>
      </CardHeader>

      <CardContent className="p-0">
        {accounts.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-xs text-muted-foreground">Henüz hesap yok.</p>
            <Link href="/accounts" className="text-xs font-mono uppercase tracking-wide text-primary hover:underline mt-1 inline-block">
              Hesap ekle →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {accounts.map(account => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/50 transition-colors"
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: account.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate text-foreground">{account.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{TYPE_LABELS[account.type]}</div>
                </div>
                <span className={`font-mono text-xs tabular flex-shrink-0 ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
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
