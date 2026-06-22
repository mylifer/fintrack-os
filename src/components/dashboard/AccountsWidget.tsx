'use client'

import Link from 'next/link'
import { useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'

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
    <div className="card h-full">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-[0.12em] uppercase text-muted">Hesaplar</span>
        <Link
          href="/accounts"
          className="text-[9px] font-mono tracking-wide uppercase text-muted hover:text-ink transition-colors"
        >
          Yönet →
        </Link>
      </div>

      {accounts.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted">Henüz hesap yok.</p>
          <Link href="/accounts" className="text-xs font-mono uppercase tracking-wide text-accent hover:underline mt-1 inline-block">
            Hesap ekle →
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {accounts.map(account => (
            <Link
              key={account.id}
              href={`/accounts/${account.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-ground transition-colors"
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: account.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{account.name}</div>
                <div className="text-[10px] font-mono text-muted">{TYPE_LABELS[account.type]}</div>
              </div>
              <span className={`font-mono text-xs tabular flex-shrink-0 ${account.balance < 0 ? 'text-danger' : 'text-ink'}`}>
                {formatCurrency(account.balance, account.currency)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
