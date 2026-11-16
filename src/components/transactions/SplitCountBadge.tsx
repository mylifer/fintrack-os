import type { Transaction } from '@/types'

/**
 * Bölünmüş işlem rozeti: kategori adının yanında "+2" olarak görünür ve satırın
 * BAŞKA kategorilere de pay dağıttığını belli eder. Gösterilen kategori adı en
 * büyük paydır (tx.categoryId) — kategori odaklı listelerde (rapor drill-down'u,
 * kategori detayı) ise açık kategori (bkz. focusedCategoryId).
 */
export function SplitCountBadge({ tx }: { tx: Pick<Transaction, 'categorySplits'> }) {
  const count = tx.categorySplits?.length ?? 0
  if (count < 2) return null
  return (
    <span
      title={`${count} kategoriye bölündü`}
      className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground"
    >
      +{count - 1}
    </span>
  )
}
