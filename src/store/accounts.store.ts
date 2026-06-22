'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
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
    const accounts = await db.accounts.toArray()
    // initialBalance may be missing on accounts created before v3 migration runs.
    // Fall back to balance so they render something reasonable until migration applies.
    set({
      accounts: accounts.map(a => ({ ...a, initialBalance: a.initialBalance ?? a.balance })),
      loading: false,
      ready: true,
    })
  },

  add: async (account) => {
    await db.accounts.add(account)
    set(s => ({ accounts: [...s.accounts, account] }))
  },

  update: async (id, patch) => {
    await db.accounts.update(id, patch)
    set(s => ({
      accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a),
    }))
  },

  remove: async (id) => {
    await db.accounts.delete(id)
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

  // No-op stub — call sites will be removed incrementally.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateBalance: async (_id, _delta) => {},

  getById: (id) => get().accounts.find(a => a.id === id),
}))
