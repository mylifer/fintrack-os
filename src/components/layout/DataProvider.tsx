'use client'

import { useEffect, type ReactNode } from 'react'
import { useAccountStore, useTransactionStore, useInvestmentStore } from '@/store'
import { useWorkspaceStore } from '@/store/workspace.store'
import { startAutoSync, guardUserSwitch } from '@/lib/sync/engine'
import { reloadAllStores } from '@/lib/reload-stores'
import { useNotificationsStore } from '@/store/notifications.store'
import { today } from '@/lib/utils/date'
import { maybeAutoBackup } from '@/lib/auto-backup'

// Modül seviyesinde tekil koruma: StrictMode'da effect iki kez çalışır ve iki
// eşzamanlı init, initDefaults'un "mevcutları oku → eksikleri ekle" akışını
// yarıştırıp varsayılan kategorileri çiftler. Aynı sayfa oturumunda init bir kez koşar.
let initPromise: Promise<void> | null = null

export function DataProvider({ children }: { children: ReactNode }) {
  const loadWorkspaces            = useWorkspaceStore(s => s.load)
  const fetchPrices               = useInvestmentStore(s => s.fetchPrices)
  const reprocessSellLinkedTxs    = useInvestmentStore(s => s.reprocessSellLinkedTxs)

  useEffect(() => {
    async function init() {
      // Phase 0: hesap değişimi koruması — farklı kullanıcıyla giriş
      // yapıldıysa önceki hesabın yerel kalıntıları yüklemeden ÖNCE temizlenir
      // (yoksa pull onları yeni hesaba itmeye çalışır; bkz. engine.ts).
      await guardUserSwitch()

      // Phase 0.5: aktif/varsayılan çalışma alanını çöz — bundan sonraki tüm
      // yaratma/okuma işlemleri buna göre damgalanır/filtrelenir (bkz.
      // src/lib/workspace-context.ts). Diğer store'lardan ÖNCE tamamlanmalı.
      await loadWorkspaces()

      // Phase 1+2: FK parent/child tabloları yükle (bkz. reloadAllStores).
      await Promise.all([
        reloadAllStores(),
        fetchPrices(),
      ])

      reprocessSellLinkedTxs().catch(err => {
        console.error('[init:reprocessSellLinkedTxs]', err)
      })

      // C1: drain any mutations left in the outbox from a previous (possibly
      // offline) session, and keep draining whenever connectivity returns.
      startAutoSync()

      // Günlük otomatik bulut yedeği. Yüklemeler bittikten sonra çalışır ki
      // snapshot taze veriyi içersin; best-effort — hata uygulamayı kırmaz.
      maybeAutoBackup().catch(err => console.warn('[auto-backup]', err))

      // Ask the browser to keep our IndexedDB data across eviction pressure.
      // Without this, Safari can wipe local data after ~7 days of no visits.
      // Best-effort: browsers auto-decide based on engagement; never blocks.
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        navigator.storage.persist().catch(() => { /* non-fatal */ })
      }
    }

    if (!initPromise) {
      initPromise = init().catch(err => {
        console.error('[init]', err)
        initPromise = null // başarısız init tekrar denenebilsin
      })
    }
  }, [loadWorkspaces, fetchPrices, reprocessSellLinkedTxs])

  // Gün değişince bakiyeleri yeniden hesapla: gelecek tarihli işlemler güncel
  // bakiyeye dahil edilmez, günü gelen LEGACY (approvalStatus null) işlem o gün
  // bakiyeye işlenir; 'pending' işlemler onaylanana dek girmez (isPosted bunu
  // doğal sağlar) ve bildirim merkezinde "Onay bekleyen"e düşer. Uygulama
  // (özellikle PWA) günlerce açık kalabildiğinden gece yarısını dakikalık
  // kontrol + görünürlük değişimiyle yakalıyoruz.
  useEffect(() => {
    let lastDay = today()
    const check = () => {
      const day = today()
      if (day === lastDay) return
      lastDay = day
      const { transactions } = useTransactionStore.getState()
      useAccountStore.getState().recomputeBalances(transactions)
      // Bildirim sayacı today()'e bağlı türetilir — gün atlayınca tazele
      useNotificationsStore.getState().refresh()
    }
    const id = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return <>{children}</>
}
