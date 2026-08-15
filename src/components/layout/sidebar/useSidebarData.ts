'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { supabase } from '@/lib/supabase'
import { clearLocalData } from '@/lib/auth'
import { retryDeadLetters, pendingCount } from '@/lib/sync/engine'
import {
  useAccountStore, useInvestmentStore, useRecurringStore,
  useTransactionStore, useBudgetStore, useCategoryStore,
} from '@/store'
import { calcNetWorth, computeTransactionEffect, isPosted } from '@/lib/utils/calculations'
import { computeHoldings } from '@/store/investment.store'
import { today, currentMonthYear, prevMonth, monthRange } from '@/lib/utils/date'
import { useCountUp } from '@/lib/hooks/useCountUp'

/* Her iki kenar çubuğu varyantının ortak beyni: veri, açılır menü durumu ve
   çıkış akışı burada; varyant dosyaları yalnızca görünümden sorumlu. Aynı anda
   tek varyant render edildiği için bu hesaplar tek kez çalışır. */
export function useSidebarData() {
  const pathname = usePathname()

  const accounts    = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices      = useInvestmentStore(s => s.prices)
  const fundPrices  = useInvestmentStore(s => s.fundPrices)
  const investTxs   = useInvestmentStore(s => s.transactions)
  const investValue = useMemo(
    () => prices ? computeHoldings(investTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0) : 0,
    [investTxs, prices, fundPrices],
  )
  const transactions = useTransactionStore(useShallow(s => s.transactions))
  const getDue       = useRecurringStore(s => s.getDue)
  const dueCount     = getDue(today()).length

  const totalWealth     = calcNetWorth(accounts, prices) + investValue
  const animTotalWealth = useCountUp(totalWealth)

  const trendAmount = useMemo(() => {
    const cutoff = monthRange(prevMonth(currentMonthYear())).to
    const prevTxs = transactions.filter(t => isPosted(t, cutoff))
    const prevAccounts = accounts.map(a => ({
      ...a,
      balance: a.initialBalance + computeTransactionEffect(a, prevTxs),
    }))
    const prevAccountNetWorth = calcNetWorth(prevAccounts, prices)
    const prevInvestTxs = investTxs.filter(t => t.date <= cutoff)
    const prevInvestValue = computeHoldings(prevInvestTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0)
    return totalWealth - (prevAccountNetWorth + prevInvestValue)
  }, [accounts, transactions, investTxs, prices, fundPrices, totalWealth])

  // Geçen ay sıfır (veya yoksa) yüzde tanımsız — oran yerine yalnızca tutar gösterilir.
  const prevWealth = totalWealth - trendAmount
  const trendPct   = prevWealth !== 0 ? (trendAmount / Math.abs(prevWealth)) * 100 : null

  const budgets       = useBudgetStore(useShallow(s => s.budgets.filter(b => b.period === 'monthly')))
  const allCategories = useCategoryStore(useShallow(s => s.categories))

  const isOnAccounts = pathname === '/accounts' || pathname.startsWith('/accounts/')
  const [accountsOpen, setAccountsOpen] = useState(isOnAccounts)
  useEffect(() => {
    if (isOnAccounts) setAccountsOpen(true)
  }, [isOnAccounts])

  const isOnBudgets = pathname === '/budgets' || pathname.startsWith('/budgets/')
  const [budgetsOpen, setBudgetsOpen] = useState(isOnBudgets)
  useEffect(() => {
    if (isOnBudgets) setBudgetsOpen(true)
  }, [isOnBudgets])

  return {
    pathname,
    accounts,
    budgets,
    allCategories,
    dueCount,
    totalWealth,
    animTotalWealth,
    trendAmount,
    trendPct,
    isOnAccounts, accountsOpen, setAccountsOpen,
    isOnBudgets,  budgetsOpen,  setBudgetsOpen,
    handleSignOut,
  }
}

export async function handleSignOut() {
  // Çıkış, yerel Dexie'yi VE bekleyen sync kuyruğunu siler — buluta henüz
  // ulaşmamış her kayıt kalıcı olarak yok olur. Önce kuyruğu boşaltmayı
  // dene (dead-letter'lara da son bir şans ver); hâlâ bekleyen varsa
  // kullanıcı açıkça onaylamadan devam etme.
  try {
    await retryDeadLetters()
    const waiting = await pendingCount()
    if (waiting > 0) {
      const ok = window.confirm(
        `${waiting} kayıt henüz buluta senkronlanmadı. Şimdi çıkarsanız bu kayıtlar KALICI olarak silinir.\n\nYine de çıkmak istiyor musunuz?`,
      )
      if (!ok) return
    }
  } catch (err) {
    console.error('[signout:flush]', err)
    const ok = window.confirm(
      'Senkron durumu doğrulanamadı; çıkış, buluta ulaşmamış kayıtları silebilir.\n\nYine de çıkmak istiyor musunuz?',
    )
    if (!ok) return
  }
  try {
    await clearLocalData()
  } catch (err) {
    // Yerel temizlik başarısız olsa bile oturumu kapat
    console.error('[signout:clearLocalData]', err)
  }
  try {
    // signOut çevrimdışıyken hata fırlatabilir; yönlendirme yine de çalışmalı.
    await supabase.auth.signOut()
  } catch (err) {
    console.error('[signout:supabase]', err)
  } finally {
    // HARD reload (soft router.push değil): bellekteki Zustand store'larını ve
    // DataProvider'ın modül-seviyesi init kilidini sıfırlar. Aksi halde aynı
    // sekmede ikinci kullanıcı, birinci kullanıcının verisini ekranda görürdü.
    window.location.assign('/login')
  }
}
