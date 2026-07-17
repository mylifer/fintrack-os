'use client'

import { useTransactionStore } from '@/store/transactions.store'
import { useRecurringStore } from '@/store/recurring.store'
import { recurringOccurrences } from '@/lib/utils/recurrence'
import { deterministicUuid } from '@/lib/utils/id'
import { today } from '@/lib/utils/date'
import type { RecurringTransaction } from '@/types'

/* Tekrarlayan şablon onay aksiyonları — recurring sayfası, dashboard ve
   bildirim paneli AYNI mantığı kullanır (ikileme yok). Kaçırılan her dönem için
   bir işlem üretilir (catch-up); id'ler deterministiktir, aynı (şablon, tarih)
   çifti hangi yüzeyden onaylanırsa onaylansın aynı satıra gider — çift üretim
   imkânsız. Üretim onay ANI olduğu için satırlar 'approved' doğar. */

/** Vadesi gelmiş tüm dönemleri üretir ve şablonu ileri sarar (markGenerated). */
export async function approveRecurring(r: RecurringTransaction, asOf: string = today()): Promise<void> {
  const txStore = useTransactionStore.getState()
  // Idempotency: deterministik id zaten kayıtlıysa (çift tık / ikinci sekme /
  // başka yüzeyden eşzamanlı onay) o dönem atlanır, şablon yine ileri sarılır.
  const existing = new Set(txStore.transactions.map(t => t.id))
  const now = new Date().toISOString()
  for (const occ of recurringOccurrences(r, asOf)) {
    const id = deterministicUuid(`recur:${r.id}:${occ}`)
    if (existing.has(id)) continue
    await txStore.add({
      id,
      type:           r.type,
      amount:         r.amount,
      currency:       r.currency,
      date:           occ,
      accountId:      r.accountId,
      toAccountId:    r.toAccountId,
      categoryId:     r.categoryId,
      description:    r.description,
      notes:          r.notes,
      isInstallment:  false,
      familyMemberId: r.familyMemberId,
      recipientId:    r.recipientId,
      approvalStatus: 'approved',   // onay anında üretildi — normal post kuralı işler
      approvedAt:     now,
      createdAt:      now,
      updatedAt:      now,
    })
  }
  await useRecurringStore.getState().markGenerated(r.id, asOf)
}

/** Bekleyen dönem(ler)i üretmeden atlar (nextDueDate ileri sarılır). */
export async function skipRecurring(id: string, asOf: string = today()): Promise<void> {
  await useRecurringStore.getState().skip(id, asOf)
}
