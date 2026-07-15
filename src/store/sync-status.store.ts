'use client'

import { create } from 'zustand'

/* ── Sync health surface ─────────────────────────────────────────────────
   Fed by the sync engine after every outbox change/flush; consumed by
   SyncStatusBanner. Holds ONLY data — the retry action lives in the engine
   (retryDeadLetters) so this module stays import-cycle-free. */

export interface SyncStatusSnapshot {
  pending: number             // buluta yazılmayı bekleyen mutasyon sayısı
  stuck: number               // deneme hakkı tükenmiş (dead-letter) mutasyon sayısı
  lastError: string | null    // en son push hatası (kullanıcıya gösterilir)
}

interface SyncStatusState extends SyncStatusSnapshot {
  pendingSince: number | null // kuyruğun kesintisiz dolu olduğu andan beri (ms epoch)
  report: (s: SyncStatusSnapshot) => void
}

export const useSyncStatusStore = create<SyncStatusState>()(set => ({
  pending: 0,
  stuck: 0,
  lastError: null,
  pendingSince: null,
  // pendingSince kuyruk 0→dolu geçişinde damgalanır, boşalınca sıfırlanır —
  // banner "kuyruk şu süredir dolu" kararını render sırasında türetebilsin diye
  report: s => set(prev => ({
    ...s,
    pendingSince: s.pending === 0 ? null : (prev.pendingSince ?? Date.now()),
  })),
}))
