'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm 4 — Dağılım / Tahsis
 * Varlıkların hesaplara dağılımını tek yığılmış çubukta gösterir; altında her
 * hesap toplam varlık içindeki payıyla (yüzde + kendi renginde pay çubuğu)
 * listelenir. Varlık / borç ayrımı üstte özetlenir.
 */
export function AllocationView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const { assets, assetTotal, liabTotal, sorted } = useMemo(() => {
    const assets = rows.filter(r => r.tryBalance > 0)
    const liabilities = rows.filter(r => r.tryBalance < 0)
    const assetTotal = assets.reduce((s, r) => s + r.tryBalance, 0)
    const liabTotal = liabilities.reduce((s, r) => s + Math.abs(r.tryBalance), 0)
    // Payı en büyük olan üstte
    const sorted = [...rows].sort((a, b) => Math.abs(b.tryBalance) - Math.abs(a.tryBalance))
    return { assets, assetTotal, liabTotal, sorted }
  }, [rows])

  return (
    <div className="space-y-6">
      {/* Varlık / borç özet + dağılım çubuğu */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mb-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Toplam Varlık</div>
            <div className="text-xl font-semibold tabular-nums text-foreground">
              <AnimatedNumber value={assetTotal} format={v => formatCurrency(v)} />
            </div>
          </div>
          {liabTotal > 0 && (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Toplam Borç</div>
              <div className="text-xl font-semibold tabular-nums text-destructive">
                −<AnimatedNumber value={liabTotal} format={v => formatCurrency(v)} />
              </div>
            </div>
          )}
        </div>

        {/* Yığılmış dağılım çubuğu — yalnız varlıklar */}
        {assetTotal > 0 && (
          <div className="flex h-3 w-full rounded-full overflow-hidden gap-0.5">
            {assets
              .sort((a, b) => b.tryBalance - a.tryBalance)
              .map(({ account, tryBalance }) => (
                <div
                  key={account.id}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all"
                  style={{ width: `${(tryBalance / assetTotal) * 100}%`, background: account.color }}
                  title={`${account.name} · ${((tryBalance / assetTotal) * 100).toFixed(1)}%`}
                />
              ))}
          </div>
        )}
      </div>

      {/* Pay listesi */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {sorted.map(({ account, tryBalance, income, expense, hasActivity }, i) => {
          const share = assetTotal > 0 && tryBalance > 0 ? (tryBalance / assetTotal) * 100 : 0
          return (
            <div
              key={account.id}
              className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40 ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <AccountAvatar account={account} size="sm" />

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/accounts/${account.id}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
                  >
                    {account.name}
                  </Link>
                  <div className={`text-sm font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                    <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
                  </div>
                </div>

                {/* Pay çubuğu */}
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${share}%`, background: tryBalance < 0 ? 'var(--destructive)' : account.color }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground w-16 text-right">
                    {tryBalance < 0 ? TYPE_LABELS[account.type] : `%${share.toFixed(1)}`}
                  </span>
                </div>

                {hasActivity && (
                  <div className="flex items-center gap-3 mt-1 text-xs font-medium">
                    {income > 0 && <span className="text-green-600">+<AnimatedNumber value={income} format={formatCompact} /></span>}
                    {expense > 0 && <span className="text-destructive">−<AnimatedNumber value={expense} format={formatCompact} /></span>}
                  </div>
                )}
              </div>

              <button
                onClick={() => onEdit(account)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-secondary self-start"
              >
                Düzenle
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
