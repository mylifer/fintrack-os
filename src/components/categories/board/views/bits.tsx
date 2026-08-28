'use client'

import { CategoryIcon } from '../../CategoryIcon'
import { Highlight } from '@/components/ui/BoardBits'
import type { CategoryRow, SortId } from '../shared'
import type { Category } from '@/types'

/* Kategori görünümlerinin ortak prop sözleşmesi ve iki küçük parçası. Görsel
   parçaların geri kalanı (Highlight, RowActions, PendingBadge, SortTh) tüm
   tahta sayfalarıyla ortak: bkz. @/components/ui/BoardBits. */

export interface CategoryViewProps {
  rows: CategoryRow[]
  /** Aktif arama sorgusu — yalnız eşleşen harfleri vurgulamak için. */
  query: string
  onEdit: (category: Category) => void
  onArchive: (category: Category) => void
  /** Aktif sıralama. Araç çubuğundaki seçici ile ortak state; Tablo görünümü
   *  kolon başlıklarından da değiştirebilsin diye görünümlere de geçiliyor. */
  sort: SortId
  onSort: (sort: SortId) => void
}

/** İkon + (varsa) üst zincir + ad. Ağaç girintisi yerine YOL etiketi: satırlar
 *  tutara göre sıralanınca girinti yanıltıcı olurdu, yol her sırada doğru. */
export function CategoryLabel({
  row, query, compact = false,
}: {
  row: CategoryRow
  query: string
  compact?: boolean
}) {
  const { category, path, level, childCount } = row
  return (
    <>
      <CategoryIcon icon={category.icon} color={category.color} size={compact ? 12 : 16} />
      <span className="min-w-0 truncate">
        {path && (
          <span className={`text-muted-foreground/70 ${compact ? 'text-[11px]' : 'text-xs'}`}>
            {path} ›{' '}
          </span>
        )}
        <span className={`text-foreground ${compact ? 'text-[13px]' : 'text-sm'} ${level === 0 ? 'font-medium' : ''}`}>
          <Highlight text={category.name} query={query} />
        </span>
      </span>
      {childCount > 0 && (
        <span
          title={`${childCount} alt kategori — tutar ve işlem sayısı alt kategorileri de kapsar`}
          className="text-[10px] tabular-nums text-muted-foreground/60 whitespace-nowrap"
        >
          {childCount} alt
        </span>
      )}
      {category.isSystem && (
        <span title="Sistem kategorisi — arşivlenemez" className="text-[9px] text-muted-foreground/40 whitespace-nowrap">
          sistem
        </span>
      )}
    </>
  )
}

/** Tutarın işaret rengi: kapsamına göre BEKLENEN yön nötr, ters yön vurgulanır.
 *  (Gider kategorisinde net pozitifse iadeler harcamayı aşmış demektir.) */
export function amountTone(net: number): string {
  return net > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground'
}
