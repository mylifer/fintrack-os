import { toMinor, toMajor } from './money'
import type { Account, Transaction } from '@/types'

/* İşlem-sonrası ("güncel") bakiye haritası — tx.id → o işlem işlendikten SONRAKİ
   hesap bakiyesi. Tek doğruluk kaynağı: işlem listesinin tablo görünümü, zaman
   çizelgesi ve takvim aynı sayıyı göstersin diye buradan okur.

   Naif yaklaşım (her satır için defteri baştan toplamak) O(hesap × N log N)
   olurdu; burada defter BİR kez kronolojik sıralanıp tek geçişte süpürülür.
   Bir işleme birden çok izlenen hesap dokunuyorsa `accountIds` sırasında EN SON
   gelen hesabın bakiyesi yazılır (çağıran, öncelikli hesabı sona koyar). */
export function computeRunningBalances(
  /** Yürünecek defter. Planlanan (henüz kaydedilmemiş) işlemler de verilirse
   *  ileriye dönük projeksiyon bakiyesi üretilir. */
  ledger: Transaction[],
  /** Bakiyesi izlenecek hesap id'leri, artan öncelik sırasında. */
  accountIds: string[],
  accById: Map<string, Account>,
): Map<string, number> {
  const map = new Map<string, number>()

  const order    = new Map<string, number>()   // hesap → accountIds sırası
  const balances = new Map<string, number>()   // hesap → minor birim (kuruş)
  accountIds.forEach((id, i) => {
    const account = accById.get(id)
    if (!account) return
    order.set(id, i)
    balances.set(id, toMinor(account.initialBalance))
  })
  if (balances.size === 0) return map

  const sorted = [...ledger].sort((a, b) =>
    (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')),
  )

  for (const tx of sorted) {
    // Onay kapısı: pending satır bakiyeye hiç işlenmez (isPosted ile tutarlı) —
    // satırın "Güncel Bakiye" hücresi boş kalır.
    if (tx.approvalStatus === 'pending') continue
    let winner: string | undefined
    let winnerRank = -1
    const consider = (id: string) => {
      const rank = order.get(id)
      if (rank !== undefined && rank > winnerRank) { winnerRank = rank; winner = id }
    }

    if (tx.type === 'income' && balances.has(tx.accountId)) {
      balances.set(tx.accountId, balances.get(tx.accountId)! + toMinor(tx.amount))
      consider(tx.accountId)
    } else if (tx.type === 'expense' && balances.has(tx.accountId)) {
      balances.set(tx.accountId, balances.get(tx.accountId)! - toMinor(tx.amount))
      consider(tx.accountId)
    } else if (tx.type === 'transfer') {
      if (balances.has(tx.accountId)) {
        balances.set(tx.accountId, balances.get(tx.accountId)! - toMinor(tx.amount))
        consider(tx.accountId)
      }
      if (tx.toAccountId && balances.has(tx.toAccountId)) {
        balances.set(tx.toAccountId, balances.get(tx.toAccountId)! + toMinor(tx.amount))
        consider(tx.toAccountId)
      }
    }

    if (winner !== undefined) map.set(tx.id, toMajor(balances.get(winner)!))
  }
  return map
}
