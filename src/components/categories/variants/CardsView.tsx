'use client'

import { useRouter } from 'next/navigation'
import { CategoryIcon } from '../CategoryIcon'
import { formatCurrency } from '@/lib/utils/currency'
import type { CategoryData } from './shared'
import type { Category } from '@/types'

/* ── Design 1 — "Kartlar" ──────────────────────────────────────────
 * Responsive card grid. Each root category is a card: big icon tile,
 * name, net total, tx count, a share bar, and its subcategories as
 * chips. Spacious, scannable, good for a moderate number of roots.
 * ------------------------------------------------------------------ */
export function CardsView({ data }: { data: CategoryData }) {
  const router = useRouter()

  if (data.roots.length === 0) {
    return <Empty />
  }

  return (
    <div className="p-4 lg:p-5 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {data.roots.map(root => {
        const st    = data.stats.get(root.id)
        const kids  = data.childrenOf(root.id)
        const share = data.maxExpenseAtRoot > 0 ? (st?.expense ?? 0) / data.maxExpenseAtRoot : 0

        return (
          <div
            key={root.id}
            onClick={() => router.push(`/categories/${root.id}`)}
            className="group relative flex flex-col rounded-2xl border border-border bg-card overflow-hidden cursor-pointer transition-all hover:border-primary/40 hover:shadow-[0_2px_16px_-6px_rgba(0,0,0,0.18)]"
          >
            {/* colored top hairline */}
            <div className="h-1 w-full" style={{ background: root.color }} />

            <div className="p-4 flex flex-col gap-3 flex-1">
              {/* header */}
              <div className="flex items-start gap-3">
                <CategoryIcon icon={root.icon} color={root.color} size={22} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{root.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {st?.txCount ?? 0} işlem
                    {(st?.childCount ?? 0) > 0 && <> · {st!.childCount} alt kategori</>}
                  </div>
                </div>
                <div className={`text-sm font-semibold tabular-nums flex-shrink-0 ${(st?.net ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                  {formatCurrency(Math.abs(st?.net ?? 0))}
                </div>
              </div>

              {/* share bar */}
              <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(share * 100, 2)}%`, background: root.color }} />
              </div>

              {/* subcategory chips */}
              {kids.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                  {kids.map(kid => (
                    <Chip key={kid.id} cat={kid} count={data.stats.get(kid.id)?.txCount ?? 0}
                      onClick={e => { e.stopPropagation(); router.push(`/categories/${kid.id}`) }} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Chip({ cat, count, onClick }: { cat: Category; count: number; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:border-primary/40 hover:bg-accent/40 transition-colors"
    >
      <CategoryIcon icon={cat.icon} color={cat.color} size={11} />
      <span className="truncate max-w-[120px]">{cat.name}</span>
      {count > 0 && <span className="text-[10px] text-muted-foreground/70 tabular-nums">{count}</span>}
    </button>
  )
}

function Empty() {
  return (
    <div className="px-4 py-16 text-center text-sm text-muted-foreground">
      Bu kapsamda henüz kategori yok.
    </div>
  )
}
