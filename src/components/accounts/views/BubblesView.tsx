'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm — Kabarcık (Bubbles)
 * Her hesap, bakiye "ağırlığına" göre boyutlanmış bir baloncuk (çap √-ölçek).
 * Büyük baloncuklarda isim + bakiye içeride; küçüklerde hover ipucu. Paranın
 * nerede yoğunlaştığını sezgisel gösterir. Borçlar kırmızı halkalı.
 */
export function BubblesView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const bubbles = useMemo(() => {
    const maxAbs = Math.max(...rows.map(r => Math.abs(r.tryBalance)), 1)
    return [...rows]
      .sort((a, b) => Math.abs(b.tryBalance) - Math.abs(a.tryBalance))
      .map(row => ({
        row,
        size: Math.round(72 + Math.sqrt(Math.abs(row.tryBalance) / maxAbs) * 128), // 72–200px
      }))
  }, [rows])

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-secondary/40 to-card p-6">
      <div className="flex flex-wrap items-center justify-center gap-4">
        {bubbles.map(({ row, size }) => {
          const { account } = row
          const debt = row.tryBalance < 0
          const big = size >= 118
          return (
            <div key={account.id} className="group relative" style={{ width: size, height: size }}>
              <Link
                href={`/accounts/${account.id}`}
                title={`${account.name} · ${formatCurrency(account.balance, account.currency)}`}
                className="w-full h-full rounded-full flex flex-col items-center justify-center text-center text-white overflow-hidden transition-transform group-hover:scale-[1.04] shadow-sm"
                style={{
                  background: `radial-gradient(circle at 32% 28%, ${account.color}, ${account.color}cc 70%, ${account.color}99 100%)`,
                  boxShadow: debt ? '0 0 0 2px var(--destructive) inset' : undefined,
                }}
              >
                {big ? (
                  <>
                    <span className="text-[11px] font-medium text-white/80 px-2 truncate max-w-full leading-tight">{account.name}</span>
                    <span className="text-sm font-bold tabular-nums leading-tight mt-0.5">
                      <AnimatedNumber value={account.balance} format={v => formatCompact(v, account.currency)} />
                    </span>
                    <span className="text-[9px] text-white/70 uppercase tracking-wide mt-0.5">{TYPE_LABELS[account.type]}</span>
                  </>
                ) : (
                  <span className="text-xs font-bold tabular-nums px-1 leading-tight">
                    <AnimatedNumber value={account.balance} format={v => formatCompact(v, account.currency)} />
                  </span>
                )}
              </Link>

              {/* Küçük baloncuklar için dış etiket */}
              {!big && (
                <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {account.name}
                </span>
              )}

              <button
                onClick={() => onEdit(account)}
                className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-card border border-border text-[11px] flex items-center justify-center hover:bg-secondary shadow-sm"
                title="Düzenle"
              >
                ✎
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
