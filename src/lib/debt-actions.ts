'use client'

import type { Debt, Transaction } from '@/types'
import { db } from '@/lib/db'
import { localBatch, type BatchOp } from '@/lib/sync/engine'
import { isLive } from '@/lib/sync/tombstone'
import { baseAmount } from '@/lib/utils/fx'
import { debtLinkedTransactions } from '@/lib/utils/debt-links'
import { useAccountStore } from '@/store/accounts.store'
import { useDebtStore, debtPaymentPatches } from '@/store/debts.store'
import { useTransactionStore } from '@/store/transactions.store'
import { useUndoStore } from '@/store/undo.store'

/* Borç silme — denetim #12 (ürün kararı): borç silinince bağlı anapara ve
   ödeme işlemleri de HER ZAMAN silinir; onay penceresi bunu açıkça uyarır.
   Eskiden varsayılan silme işlemlere dokunmuyordu ve anapara satırı (soneki
   yüzünden) akış toplamlarından kalıcı dışlanmış, hiçbir borca ait olmayan
   satır olarak kalıyordu.

   • Borç + işlemler + alanlar arası transferin karşı bacakları TEK IndexedDB
     işleminde (localBatch) tombstone'lanır: ya hepsi ya hiçbiri.
   • Silinen borcun paidAmount'u yamalanmaz (borç zaten gidiyor; undo onu
     dokunulmamış haliyle geri getirir) → ödeme katkısı çift geri alınmaz.
     Yalnız karşı bacaklardan biri BAŞKA bir borcun ödemesiyse o borcun katkısı
     aynı blokta geri alınır (transactions.store remove ile aynı kural).
   • Karşı bacaklar ham Dexie'den, yalnız CANLI olanlar alınır: zaten silinmiş
     bir satır yeniden silinmez, undo onu diriltmez (bkz. accounts.store isLive).
   • Tek "geri al" hepsini birlikte geri getirir. */

async function findTransferPeers(group: Transaction[]): Promise<Transaction[]> {
  const seen = new Set(group.map(t => t.id))
  const linkIds = new Set(group.flatMap(t => (t.workspaceTransferId ? [t.workspaceTransferId] : [])))
  const peers: Transaction[] = []
  for (const linkId of linkIds) {
    const rows = await db.transactions.where('workspaceTransferId').equals(linkId).toArray() as Transaction[]
    for (const p of rows) {
      if (seen.has(p.id) || !isLive(p)) continue
      seen.add(p.id)
      peers.push(p)
    }
  }
  return peers
}

function byNewest(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
}

export interface DebtDeletionPlan {
  /** Silinecek TÜM işlemler: bağlı satırlar + transfer karşı bacakları. */
  transactions: Transaction[]
  /** Bunlardan aktif çalışma alanında (bellekte) OLMAYANLAR. */
  otherWorkspaceCount: number
}

/** Silme ile onay penceresinin ORTAK kaynağı — pencerede gösterilen sayı ile
 *  gerçekte silinen küme ayrışamasın. */
export async function debtDeletionPlan(debt: Debt): Promise<DebtDeletionPlan> {
  const inMemory = useTransactionStore.getState().transactions.filter(isLive)
  const linked = debtLinkedTransactions(debt, inMemory)
  const peers = await findTransferPeers(linked)
  const memIds = new Set(inMemory.map(t => t.id))
  return {
    transactions: [...linked, ...peers],
    otherWorkspaceCount: peers.filter(p => !memIds.has(p.id)).length,
  }
}

export async function deleteDebtWithTransactions(debt: Debt): Promise<void> {
  const { transactions: all } = await debtDeletionPlan(debt)
  const ids = all.map(t => t.id)

  // Başka borçlara ait ödemeler (yalnız karşı bacaklarda olabilir)
  const otherPayments = all
    .filter(t => t.debtId && t.debtId !== debt.id)
    .map(t => ({ debtId: t.debtId!, amount: baseAmount(t) }))

  const batch = async (deleted: boolean) => {
    const patches = await debtPaymentPatches(otherPayments, deleted ? -1 : 1)
    const ts = deleted ? new Date().toISOString() : null
    const ops: BatchOp[] = [
      { kind: 'patch', table: 'debts', id: debt.id, patch: { deleted_at: ts } },
      ...(ids.length > 0 ? [{ kind: 'patchMany' as const, table: 'transactions' as const, ids, patch: { deleted_at: ts } }] : []),
      ...[...patches].map(([id, patch]): BatchOp => ({ kind: 'patch', table: 'debts', id, patch })),
    ]
    await localBatch(ops)
    useDebtStore.getState().applyLocal(patches)
  }

  await batch(true)

  const removed = new Set(ids)
  const removedInMemory = useTransactionStore.getState().transactions.filter(t => removed.has(t.id))
  useDebtStore.setState(s => ({ debts: s.debts.filter(d => d.id !== debt.id) }))
  const remaining = useTransactionStore.getState().transactions.filter(t => !removed.has(t.id))
  useTransactionStore.setState({ transactions: remaining })
  useAccountStore.getState().recomputeBalances(remaining)

  const label = ids.length > 0 ? `Borç ve ${ids.length} işlemi silindi` : 'Borç silindi'
  useUndoStore.getState().pushUndo(label, async () => {
    await batch(false)
    useDebtStore.setState(s => ({ debts: [...s.debts.filter(d => d.id !== debt.id), debt] }))
    const current = useTransactionStore.getState().transactions
    const next = [...removedInMemory.filter(t => !current.some(c => c.id === t.id)), ...current].sort(byNewest)
    useTransactionStore.setState({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  })
}
