import { addMonths, format, parseISO } from 'date-fns'
import { recurringOccurrences } from './recurrence'
import { deterministicUuid } from './id'
import type { RecurringTransaction, Transaction, PeriodType } from '@/types'

/* Planlanan (henüz gerçekleşmemiş) işlemler — aktif tekrarlayan şablonların
   [bugün, ufuk] aralığına projekte edilmiş oluşumları. Store/DB importu yok;
   girdi olarak şablon listesi alır, saf Transaction[] döner. */

/** Ufuk, sınırlı dönemlerde (gün/hafta/ay/yıl) seçili dönemin son günüdür;
 *  'Tüm Zamanlar'da bugün+12 ay ile sınırlanır — sınırsız bir şablon aksi halde
 *  sonsuza kadar üretir. Oluşum id'leri gerçek üretimle (recurring sayfası
 *  "Kaydet") aynı deterministik şemayı kullanır, bu yüzden kaydedilmiş bir
 *  işlemle çakışan oluşum `existingIds` üzerinden elenir. Bugünden önceki
 *  (vadesi geçmiş ama üretilmemiş) oluşumlar dahil edilmez — onlar recurring
 *  sayfasının "Bekleyen" bölümünün işidir. */
export function projectPlannedTransactions(opts: {
  recurring: RecurringTransaction[]
  periodType: PeriodType
  /** Seçili dönemin son günü (getPeriodRangeAt'in `to` değeri). */
  periodEnd: string
  todayStr: string
  /** Kaydedilmiş işlem id'leri — çakışan oluşumlar elenir. */
  existingIds: Set<string>
  /** Verilirse yalnızca bu hesaba dokunan (kaynak veya hedef) şablonlar. */
  accountId?: string
}): Transaction[] {
  const { recurring, periodType, periodEnd, todayStr, existingIds, accountId } = opts

  const horizon = periodType === 'all'
    ? format(addMonths(parseISO(todayStr), 12), 'yyyy-MM-dd')
    : periodEnd

  const out: Transaction[] = []
  for (const r of recurring) {
    if (!r.isActive || r.deleted_at) continue
    if (accountId && r.accountId !== accountId && r.toAccountId !== accountId) continue
    for (const occ of recurringOccurrences(r, horizon)) {
      if (occ < todayStr) continue
      const txId = deterministicUuid(`recur:${r.id}:${occ}`)
      if (existingIds.has(txId)) continue
      out.push({
        id:             txId,
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
        createdAt:      occ,
        updatedAt:      occ,
      })
    }
  }
  return out
}
