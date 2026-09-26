'use client'

import {
  useAccountStore, useTransactionStore, useCategoryStore,
  useBudgetStore, useDebtStore, useInvestmentStore, usePeopleStore,
  useRecurringStore, usePaymentsStore, useGoalsStore, useWorkspaceStore,
} from '@/store'
import { runCategoryRestructurePass } from '@/lib/category-restructure'
import type { SyncTable } from '@/lib/sync/engine'

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
  const { load: loadPayments } = usePaymentsStore.getState()
  const { load: loadGoals } = useGoalsStore.getState()

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
    loadPayments(),   // ödeme takibi: hesaplara/borçlara/işlemlere referans verir
    loadGoals(),      // birikim hedefleri: hesaplara referans verir
  ])

  // Tek seferlik kategori düzeni geçişi — işlem/bütçe/tekrarlayan bağlarını da
  // taşıdığı için Faz 2'den SONRA koşmalı. Hatası açılışı yarıda kesmesin.
  await runCategoryRestructurePass().catch(err => console.error('[category-restructure]', err))

  const { transactions } = useTransactionStore.getState()
  recomputeBalances(transactions)
}

/** Tek bir tablonun store'unu yeniden yükler — canlı senkron (sync/realtime)
 *  başka cihazdaki bir değişikliği bildirdiğinde. Bakiyeler hesap ya da işlem
 *  değişince yeniden hesaplanır; aktif çalışma alanı düştüyse hepsi yenilenir. */
export async function reloadTable(table: SyncTable): Promise<void> {
  const recompute = () =>
    useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)

  switch (table) {
    case 'transactions':
      await useTransactionStore.getState().load()
      recompute()
      break
    case 'accounts':
      await useAccountStore.getState().load()
      recompute()
      break
    case 'categories':             await useCategoryStore.getState().load(); break
    case 'budgets':                await useBudgetStore.getState().load(); break
    case 'debts':                  await useDebtStore.getState().load(); break
    case 'investment_transactions': await useInvestmentStore.getState().load(); break
    case 'people':                 await usePeopleStore.getState().load(); break
    case 'recurring_transactions': await useRecurringStore.getState().load(); break
    case 'payment_plans':
    case 'payment_occurrences':    await usePaymentsStore.getState().load(); break
    case 'savings_goals':          await useGoalsStore.getState().load(); break
    case 'workspaces': {
      const before = useWorkspaceStore.getState().activeId
      await useWorkspaceStore.getState().load()
      if (useWorkspaceStore.getState().activeId !== before) await reloadAllStores()
      break
    }
  }
}
