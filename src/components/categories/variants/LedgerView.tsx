'use client'

import { useRouter } from 'next/navigation'
import { CategoryIcon } from '../CategoryIcon'
import { formatCurrency } from '@/lib/utils/currency'
import type { CategoryData } from './shared'
import type { Category } from '@/types'

/* ── "Defter" ──────────────────────────────────────────────────────
 * Data-rich full-width tree. Every row carries a spending-share bar
 * (relative to the largest root), a right-aligned net total and tx
 * count, with a color-keyed left border for hierarchy. Dense, the
 * closest to the current list but far more informative at a glance.
 * ------------------------------------------------------------------ */
const PAD = [14, 40, 64] as const

export function LedgerView({ data }: { data: CategoryData }) {
  if (data.roots.length === 0) {
    return <div className="px-4 py-16 text-center text-sm text-muted-foreground">Bu kapsamda henüz kategori yok.</div>
  }

  return (
    <div className="overflow-y-auto h-full">
      {/* column header */}
      <div className="flex items-center gap-3 px-4 h-9 border-b border-border bg-muted/30 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sticky top-0 z-10">
        <span className="flex-1">Kategori</span>
        <span className="w-28 hidden sm:block">Pay</span>
        <span className="w-16 text-right hidden sm:block">İşlem</span>
        <span className="w-28 text-right">Toplam</span>
      </div>

      {data.roots.map(root => <Row key={root.id} data={data} cat={root} level={0} />)}
    </div>
  )
}

function Row({ data, cat, level }: { data: CategoryData; cat: Category; level: 0 | 1 | 2 }) {
  const router = useRouter()
  const st    = data.stats.get(cat.id)
  const kids  = data.childrenOf(cat.id)
  const share = data.maxExpenseAtRoot > 0 ? (st?.expense ?? 0) / data.maxExpenseAtRoot : 0

  return (
    <>
      <div
        onClick={() => router.push(`/categories/${cat.id}`)}
        className={[
          'group flex items-center gap-3 border-b border-border cursor-pointer transition-colors hover:bg-accent/40',
          level === 0 ? 'bg-transparent' : level === 1 ? 'bg-muted/15' : 'bg-muted/25',
        ].join(' ')}
        style={{ paddingLeft: PAD[level], paddingRight: 16, paddingTop: level === 0 ? 9 : 6, paddingBottom: level === 0 ? 9 : 6, boxShadow: `inset 3px 0 0 ${cat.color}` }}
      >
        <CategoryIcon icon={cat.icon} color={cat.color} size={level === 0 ? 17 : 13} />

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className={`truncate text-foreground ${level === 0 ? 'text-sm font-medium' : level === 1 ? 'text-[13px]' : 'text-xs'}`}>{cat.name}</span>
          {(st?.childCount ?? 0) > 0 && <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{st!.childCount} alt</span>}
        </div>

        {/* share bar */}
        <div className="w-28 hidden sm:block">
          <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%`, background: cat.color }} />
          </div>
        </div>

        <span className="w-16 text-right text-[11px] text-muted-foreground tabular-nums hidden sm:block flex-shrink-0">
          {(st?.txCount ?? 0) > 0 ? st!.txCount : '—'}
        </span>

        <span className={`w-28 text-right text-xs font-medium tabular-nums flex-shrink-0 ${(st?.net ?? 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
          {(st?.net ?? 0) !== 0 ? formatCurrency(Math.abs(st!.net)) : '—'}
        </span>
      </div>

      {kids.map(k => <Row key={k.id} data={data} cat={k} level={(level + 1) as 0 | 1 | 2} />)}
    </>
  )
}
