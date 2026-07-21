'use client'

import { useMemo } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency } from '@/lib/utils/currency'
import { type AccountRow } from './shared'
import { AccountLine } from './Line'
import type { Account } from '@/types'

/**
 * Görünüm — Genel Bakış
 * Üstte üç özet kutucuğu (Net Varlık / Varlıklar / Borçlar) + ince tahsis
 * çubuğu, altında cilalı hesap listesi. Klasik "özet sayfası" düzeni.
 */
export function OverviewView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const { net, assetTotal, debtTotal, assetRows } = useMemo(() => {
    const assets = rows.filter(r => r.tryBalance > 0)
    const assetTotal = assets.reduce((s, r) => s + r.tryBalance, 0)
    const debtTotal = rows.filter(r => r.tryBalance < 0).reduce((s, r) => s + Math.abs(r.tryBalance), 0)
    const assetRows = [...assets].sort((a, b) => b.tryBalance - a.tryBalance)
    return { net: assetTotal - debtTotal, assetTotal, debtTotal, assetRows }
  }, [rows])

  return (
    <div className="space-y-5">
      {/* Özet kutucukları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Net Varlık" value={net} accent />
        <StatTile label="Varlıklar" value={assetTotal} tone="positive" />
        <StatTile label="Borçlar" value={-debtTotal} tone="negative" />
      </div>

      {/* Tahsis çubuğu — varlık dağılımı */}
      {assetTotal > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2.5">Varlık Dağılımı</div>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-0.5">
            {assetRows.map(({ account, tryBalance }) => (
              <div
                key={account.id}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(tryBalance / assetTotal) * 100}%`, background: account.color }}
                title={`${account.name} · %${((tryBalance / assetTotal) * 100).toFixed(1)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {assetRows.slice(0, 6).map(({ account, tryBalance }) => (
              <div key={account.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ background: account.color }} />
                {account.name}
                <span className="text-foreground font-medium tabular-nums">%{((tryBalance / assetTotal) * 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {rows.map(row => (
          <AccountLine key={row.account.id} row={row} onEdit={onEdit} />
        ))}
      </div>
    </div>
  )
}

function StatTile({ label, value, accent, tone }: {
  label: string
  value: number
  accent?: boolean
  tone?: 'positive' | 'negative'
}) {
  const valueColor =
    tone === 'negative' ? 'text-destructive'
    : tone === 'positive' ? 'text-foreground'
    : value < 0 ? 'text-destructive' : 'text-foreground'

  return (
    <div className={`rounded-xl border p-5 ${accent ? 'border-primary/25 bg-primary/[0.04]' : 'border-border bg-card'}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${valueColor}`}>
        <AnimatedNumber value={value} format={v => formatCurrency(v)} />
      </div>
    </div>
  )
}
