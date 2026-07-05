'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase, nullifyUndefined } from '@/lib/supabase'
import { computeTransactionEffect } from '@/lib/utils/calculations'
import type { Account, InvestmentTransaction, Transaction } from '@/types'
import { useTransactionStore } from './transactions.store'
import { useDebtStore } from './debts.store'
import { useRecurringStore } from './recurring.store'
import { useInvestmentStore } from './investment.store'
import { getUserId } from '@/lib/auth'

interface AccountState {
  accounts: Account[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (account: Account) => Promise<void>
  update: (id: string, patch: Partial<Account>) => Promise<void>
  remove: (id: string) => Promise<void>
  recomputeBalances: (transactions: Transaction[]) => void
  /** @deprecated Balance is now computed. Kept as no-op so call sites compile until removed. */
  updateBalance: (id: string, delta: number) => Promise<void>
  getById: (id: string) => Account | undefined
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  accounts: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    const { data, error } = await supabase.from('accounts').select('*')
    if (!error) {
      // balance DB'de yok — placeholder olarak initialBalance kullan, DataProvider'da recomputeBalances düzeltir
      const accounts: Account[] = (data ?? []).map(a => ({
        ...a,
        balance: a.initialBalance ?? 0,
      }))
      await db.transaction('rw', db.accounts, async () => {
        await db.accounts.clear()
        await db.accounts.bulkAdd(accounts)
      })
      set({ accounts, loading: false, ready: true })
    } else {
      console.error('[supabase:accounts:load]', error)
      const raw = await db.accounts.toArray()
      const accounts = raw.map(a => ({ ...a, initialBalance: a.initialBalance ?? a.balance }))
      set({ accounts, loading: false, ready: true })
    }
  },

  add: async (account) => {
    await db.accounts.add(account)
    const userId = await getUserId()
    const { balance: _b, ...accountForDb } = account
    supabase.from('accounts').insert({ ...accountForDb, ...(userId && { user_id: userId }) }).then(({ error }) => {
      if (error) console.error('[supabase:accounts:insert]', error)
    })
    set(s => ({ accounts: [...s.accounts, account] }))
  },

  update: async (id, patch) => {
    await db.accounts.update(id, patch)
    // balance runtime'da hesaplanır, Supabase şemasında kolonu yok
    const { balance: _b, ...patchForDb } = patch as Partial<Account>
    supabase.from('accounts').update(nullifyUndefined(patchForDb)).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:accounts:update]', error)
    })
    set(s => ({
      accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a),
    }))
  },

  remove: async (id) => {
    // 1. Bağlı tüm işlemleri tam olarak çek (debtId kontrolü için obje gerekiyor)
    const linkedTxs = await db.transactions
      .filter(t => t.accountId === id || t.toAccountId === id)
      .toArray() as Transaction[]
    const linkedTxIds = linkedTxs.map(t => t.id)

    // 2. Borç bağlantılı işlemlerin ödeme miktarlarını geri al
    for (const tx of linkedTxs) {
      if (tx.debtId) {
        await useDebtStore.getState().adjustPaidAmount(tx.debtId, -tx.amount)
      }
    }

    // 3. İşlemleri fiziksel olarak sil
    if (linkedTxIds.length > 0) {
      await db.transactions.bulkDelete(linkedTxIds)
      supabase.from('transactions').delete().in('id', linkedTxIds).then(({ error }) => {
        if (error) console.error('[supabase:transactions:cascade-delete]', error)
      })
    }

    // 4. Hesabı fiziksel olarak sil
    await db.accounts.delete(id)
    supabase.from('accounts').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:accounts:delete]', error)
    })

    // 4b. Bu hesaba bağlı tekrarlayan işlemleri sil — aksi halde silinmiş
    // hesaba yeni işlemler üretilmeye devam eder
    const recurringStore = useRecurringStore.getState()
    const linkedRecurring = recurringStore.recurring.filter(r => r.accountId === id || r.toAccountId === id)
    for (const r of linkedRecurring) {
      await recurringStore.remove(r.id)
    }

    // 4c. Yatırım işlemlerindeki hesap referanslarını temizle (linked tx'ler
    // adım 3'te silindi; referanslar dangling kalmasın)
    const investStore = useInvestmentStore.getState()
    const linkedInvest = investStore.transactions.filter(t => t.sourceAccountId === id || t.targetAccountId === id)
    for (const t of linkedInvest) {
      const patch: Partial<InvestmentTransaction> = { linkedTransactionId: undefined }
      if (t.sourceAccountId === id) patch.sourceAccountId = undefined
      if (t.targetAccountId === id) patch.targetAccountId = undefined
      await db.investmentTransactions.update(t.id, patch)
      supabase.from('investment_transactions').update(nullifyUndefined(patch)).eq('id', t.id).then(({ error }) => {
        if (error) console.error('[supabase:investment_transactions:unlink-account]', error)
      })
    }
    if (linkedInvest.length > 0) {
      const linkedIds = new Set(linkedInvest.map(t => t.id))
      useInvestmentStore.setState(s => ({
        transactions: s.transactions.map(t => linkedIds.has(t.id)
          ? {
              ...t,
              linkedTransactionId: undefined,
              ...(t.sourceAccountId === id && { sourceAccountId: undefined }),
              ...(t.targetAccountId === id && { targetAccountId: undefined }),
            }
          : t),
      }))
    }

    // 4d. Borçların bu hesaba işaret eden ödeme hesabı bağlantısını temizle
    const debtStore = useDebtStore.getState()
    for (const d of debtStore.debts.filter(d => d.accountId === id)) {
      await debtStore.update(d.id, { accountId: undefined })
    }

    // 5. Store'ları güncelle
    const remainingTxs = useTransactionStore.getState().transactions.filter(
      t => t.accountId !== id && t.toAccountId !== id,
    )
    useTransactionStore.setState({ transactions: remainingTxs })
    set(s => ({ accounts: s.accounts.filter(a => a.id !== id) }))
    // 6. Kalan hesapların bakiyelerini yeniden hesapla (transfer işlemleri etkilenmiş olabilir)
    get().recomputeBalances(remainingTxs)
  },

  recomputeBalances: (transactions) => {
    set(s => ({
      accounts: s.accounts.map(a => ({
        ...a,
        balance: a.initialBalance + computeTransactionEffect(a.id, transactions),
      })),
    }))
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateBalance: async (_id, _delta) => {},

  getById: (id) => get().accounts.find(a => a.id === id),
}))
