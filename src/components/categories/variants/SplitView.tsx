'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CategoryIcon } from '../CategoryIcon'
import { formatCurrency } from '@/lib/utils/currency'
import type { CategoryData } from './shared'
import type { Category } from '@/types'

/* ── Design 3 — "Bölünmüş" ─────────────────────────────────────────
 * Master–detail. Left rail lists root categories; selecting one
 * reveals its full subtree on the right without leaving the page.
 * Feels like a native app; keeps context while drilling in.
 * ------------------------------------------------------------------ */
export function SplitView({ data }: { data: CategoryData }) {
  const router = useRouter()
  const [selId, setSelId] = useState<string | null>(null)

  if (data.roots.length === 0) {
    return <div className="px-4 py-16 text-center text-sm text-muted-foreground">Bu kapsamda henüz kategori yok.</div>
  }

  // selection derived at render — a stale id (e.g. after a scope switch)
  // gracefully falls back to the first root without an effect.
  const sel = data.roots.find(r => r.id === selId) ?? data.roots[0]
  const selKids = data.childrenOf(sel.id)

  return (
    <div className="flex h-full min-h-0">
      {/* ── left rail ── */}
      <div className="w-[240px] flex-shrink-0 border-r border-border overflow-y-auto py-2">
        {data.roots.map(root => {
          const st = data.stats.get(root.id)
          const isSel = root.id === sel.id
          return (
            <button
              key={root.id}
              onClick={() => setSelId(root.id)}
              className={[
                'flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors border-l-2',
                isSel ? 'bg-primary/5 border-primary' : 'border-transparent hover:bg-accent/40',
              ].join(' ')}
            >
              <CategoryIcon icon={root.icon} color={root.color} size={15} />
              <span className={`flex-1 min-w-0 truncate text-[13px] ${isSel ? 'font-semibold text-foreground' : 'text-foreground'}`}>{root.name}</span>
              {(st?.childCount ?? 0) > 0 && (
                <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0">{st!.childCount}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── detail pane ── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* hero */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border" style={{ background: `${sel.color}0d` }}>
          <CategoryIcon icon={sel.icon} color={sel.color} size={26} />
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-foreground truncate">{sel.name}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{data.stats.get(sel.id)?.txCount ?? 0} işlem</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Toplam</div>
            <div className={`text-base font-semibold tabular-nums ${(data.stats.get(sel.id)?.net ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
              {formatCurrency(Math.abs(data.stats.get(sel.id)?.net ?? 0))}
            </div>
          </div>
          <button
            onClick={() => router.push(`/categories/${sel.id}`)}
            className="ml-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
          >
            Aç →
          </button>
        </div>

        {/* subtree */}
        {selKids.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">Bu kategorinin alt kategorisi yok.</div>
        ) : (
          <div className="p-3">
            {selKids.map(kid => <SubRow key={kid.id} data={data} cat={kid} depth={0} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function SubRow({ data, cat, depth }: { data: CategoryData; cat: Category; depth: number }) {
  const router = useRouter()
  const st    = data.stats.get(cat.id)
  const kids  = data.childrenOf(cat.id)

  return (
    <>
      <button
        onClick={() => router.push(`/categories/${cat.id}`)}
        className="group flex items-center gap-2.5 w-full rounded-xl px-2.5 py-2 text-left hover:bg-accent/40 transition-colors"
        style={{ paddingLeft: 10 + depth * 22 }}
      >
        <CategoryIcon icon={cat.icon} color={cat.color} size={depth === 0 ? 15 : 13} />
        <span className={`flex-1 min-w-0 truncate ${depth === 0 ? 'text-[13px] font-medium' : 'text-xs'} text-foreground`}>{cat.name}</span>
        {(st?.txCount ?? 0) > 0 && <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">{st!.txCount} işlem</span>}
        <span className="text-xs font-medium tabular-nums text-muted-foreground flex-shrink-0 w-24 text-right">
          {(st?.net ?? 0) !== 0 ? formatCurrency(Math.abs(st!.net)) : '—'}
        </span>
      </button>
      {kids.map(gk => <SubRow key={gk.id} data={data} cat={gk} depth={depth + 1} />)}
    </>
  )
}
