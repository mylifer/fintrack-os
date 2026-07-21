'use client'

import { useMemo } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency } from '@/lib/utils/currency'
import { TYPE_LABELS, TYPE_ORDER, isLiability, type AccountRow } from './shared'
import { AccountLine } from './Line'
import type { Account, AccountType } from '@/types'

/**
 * Görünüm — Bölümler
 * Hesaplar türüne göre başlıklı bölümlere ayrılır; her bölüm başlığında adet ve
 * TRY-normalize alt toplam. Bankacılık uygulaması "Hesaplarım" ekranı hissi.
 */
export function SectionsView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const groups = useMemo(() =>
    TYPE_ORDER
      .map(type => ({ type, rows: rows.filter(r => r.account.type === type) }))
      .filter(g => g.rows.length > 0)
      .map(g => ({ ...g, subtotal: g.rows.reduce((s, r) => s + r.tryBalance, 0) })),
  [rows])

  return (
    <div className="space-y-7">
      {groups.map(({ type, rows: groupRows, subtotal }) => {
        const liability = isLiability(type as AccountType) || subtotal < 0
        return (
          <section key={type}>
            <div className="flex items-baseline justify-between mb-2.5 px-1">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {TYPE_LABELS[type]}
                <span className="ml-2 font-normal normal-case text-muted-foreground/60">{groupRows.length} hesap</span>
              </h2>
              <span className={`text-sm font-semibold tabular-nums ${liability ? 'text-destructive' : 'text-foreground'}`}>
                {liability && subtotal !== 0 ? '−' : ''}
                <AnimatedNumber value={Math.abs(subtotal)} format={v => formatCurrency(v)} />
              </span>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {groupRows.map(row => (
                <AccountLine key={row.account.id} row={row} onEdit={onEdit} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
