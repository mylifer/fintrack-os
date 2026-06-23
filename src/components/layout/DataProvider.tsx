'use client'

import { useEffect, type ReactNode } from 'react'
import {
  useAccountStore, useTransactionStore, useCategoryStore,
  useBudgetStore, useDebtStore, useInvestmentStore, usePeopleStore,
  useRecurringStore,
} from '@/store'

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
    Promise.all([
      loadAccounts(),
      loadTransactions(),
      loadCategories().then(initCategories),
      loadBudgets(),
      loadDebts(),
      loadInvestments(),
      loadPeople(),
      loadRecurring(),
      fetchPrices(),
    ]).then(() => {
      reprocessSellLinkedTxs()
      const { recomputeBalances } = useAccountStore.getState()
      const { transactions }      = useTransactionStore.getState()
      recomputeBalances(transactions)
    })
  }, [loadAccounts, loadTransactions, loadCategories, initCategories, loadBudgets, loadDebts, loadInvestments, fetchPrices, loadPeople, loadRecurring, reprocessSellLinkedTxs])

  return <>{children}</>
}
