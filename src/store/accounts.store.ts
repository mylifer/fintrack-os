'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { computeTransactionEffect } from '@/lib/utils/calculations'
import type { Account, Transaction } from '@/types'
import { useTransactionStore } from './transactions.store'

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
    // balance runtime'da hesaplanır, Supabase şemasında kolonu yok
    const { balance: _b, ...accountForDb } = account
    supabase.from('accounts').insert(accountForDb).then(({ error }) => {
      if (error) console.error('[supabase:accounts:insert]', error)
    })
    set(s => ({ accounts: [...s.accounts, account] }))
  },

  update: async (id, patch) => {
    await db.accounts.update(id, patch)
    // balance runtime'da hesaplanır, Supabase şemasında kolonu yok
    const { balance: _b, ...patchForDb } = patch as Partial<Account>
    supabase.from('accounts').update(patchForDb).eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:accounts:update]', error)
    })
    set(s => ({
      accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a),
    }))
  },

  remove: async (id) => {
    // 1. Bağlı tüm işlem ID'lerini bul
    const linkedTxIds = (
      await db.transactions
        .filter(t => t.accountId === id || t.toAccountId === id)
        .primaryKeys()
    ) as string[]

    // 2. İşlemleri fiziksel olarak sil — önce Supabase (FK zorunluluğu yok, ama temiz sıra)
    if (linkedTxIds.length > 0) {
      await db.transactions.bulkDelete(linkedTxIds)
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .in('id', linkedTxIds)
      if (txErr) console.error('[supabase:transactions:cascade-delete]', txErr)
    }

    // 3. Hesabı fiziksel olarak sil
    await db.accounts.delete(id)
    const { error: accErr } = await supabase.from('accounts').delete().eq('id', id)
    if (accErr) console.error('[supabase:accounts:delete]', accErr)

    // 4. Store'ları güncelle
    set(s => ({ accounts: s.accounts.filter(a => a.id !== id) }))
    useTransactionStore.setState(s => ({
      transactions: s.transactions.filter(
        t => t.accountId !== id && t.toAccountId !== id,
      ),
    }))
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
