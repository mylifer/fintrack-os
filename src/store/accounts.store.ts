'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { computeTransactionEffect } from '@/lib/utils/calculations'
import type { Account, Transaction } from '@/types'

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
    const raw = await db.accounts.toArray()
    const accounts = raw.map(a => ({ ...a, initialBalance: a.initialBalance ?? a.balance }))
    set({ accounts, loading: false, ready: true })
    // Tüm lokal hesapları Supabase'e upsert et — transactions FK'sını karşılamak için
    // await: DataProvider Phase 1'de bu bitince child'lar yükleniyor
    if (accounts.length > 0) {
      const accountsForDb = accounts.map(({ balance: _b, ...rest }) => rest)
      const { error } = await supabase.from('accounts').upsert(accountsForDb, { onConflict: 'id' })
      if (error) console.error('[supabase:accounts:sync]', error)
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
    await db.accounts.delete(id)
    supabase.from('accounts').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('[supabase:accounts:delete]', error)
    })
    set(s => ({ accounts: s.accounts.filter(a => a.id !== id) }))
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
