'use client'

import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import type { DraftSplit } from '@/lib/utils/categorySplits'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'
import type { TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

// Gider/gelir "Kategori" alanı: tek kategori seçimi ya da bölme açıkken özet.
export function CategoryField({
  form, patch, errors, autoCategory, setAutoCategory, splits, splitTotal, openSplit, closeSplit,
  categories, filteredCategories, createCategory, incomeModeToggle,
}: {
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  errors: Record<string, string>
  autoCategory: string | null
  setAutoCategory: TransactionFormState['setAutoCategory']
  splits: DraftSplit[] | null
  splitTotal: number
  openSplit: () => void
  closeSplit: () => void
  categories: Category[]
  filteredCategories: Category[]
  createCategory: (name: string) => Promise<string>
  incomeModeToggle: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className={cn("text-sm font-medium", errors.categoryId && "text-destructive")}>
          Kategori
          {autoCategory && form.categoryId === autoCategory && !splits && (
            <span
              className="ml-1.5 text-[10px] font-normal text-muted-foreground"
              title="Açıklamadaki kurala ya da alıcının geçmişine göre seçildi — değiştirebilirsiniz"
            >
              otomatik
            </span>
          )}
        </Label>
        {/* Bölme yalnızca gerçek bir tutar varken anlamlı — 0'ı bölmek
            boş bir bar üretirdi. */}
        <div className="flex items-center gap-2">
        {splits ? (
          <button type="button" onClick={closeSplit} className="text-xs font-medium text-primary hover:underline">
            Bölmeyi kaldır
          </button>
        ) : splitTotal > 0 && (
          <button type="button" onClick={openSplit} className="text-xs font-medium text-primary hover:underline">
            Böl
          </button>
        )}
        {incomeModeToggle}
        </div>
      </div>
      {splits ? (
        // Bölme açıkken alan özet gösterir; seçim aşağıdaki paylardan yapılır.
        <div className="flex h-8 w-full items-center gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm select-none dark:bg-input/30">
          <span className="flex items-center">
            {splits.slice(0, 3).map((s, i) => {
              const c = categories.find(x => x.id === s.categoryId)
              return (
                <span key={`${s.categoryId}-${i}`} className={cn("flex items-center", i > 0 && "-ml-1.5")}>
                  {c
                    ? <CategoryIcon icon={c.icon} color={c.color} size={13} />
                    : <span className="size-3.5 rounded-full bg-muted" />}
                </span>
              )
            })}
          </span>
          <span className="truncate text-muted-foreground">{splits.length} kategori</span>
        </div>
      ) : (
        <CategoryCascadeSelect
          categories={filteredCategories}
          value={form.categoryId ?? ''}
          onChange={v => { setAutoCategory(null); patch({ categoryId: v }) }}
          error={!!errors.categoryId}
          onCreate={createCategory}
        />
      )}
      {errors.categoryId && <p className="text-xs text-destructive">{errors.categoryId}</p>}
    </div>
  )
}
