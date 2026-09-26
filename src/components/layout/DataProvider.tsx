'use client'

import { useEffect, type ReactNode } from 'react'
import { useAccountStore, useTransactionStore, useInvestmentStore, useUIStore } from '@/store'
import { useWorkspaceStore } from '@/store/workspace.store'
import { startAutoSync, guardUserSwitch, lastPullWasAuthoritative, type SyncTable } from '@/lib/sync/engine'
import { reloadAllStores, reloadTable } from '@/lib/reload-stores'
import { startRealtime } from '@/lib/sync/realtime'
import { useNotificationsStore } from '@/store/notifications.store'
import { currentMonthYear, today } from '@/lib/utils/date'
import { maybeAutoBackup } from '@/lib/auto-backup'
import { installErrorReporter } from '@/lib/error-reporter'

// Otomatik yedeğin kapsadığı tablolar (auto-backup.ts readSnapshot ile aynı küme).
const BACKUP_TABLES: SyncTable[] = [
  'accounts', 'transactions', 'categories', 'budgets', 'debts',
  'investment_transactions', 'people', 'recurring_transactions',
]

// Modül seviyesinde tekil koruma: StrictMode'da effect iki kez çalışır ve iki
// eşzamanlı init, initDefaults'un "mevcutları oku → eksikleri ekle" akışını
// yarıştırıp varsayılan kategorileri çiftler. Aynı sayfa oturumunda init bir kez koşar.
let initPromise: Promise<void> | null = null

export function DataProvider({ children }: { children: ReactNode }) {
  const loadWorkspaces            = useWorkspaceStore(s => s.load)
  const fetchPrices               = useInvestmentStore(s => s.fetchPrices)

  // Yakalanmamış hatalar Supabase error_logs'a (yalnız üretimde, bkz. error-reporter)
  useEffect(() => { installErrorReporter() }, [])

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

      // Satış defter satırlarını yeniden yazan tek seferlik göç (inv_sell_pnl_v3)
      // KALDIRILDI: bayrağı localStorage'daydı ve çıkışta silindiği için her
      // girişte/yeni cihazda tekrar çalışıp satış gelir + K/Z satırlarını yeni
      // id'lerle baştan yazıyordu (kullanıcı düzenlemeleri kayboluyordu). Satışlar
      // bağlarını addTransaction/updateTransaction'da zaten kurar — geri eklemeyin.

      // C1: drain any mutations left in the outbox from a previous (possibly
      // offline) session, and keep draining whenever connectivity returns.
      startAutoSync()

      // Günlük otomatik bulut yedeği. Yüklemeler bittikten sonra çalışır ki
      // snapshot taze veriyi içersin; best-effort — hata uygulamayı kırmaz.
      // Yalnız TÜM yedek tablolarının çekişi eksiksizse: yarıda kalan bir çekişte
      // Dexie kısmi/boş olabilir (çıkış sonrası) ve kısmi bir "otomatik" yedek hem
      // en eski sağlam yedeği budar hem de 24 saat boyunca yenisini engellerdi.
      if (BACKUP_TABLES.every(t => lastPullWasAuthoritative(t))) {
        maybeAutoBackup().catch(err => console.warn('[auto-backup]', err))
      }

      // Canlı senkron: başka cihazdaki değişiklik ilgili tabloyu yeniden yükler
      // (bkz. sync/realtime.ts). init sayfa oturumunda bir kez koştuğu için
      // abonelik de bir kez açılır; çıkış HARD reload olduğundan kapatma gerekmez.
      startRealtime(table => {
        reloadTable(table).catch(err => console.error(`[realtime:${table}]`, err))
      })

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
  }, [loadWorkspaces, fetchPrices])

  // Kurlar yayınlanınca bakiyeleri yeniden hesapla.
  //
  // Neden: çapraz kur transferinin GELEN bacağı hedef hesabın para birimine
  // çevrilerek işlenir (calculations.ts:44-49) ve bu çeviri fx.ts'teki canlı
  // kurlara dayanır. Kur yokken fromBaseTry ham TRY tutarı döndürüyor, yani
  // 10.000 ₺'lik transfer USD hesabına 10.000 $ olarak giriyor (~34,5 kat şişme).
  // init'te reloadAllStores() ve fetchPrices() PARALEL koşuyor ve reloadAllStores
  // kendi sonunda recomputeBalances çağırıyor — yani bakiyeler tipik olarak
  // kurlar gelmeden hesaplanıyordu. `prices` değişimini izlemek hem bu açılış
  // yarışını hem de ilk fetch'in başarısız olup sonrakinin tutması durumunu
  // kapatır. recomputeBalances türetilmiş bir değeri tazeler — hiçbir şey
  // yazmaz, bu yüzden fazladan çalışması zararsızdır.
  const prices = useInvestmentStore(s => s.prices)
  useEffect(() => {
    if (!prices) return
    const { transactions, ready } = useTransactionStore.getState()
    if (!ready) return   // işlemler henüz yüklenmedi; reloadAllStores zaten hesaplayacak
    useAccountStore.getState().recomputeBalances(transactions)
  }, [prices])

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
      const prevDay = lastDay
      lastDay = day
      const { transactions } = useTransactionStore.getState()
      useAccountStore.getState().recomputeBalances(transactions)
      // Ay döndüyse ve kullanıcı ay gezintisi yapmamışsa (seçili ay hâlâ biten
      // ay) dashboard/bütçe kartları yeni aya geçsin — günlerce açık kalan PWA'da
      // "Bu ay harcama limitleri" önceki ayda takılı kalıyordu.
      if (prevDay.slice(0, 7) !== day.slice(0, 7)) {
        const { selectedPeriod, setPeriod } = useUIStore.getState()
        const [py, pm] = prevDay.split('-').map(Number)
        if (selectedPeriod.year === py && selectedPeriod.month === pm) setPeriod(currentMonthYear())
      }
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
