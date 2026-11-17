'use client'

import { useEffect } from 'react'
import { useTxFocusStore } from '@/lib/tx-focus'

/** Vurgunun süresi */
const HIGHLIGHT_MS = 2500

/** Sanallaştırılmış işlem listesinde odak isteğini karşılar: hedef satır
 *  listede varsa ona kaydırır ve satırı kısa süre vurgular. Satır henüz
 *  listede yoksa (dönem açılıyor, veri yükleniyor) istek bekler. */
export function useFocusTxRow(
  /** Listenin gösterdiği hesap; yalnız bu hesaba yönelik istekler karşılanır */
  accountId: string | undefined,
  rows: readonly { kind: string; tx?: { id: string } }[],
  scrollToIndex: (index: number) => void,
): string | null {
  const target = useTxFocusStore(s => (accountId && s.accountId === accountId ? s.txId : null))
  const highlightId = useTxFocusStore(s => s.highlightId)
  const land = useTxFocusStore(s => s.land)
  const unhighlight = useTxFocusStore(s => s.unhighlight)

  useEffect(() => {
    if (!target) return
    const index = rows.findIndex(r => r.kind === 'tx' && r.tx?.id === target)
    if (index < 0) return
    land(target)
    // Liste ölçülüp yerleşsin diye bir kare sonra kaydır
    requestAnimationFrame(() => scrollToIndex(index))
  }, [target, rows, scrollToIndex, land])

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => unhighlight(highlightId), HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [highlightId, unhighlight])

  return highlightId
}

/** Vurgulanan satırın sınıfı — üç görünümde ortak */
export const FOCUS_ROW_CLASS = 'ring-2 ring-inset ring-primary/70 bg-primary/10 transition-colors duration-700'
