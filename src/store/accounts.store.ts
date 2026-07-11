'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { computeTransactionEffect } from '@/lib/utils/calculations'
import type { Account, InvestmentTransaction, Transaction } from '@/types'
import { useTransactionStore } from './transactions.store'
import { useDebtStore } from './debts.store'
import { useRecurringStore } from './recurring.store'
import { useInvestmentStore } from './investment.store'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, localBatch, reconcilingPull } from '@/lib/sync/engine'
import { baseAmount } from '@/lib/utils/fx'

interface AccountState {
  accounts: Account[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (account: Account) => Promise<void>
  update: (id: string, patch: Partial<Account>) => Promise<void>
  remove: (id: string) => Promise<void>
  recomputeBalances: (transactions: Transaction[]) => void
  getById: (id: string) => Account | undefined
}

export const useAccountStore = create<AccountState>()((set, get) => ({
  accounts: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    // Reconciling pull (C2) + pagination (C6). Cloud accounts have no `balance`
    // column — seed a placeholder; DataProvider.recomputeBalances corrects it.
    try {
      const raw = await reconcilingPull<Account>('accounts')
      const accounts = raw.map(a => ({ ...a, balance: a.initialBalance ?? 0 }))
      set({ accounts, loading: false, ready: true })
    } catch (err) {
      console.error('[accounts:load]', err)
      const raw = (await db.accounts.toArray()).filter(isLive)
      const accounts = raw.map(a => ({ ...a, initialBalance: a.initialBalance ?? a.balance }))
      set({ accounts, loading: false, ready: true })
    }
  },

  add: async (account) => {
    // Durable write (C1); the outbox snapshot strips the computed `balance`.
    await localUpsert('accounts', account)
    set(s => ({ accounts: [...s.accounts, account] }))
  },

  update: async (id, patch) => {
    await localPatch('accounts', id, patch)
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

    // 2. Borç bağlantılı işlemlerin ödemelerini geri al (TL bazında, taksit
    //    sayısı da düşürülerek — M3/M4)
    for (const tx of linkedTxs) {
      if (tx.debtId) {
        await useDebtStore.getState().revertPayment(tx.debtId, baseAmount(tx))
      }
    }

    // 3+4. Hesabı VE bağlı işlemleri TEK atomik blokta tombstone'la (C5): ikisi
    // ya birlikte silinir ya da hiç — yarıda kalıp dangling (hesapsız işlem /
    // işlemsiz hesap) bırakmaz. Kalan temizlikler (borç/tekrarlayan/yatırım)
    // outbox üzerinden tek tek dayanıklı kalır.
    const ts = new Date().toISOString()
    await localBatch([
      ...(linkedTxIds.length > 0
        ? [{ kind: 'patchMany' as const, table: 'transactions' as const, ids: linkedTxIds, patch: { deleted_at: ts } }]
        : []),
      { kind: 'patch' as const, table: 'accounts' as const, id, patch: { deleted_at: ts } },
    ])

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
      await localPatch('investment_transactions', t.id, patch as Record<string, unknown>)
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
        balance: a.initialBalance + computeTransactionEffect(a, transactions),
      })),
    }))
  },

  getById: (id) => get().accounts.find(a => a.id === id),
}))
