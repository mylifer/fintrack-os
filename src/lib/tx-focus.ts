import { create } from 'zustand'

/* ── Bir işlem satırına gitme isteği ─────────────────────────────────────────
   Başka bir yerden (ör. alanlar arası transferin karşı tarafı) bir satıra
   gidilirken hedef `txId`ye bırakılır. Hesap sayfası satırın dönemini açar;
   liste satırı bulunca ona kaydırır ve isteği `highlightId`ye taşır (kısa süre
   vurgulanır). Bellekte tutulur: yenilemede tekrar tetiklenmesin. */
interface TxFocusState {
  /** Bekleyen istek: henüz listede bulunmadı */
  txId: string | null
  /** Satırın gösterileceği hesap sayfası — başka listeler (ör. tıklanan
   *  sayfadaki liste, alan değişince yeniden dolar) isteği tüketmesin */
  accountId: string | null
  /** Bulundu, şu an vurgulanan satır */
  highlightId: string | null
  focus: (txId: string, accountId: string) => void
  land: (txId: string) => void
  unhighlight: (txId: string) => void
}

export const useTxFocusStore = create<TxFocusState>()(set => ({
  txId: null,
  accountId: null,
  highlightId: null,
  focus: (txId, accountId) => set({ txId, accountId, highlightId: null }),
  land: txId => set(s => (s.txId === txId ? { txId: null, accountId: null, highlightId: txId } : s)),
  unhighlight: txId => set(s => (s.highlightId === txId ? { highlightId: null } : s)),
}))
