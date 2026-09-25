'use client'

import { useCallback, useMemo, useState } from 'react'

// Toplu düzenleme (batch edit) seçim state'i — hem ana İşlemler sayfası hem de
// tablo görünümü kullanan detay sayfaları (hesap/kategori/etiket/bütçe/kişi/
// abonelik) aynı davranışı paylaşsın diye ortak hook. `resetKey` değişince
// seçim temizlenir (filtre/dönem değişiminde ekranda olmayan satır düzenlenmesin).
// String olmak ZORUNDA: değer render sırasında karşılaştırılır, her render'da
// yeni kimlikli bir nesne sonsuz yeniden-render döngüsü üretirdi.
export function useTxSelection(resetKey?: string) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const selectMany = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (selected) next.add(id); else next.delete(id) }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelectedIds(new Set()), [])
  const list = useMemo(() => [...selectedIds], [selectedIds])

  // Anahtar (filtre/dönem) değişince seçim sıfırlanır — render sırasında
  // ayarlanır (React'in "prop değişince state'i ayarla" kalıbı): effect'te
  // sıfırlamak bir kare boyunca gizlenmiş satırları seçili gösteriyordu.
  const [selectionFor, setSelectionFor] = useState(resetKey)
  if (selectionFor !== resetKey) {
    setSelectionFor(resetKey)
    setSelectedIds(new Set())
  }

  return { selectedIds, list, toggle, selectMany, clear }
}
