'use client'

import type { Debt } from '@/types'
import { localBatch } from '@/lib/sync/engine'
import { debtLinkedTransactions } from '@/lib/utils/debt-links'
import { useAccountStore, useDebtStore, useTransactionStore } from '@/store'
import { useUndoStore } from '@/store/undo.store'

/* Borç silme — denetim #12: borç silinince bağlı ödeme ve anapara işlemleri
   yetim kalıyordu (hesap bakiyesini etkileyen ama hiçbir borca ait olmayan
   satırlar). Bilinçli karar korunur: VARSAYILAN silme işlemlere dokunmaz
   (ödenip kapanmış bir borç temizlenirken ödemeler gerçekten yapılmıştır).
   Kullanıcı "bağlı işlemleri de sil" derse (yanlış girilmiş borç) borç ve
   işlemleri TEK IndexedDB işleminde silinir ve tek "geri al" ile geri gelir.
   Borç da silindiği için ödemelerin borca katkısı ayrıca geri alınmaz. */

export async function deleteDebtWithTransactions(debt: Debt): Promise<void> {
  const txStore = useTransactionStore.getState()
  const linked = debtLinkedTransactions(debt, txStore.transactions)
  const ids = linked.map(t => t.id)
  const ts = new Date().toISOString()

  await localBatch([
    { kind: 'patch', table: 'debts', id: debt.id, patch: { deleted_at: ts } },
    { kind: 'patchMany', table: 'transactions', ids, patch: { deleted_at: ts } },
  ])

  const removed = new Set(ids)
  useDebtStore.setState(s => ({ debts: s.debts.filter(d => d.id !== debt.id) }))
  const remaining = useTransactionStore.getState().transactions.filter(t => !removed.has(t.id))
  useTransactionStore.setState({ transactions: remaining })
  useAccountStore.getState().recomputeBalances(remaining)

  useUndoStore.getState().pushUndo(`Borç ve ${ids.length} işlemi silindi`, async () => {
    await localBatch([
      { kind: 'patch', table: 'debts', id: debt.id, patch: { deleted_at: null } },
      { kind: 'patchMany', table: 'transactions', ids, patch: { deleted_at: null } },
    ])
    useDebtStore.setState(s => ({ debts: [...s.debts, debt] }))
    // Sıralı geri koymak için store'un kendi yüklemesi (Dexie'den) kullanılır
    await useTransactionStore.getState().load()
    useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)
  })
}

/** Silme penceresinde gösterilecek bağlı işlem sayısı. */
export function linkedTransactionCount(debt: Debt): number {
  return debtLinkedTransactions(debt, useTransactionStore.getState().transactions).length
}
