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
  // Sessiz veri hareketi yasağı: motor kendi başına buluta kayıt geri
  // yüklediğinde (requeue) kullanıcı MUTLAKA görmeli — Temmuz 2026'da eski
  // oturum kalıntıları bu yolla sessizce canlı veriye karışmıştı.
  notice: string | null
  report: (s: SyncStatusSnapshot) => void
  notify: (msg: string) => void
  dismissNotice: () => void
}

export const useSyncStatusStore = create<SyncStatusState>()(set => ({
  pending: 0,
  stuck: 0,
  lastError: null,
  pendingSince: null,
  notice: null,
  // pendingSince kuyruk 0→dolu geçişinde damgalanır, boşalınca sıfırlanır —
  // banner "kuyruk şu süredir dolu" kararını render sırasında türetebilsin diye
  report: s => set(prev => ({
    ...s,
    pendingSince: s.pending === 0 ? null : (prev.pendingSince ?? Date.now()),
  })),
  notify: msg => set({ notice: msg }),
  dismissNotice: () => set({ notice: null }),
}))
