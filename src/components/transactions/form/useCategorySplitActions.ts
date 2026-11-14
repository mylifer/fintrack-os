import { parseCurrencyInput } from '@/lib/utils/currency'
import {
  equalSplit, distributeSplits, unpinSplits, primarySplitCategoryId,
  type DraftSplit,
} from '@/lib/utils/categorySplits'
import type { TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

export function useCategorySplitActions({
  amountStr, form, patch, splits, setSplits, errors, setErrors,
}: {
  amountStr: string
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  splits: DraftSplit[] | null
  setSplits: TransactionFormState['setSplits']
  errors: Record<string, string>
  setErrors: TransactionFormState['setErrors']
}) {
  // ── Bölme yardımcıları ──────────────────────────────────────────────────
  // Tüm pay matematiği BÜYÜKLÜK üzerinden yürür (tutar alanı da öyle);
  // işaret yalnızca kayıt anında amountSign ile geri takılır.
  const splitTotal = parseCurrencyInput(amountStr)

  // Bölmeyi aç: mevcut kategori ilk pay olur, ikinci pay boş gelir (kullanıcı
  // seçer — sessizce rastgele bir kategori atamak veriyi kirletirdi). Tutar
  // eşit bölünür; kuruş kalanı ilk paya gider.
  function openSplit() {
    setSplits(equalSplit(splitTotal, [form.categoryId ?? '', '']))
    if (errors.categoryId) setErrors(prev => ({ ...prev, categoryId: '' }))
  }

  // Bölmeyi kapat: baskın kategori tek kategori olarak kalır.
  function closeSplit() {
    patch({ categoryId: primarySplitCategoryId(splits ?? undefined) ?? form.categoryId })
    setSplits(null)
    setErrors(prev => ({ ...prev, categorySplits: '' }))
  }

  // Yeni pay otomatik doğar: elle girilmiş tutarlara dokunulmaz, yalnızca
  // kalan yeniden paylaşılır.
  function addSplitRow() {
    if (!splits) return
    setSplits(distributeSplits([...splits, { categoryId: '', amount: 0 }], splitTotal))
  }

  function removeSplitRow(i: number) {
    if (!splits) return
    const rest = splits.filter((_, j) => j !== i)
    if (rest.length < 2) {
      patch({ categoryId: rest[0]?.categoryId || form.categoryId })
      setSplits(null)
      setErrors(prev => ({ ...prev, categorySplits: '' }))
      return
    }
    setSplits(distributeSplits(rest, splitTotal))
  }

  /** "Eşit böl": tüm sabitleri kaldırır, paylar baştan eşit bölünür. */
  function resetSplits() {
    if (!splits) return
    setSplits(unpinSplits(splits, splitTotal))
  }

  return { splitTotal, openSplit, closeSplit, addSplitRow, removeSplitRow, resetSplits }
}
