'use client'

import {
  useAccountStore, useTransactionStore, useCategoryStore,
  useBudgetStore, useDebtStore, useInvestmentStore, usePeopleStore,
  useRecurringStore,
} from '@/store'

/* Tüm veri store'larını (fiyat feed'i / sync altyapısı HARİÇ — bunlar
   workspace'e özgü değil, uygulama ömrü boyunca bir kez kurulur) yeniden
   yükler. Hem DataProvider'ın ilk açılış akışı hem de çalışma alanı
   değiştirildiğinde (workspace.store.ts) kullanılır — ayrı bir "yerelden
   yükle" yolu icat etmeye gerek yok: reconcilingPull zaten aktif çalışma
   alanına göre filtreliyor (bkz. src/lib/sync/engine.ts). */
export async function reloadAllStores(): Promise<void> {
  const { load: loadAccounts, recomputeBalances } = useAccountStore.getState()
  const { load: loadCategories, initDefaults: initCategories } = useCategoryStore.getState()
  const { load: loadDebts } = useDebtStore.getState()
  const { load: loadPeople } = usePeopleStore.getState()
  const { load: loadTransactions } = useTransactionStore.getState()
  const { load: loadBudgets } = useBudgetStore.getState()
  const { load: loadInvestments } = useInvestmentStore.getState()
  const { load: loadRecurring } = useRecurringStore.getState()

  // Phase 1: FK parent tabloları — child'lar yüklenmeden önce hazır olmalı.
  // Yeni/boş bir çalışma alanı için initCategories() varsayılan kategorileri
  // otomatik oluşturur (initDefaults zaten var olanları atlar — idempotent).
  await Promise.all([
    loadAccounts(),
    loadCategories().then(initCategories),
    loadDebts(),
    loadPeople(),
  ])

  // Phase 2: FK child tabloları.
  await Promise.all([
    loadTransactions(),
    loadBudgets(),
    loadInvestments(),
    loadRecurring(),
  ])

  const { transactions } = useTransactionStore.getState()
  recomputeBalances(transactions)
}
