'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { formatCurrency } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'
import type { SessionRow } from './form-model'

// ── Oturum listesi (art arda ekleme) ───────────────────────────────────────
export function SessionList({
  session, sessionTotals, sessionEditId, categories, editSessionRow, removeSessionRow,
}: {
  session: SessionRow[]
  sessionTotals: string
  sessionEditId: string | null
  categories: Category[]
  editSessionRow: (row: SessionRow) => void
  removeSessionRow: (row: SessionRow) => Promise<void>
}) {
  return (
    <div className="border-t bg-muted/40">
      <div className="flex items-baseline justify-between px-6 pt-3 pb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Bu oturumda eklenenler ({session.length})
        </span>
        <span className="text-xs font-semibold tabular-nums">{sessionTotals}</span>
      </div>
      <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5 px-6 pb-3">
        {/* En yeni üstte — store dizisi bozulmadan ters çevrilir. */}
        {[...session].reverse().map(row => {
          const cat = row.categoryId ? categories.find(c => c.id === row.categoryId) : undefined
          const isEditing = sessionEditId === row.id
          return (
            <div
              key={row.id}
              className={cn(
                "flex items-center gap-2.5 rounded-md border bg-background dark:bg-card px-2.5 py-1.5",
                isEditing && "border-primary ring-1 ring-primary/30",
              )}
            >
              {cat
                ? <CategoryIcon icon={cat.icon} color={cat.color} size={14} />
                : <span className="size-6 shrink-0" />}
              <span className="flex-1 truncate text-sm">{row.description}</span>
              <span className={cn(
                "text-sm font-semibold tabular-nums",
                row.type === 'income' && "text-[var(--cf-income)]",
              )}>
                {row.type === 'income' ? '+' : row.type === 'expense' ? '−' : ''}
                {formatCurrency(Math.abs(row.amount), row.currency)}
              </span>
              <span className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground">
                {row.accountName}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                {row.editable && (
                  <button
                    type="button"
                    onClick={() => editSessionRow(row)}
                    aria-label={`${row.description} satırını düzenle`}
                    title="Forma geri yükle"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void removeSessionRow(row)}
                  aria-label={`${row.description} satırını sil`}
                  title="Sil"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
