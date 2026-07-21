'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

type SortKey = 'name' | 'type' | 'income' | 'expense' | 'balance'
type SortDir = 'asc' | 'desc'

/**
 * Görünüm B — Tablo
 * Sıralanabilir yoğun veri tablosu. Başlığa tıklayınca o sütuna göre sıralar
 * (bakiye TRY-normalize kıyaslanır). Güç kullanıcı / çok hesap için.
 */
export function TableView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'balance', dir: 'desc' })

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'name': return a.account.name.localeCompare(b.account.name, 'tr') * dir
        case 'type': return TYPE_LABELS[a.account.type].localeCompare(TYPE_LABELS[b.account.type], 'tr') * dir
        case 'income': return (a.income - b.income) * dir
        case 'expense': return (a.expense - b.expense) * dir
        case 'balance': return (a.tryBalance - b.tryBalance) * dir
      }
    })
  }, [rows, sort])

  const toggle = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'type' ? 'asc' : 'desc' })

  const arrow = (key: SortKey) => sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''

  // Sıralanabilir başlık hücresi — render fonksiyonu (iç component tanımı değil)
  const th = (k: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th key={k} className={`px-4 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => toggle(k)}
        className={`inline-flex items-center gap-0.5 hover:text-foreground transition-colors ${sort.key === k ? 'text-foreground' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}<span className="tabular-nums">{arrow(k)}</span>
      </button>
    </th>
  )

  return (
    <div className="rounded-xl border border-border bg-card overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[640px]">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            {th('name', 'Hesap')}
            {th('type', 'Tür')}
            {th('income', 'Gelir', 'right')}
            {th('expense', 'Gider', 'right')}
            {th('balance', 'Bakiye', 'right')}
            <th className="px-4 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ account, income, expense }) => (
            <tr key={account.id} className="group border-b border-border last:border-0 hover:bg-secondary/40 transition-colors">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <AccountAvatar account={account} size="xs" />
                  <Link href={`/accounts/${account.id}`} className="font-medium text-foreground hover:text-primary transition-colors truncate">
                    {account.name}
                  </Link>
                </div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABELS[account.type]}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-green-600">
                {income > 0 ? formatCompact(income) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-destructive">
                {expense > 0 ? formatCompact(expense) : <span className="text-muted-foreground/40">—</span>}
              </td>
              <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(account.balance, account.currency)}
              </td>
              <td className="px-4 py-2.5 text-right">
                <button
                  onClick={() => onEdit(account)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Düzenle
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
