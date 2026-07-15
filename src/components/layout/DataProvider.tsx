'use client'

import { useEffect, type ReactNode } from 'react'
import {
  useAccountStore, useTransactionStore, useCategoryStore,
  useBudgetStore, useDebtStore, useInvestmentStore, usePeopleStore,
  useRecurringStore,
} from '@/store'
import { startAutoSync } from '@/lib/sync/engine'
import { today } from '@/lib/utils/date'
import { maybeAutoBackup } from '@/lib/auto-backup'

// Modül seviyesinde tekil koruma: StrictMode'da effect iki kez çalışır ve iki
// eşzamanlı init, initDefaults'un "mevcutları oku → eksikleri ekle" akışını
// yarıştırıp varsayılan kategorileri çiftler. Aynı sayfa oturumunda init bir kez koşar.
let initPromise: Promise<void> | null = null

export function DataProvider({ children }: { children: ReactNode }) {
  const loadAccounts              = useAccountStore(s => s.load)
  const loadTransactions          = useTransactionStore(s => s.load)
  const loadCategories            = useCategoryStore(s => s.load)
  const initCategories            = useCategoryStore(s => s.initDefaults)
  const loadBudgets               = useBudgetStore(s => s.load)
  const loadDebts                 = useDebtStore(s => s.load)
  const loadInvestments           = useInvestmentStore(s => s.load)
  const fetchPrices               = useInvestmentStore(s => s.fetchPrices)
  const loadPeople                = usePeopleStore(s => s.load)
  const loadRecurring             = useRecurringStore(s => s.load)
  const reprocessSellLinkedTxs    = useInvestmentStore(s => s.reprocessSellLinkedTxs)

  useEffect(() => {
    async function init() {
      // Phase 1: FK parent tablolarını Supabase'e upsert et (await).
      // transactions/budgets/recurring bu tablolara FK referans verdiği için
      // child'lar yüklenmeden önce Supabase'de hazır olmaları şart.
      await Promise.all([
        loadAccounts(),
        loadCategories().then(initCategories),
        loadDebts(),
        loadPeople(),
      ])

      // Phase 2: FK child tabloları yükle + arka planda Supabase'e sync et.
      await Promise.all([
        loadTransactions(),
        loadBudgets(),
        loadInvestments(),
        loadRecurring(),
        fetchPrices(),
      ])

      reprocessSellLinkedTxs().catch(err => {
        console.error('[init:reprocessSellLinkedTxs]', err)
      })
      const { recomputeBalances } = useAccountStore.getState()
      const { transactions }      = useTransactionStore.getState()
      recomputeBalances(transactions)

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
  }, [loadAccounts, loadTransactions, loadCategories, initCategories, loadBudgets, loadDebts, loadInvestments, fetchPrices, loadPeople, loadRecurring, reprocessSellLinkedTxs])

  // Gün değişince bakiyeleri yeniden hesapla: gelecek tarihli işlemler güncel
  // bakiyeye dahil edilmez, günü gelen işlem o gün bakiyeye işlenir. Uygulama
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
