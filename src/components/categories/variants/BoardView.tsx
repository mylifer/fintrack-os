'use client'

import { useRouter } from 'next/navigation'
import { CategoryIcon } from '../CategoryIcon'
import { formatCurrency } from '@/lib/utils/currency'
import type { CategoryData } from './shared'
import type { Category } from '@/types'

/* ── Design 2 — "Pano" ─────────────────────────────────────────────
 * Horizontal-scrolling Kanban board. One column per root category,
 * tinted with the category accent. Subcategories stack vertically
 * inside. Best for comparing many categories side-by-side.
 * ------------------------------------------------------------------ */
export function BoardView({ data }: { data: CategoryData }) {
  const router = useRouter()

  if (data.roots.length === 0) {
    return <div className="px-4 py-16 text-center text-sm text-muted-foreground">Bu kapsamda henüz kategori yok.</div>
  }

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden p-4 lg:p-5">
      <div className="flex gap-3 h-full min-w-max pb-2">
        {data.roots.map(root => {
          const st   = data.stats.get(root.id)
          const kids = data.childrenOf(root.id)

          return (
            <div key={root.id} className="flex flex-col w-[264px] flex-shrink-0 rounded-2xl border border-border bg-card overflow-hidden">
              {/* column header */}
              <button
                onClick={() => router.push(`/categories/${root.id}`)}
                className="flex items-center gap-2.5 px-3 py-3 text-left border-b border-border transition-colors hover:bg-accent/40"
                style={{ background: `${root.color}12` }}
              >
                <CategoryIcon icon={root.icon} color={root.color} size={18} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{root.name}</div>
                  <div className="text-[10px] text-muted-foreground">{st?.txCount ?? 0} işlem</div>
                </div>
                <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${(st?.net ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                  {formatCurrency(Math.abs(st?.net ?? 0))}
                </span>
              </button>

              {/* subcategory stack */}
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
                {kids.length === 0 && (
                  <div className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">Alt kategori yok</div>
                )}
                {kids.map(kid => (
                  <ColumnCard key={kid.id} data={data} cat={kid} depth={0} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ColumnCard({ data, cat, depth }: { data: CategoryData; cat: Category; depth: number }) {
  const router = useRouter()
  const st        = data.stats.get(cat.id)
  const grandkids = data.childrenOf(cat.id)

  return (
    <>
      <button
        onClick={() => router.push(`/categories/${cat.id}`)}
        className="flex items-center gap-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-left hover:border-primary/40 hover:bg-accent/40 transition-colors"
        style={{ marginLeft: depth * 10, boxShadow: `inset 3px 0 0 ${cat.color}` }}
      >
        <CategoryIcon icon={cat.icon} color={cat.color} size={12} />
        <span className="flex-1 min-w-0 truncate text-xs font-medium text-foreground">{cat.name}</span>
        {(st?.txCount ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground/70 tabular-nums flex-shrink-0">{st!.txCount}</span>
        )}
      </button>
      {grandkids.map(gk => (
        <ColumnCard key={gk.id} data={data} cat={gk} depth={depth + 1} />
      ))}
    </>
  )
}
