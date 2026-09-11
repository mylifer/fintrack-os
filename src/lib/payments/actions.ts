'use client'

import type { Transaction } from '@/types'
import { useAccountStore } from '@/store/accounts.store'
import { useDebtStore } from '@/store/debts.store'
import { useTransactionStore } from '@/store/transactions.store'
import { usePaymentsStore, type OccurrencePatch, type OccurrenceWrite } from '@/store/payments.store'
import { fromBaseTry, toBaseTry } from '@/lib/utils/fx'
import { roundMoney } from '@/lib/utils/money'
import { today } from '@/lib/utils/date'
import { paymentTxIdFor } from './ids'
import {
  buildSchedule, dueDateFor, monthOf, paymentDescription, shiftMonth,
  type PaymentRow, type PaymentTarget,
} from './schedule'

/* ── Ödeme takibi eylemleri ──────────────────────────────────────────────────
   Görünümler, modallar ve bildirim merkezi yazma işini buradan yapar. Kurallar:
   • Ödeme işlemi, uygulamanın mevcut akışlarıyla BİREBİR aynı biçimde yazılır:
     kart → kaynak hesaptan karta transfer; borç → debtId'li transfer +
     recordPayment (debts/page.tsx "Ödeme Yap" ile aynı). Böylece bakiye, limit,
     borç ilerlemesi ve silme/geri alma mevcut kodla tutarlı kalır.
   • Açıklama paymentDescription: "Kredi Kartı Ödemesi" / "<borç> Ödemesi".
   • Ödendi işaretlenen ayın tutarı ve tarihi DONDURULUR.
   • Varsayılanlar ileriye dönük değişince geçmiş aylar eski değerleriyle
     sabitlenir (freezeBefore) — "bu ve sonraki aylar" geçmişi yeniden yazmaz. */

export interface PayInput {
  /** Hedefin (kartın/borcun) para biriminde. */
  amount: number
  fromAccountId: string | null
  date: string
  /** false → yalnız "ödendi" işareti; hiçbir bakiye değişmez. */
  createTransaction: boolean
  note?: string | null
  /** Deterministik işlem kimliği (bildirim onayı). Verilmezse rastgele. */
  transactionId?: string
}

export async function payRow(row: PaymentRow, input: PayInput): Promise<void> {
  const { target } = row
  let transactionId: string | null = null

  if (input.createTransaction) {
    const from = useAccountStore.getState().accounts.find(a => a.id === input.fromAccountId)
    if (!from) throw new Error('Ödeme hesabı seçilmedi')
    const txStore = useTransactionStore.getState()
    const id = input.transactionId ?? crypto.randomUUID()
    // Deterministik kimlik zaten kayıtlıysa (çift tık, ikinci sekme) ikinci
    // transfer ve ikinci borç mutabakatı YAPILMAZ; yalnız ay işaretlenir.
    if (!txStore.transactions.some(t => t.id === id)) {
      const amountFrom = from.currency === target.currency
        ? input.amount
        : roundMoney(fromBaseTry(toBaseTry(input.amount, target.currency), from.currency))
      const now = new Date().toISOString()
      const tx: Transaction = {
        id,
        type: 'transfer',
        amount: amountFrom,
        currency: from.currency,
        accountId: from.id,
        date: input.date,
        description: paymentDescription(target),
        isInstallment: false,
        createdAt: now,
        updatedAt: now,
        ...(target.kind === 'card' ? { toAccountId: target.id } : { debtId: target.id }),
        ...(input.note ? { notes: input.note } : {}),
      }
      await txStore.add(tx)
      if (target.kind === 'debt') {
        // Borçlar TRY bazlı — yabancı para hesaptan ödemede dönüştür (M4).
        await useDebtStore.getState().recordPayment(target.id, toBaseTry(amountFrom, from.currency))
      }
    }
    transactionId = id
  }

  // Kısmi tespit edilmiş ayda kalan ödenirse daha önce bulunan tutar da sayılır.
  const alreadyPaid = row.paidVia === 'detected' ? row.paidAmount : 0
  await usePaymentsStore.getState().saveOccurrence(target.kind, target.id, row.month, {
    status: 'paid',
    amount: row.amount ?? input.amount,
    dueDate: row.dueDate,
    fromAccountId: input.fromAccountId ?? row.fromAccountId,
    paidAmount: roundMoney(alreadyPaid + input.amount),
    paidDate: input.date,
    transactionId,
    note: input.note?.trim() || row.note,
  })
}

/** Bildirim merkezinde tek dokunuşla onaylanabilir mi? Değilse nedeni. */
export function quickApproveBlocker(row: PaymentRow): string | null {
  if (row.amount === null) return 'Tutar girilmedi'
  if (row.remaining <= 0) return 'Ödenecek tutar yok'
  const from = useAccountStore.getState().accounts.find(a => a.id === row.fromAccountId && !a.isArchived)
  if (!from) return 'Ödeme hesabı seçilmedi'
  return null
}

/** Bildirim merkezinden onay: vadesi gelen ödeme için BUGÜNÜN tarihiyle, kalan
 *  tutar kadar, satırın ödeme hesabından işlem yazar ve ayı ödendi işaretler.
 *  Onaya kadar hiçbir işlem yazılmaz (tekrarlayanlarla aynı model) — kullanıcı
 *  transferi elle girerse ay tespitle ödendi olur ve bildirim kendiliğinden düşer. */
export async function approvePaymentRow(row: PaymentRow): Promise<void> {
  const blocker = quickApproveBlocker(row)
  if (blocker) throw new Error(blocker)
  await payRow(row, {
    amount: row.remaining,
    fromAccountId: row.fromAccountId,
    date: today(),
    createTransaction: true,
    transactionId: paymentTxIdFor(row.target.kind, row.target.id, row.month),
  })
}

/** "Ödendi" işaretini kaldırır. deleteTransaction → bağlı işlem de silinir
 *  (transactions.store.remove: bakiye + borç geri alınır, geri alma bildirimi
 *  çıkar). İşlem önce silinir; başarısız olursa işaret yerinde kalır. */
export async function unpayRow(row: PaymentRow, opts: { deleteTransaction: boolean }): Promise<void> {
  const txId = row.occurrence?.transactionId
  if (opts.deleteTransaction && txId) {
    const txStore = useTransactionStore.getState()
    if (txStore.transactions.some(t => t.id === txId)) await txStore.remove(txId)
  }
  await usePaymentsStore.getState().saveOccurrence(row.target.kind, row.target.id, row.month, {
    status: null,
    paidAmount: null,
    paidDate: null,
    transactionId: null,
  })
}

export async function setRowStatus(row: PaymentRow, status: 'skipped' | null): Promise<void> {
  await usePaymentsStore.getState().saveOccurrence(row.target.kind, row.target.id, row.month, { status })
}

/** Ayın tutar/tarih/hesap özelleştirmelerini kaldırır. Durum ya da not taşımayan
 *  kayıt tamamen silinir (ay yeniden plandan türetilir). */
export async function resetRowOverrides(row: PaymentRow): Promise<void> {
  const store = usePaymentsStore.getState()
  const occ = row.occurrence
  if (!occ) return
  if (!occ.status && !occ.note) {
    await store.resetOccurrence(row.target.kind, row.target.id, row.month)
    return
  }
  await store.saveOccurrence(row.target.kind, row.target.id, row.month, {
    amount: null, dueDate: null, fromAccountId: null,
  })
}

interface DefaultChanges { amount: boolean; day: boolean; from: boolean }

/** `beforeMonth`tan önceki takip aylarını ŞİMDİKİ çözülmüş değerleriyle sabitler
 *  ki varsayılan değişikliği geçmişi yeniden yazmasın. Yalnız değişen alan ve
 *  zaten özel değeri olmayan aylar yazılır; elle ödenmiş aylar zaten donuk. */
async function freezeBefore(target: PaymentTarget, beforeMonth: string, changes: DefaultChanges): Promise<void> {
  if (!changes.amount && !changes.day && !changes.from) return
  if (beforeMonth <= target.startMonth) return
  const { occurrences, saveOccurrences } = usePaymentsStore.getState()
  const rows = buildSchedule({
    targets: [target],
    occurrences,
    transactions: useTransactionStore.getState().transactions,
    from: target.startMonth,
    to: shiftMonth(beforeMonth, -1),
    todayStr: today(),
  })
  const writes: OccurrenceWrite[] = []
  for (const r of rows) {
    if (r.outOfRange || r.occurrence?.status === 'paid') continue
    const patch: OccurrencePatch = {}
    if (changes.amount && !r.custom.amount && r.amount !== null) patch.amount = r.amount
    if (changes.day && !r.custom.dueDate) patch.dueDate = r.dueDate
    if (changes.from && !r.custom.fromAccount && r.fromAccountId) patch.fromAccountId = r.fromAccountId
    if (Object.keys(patch).length > 0) {
      writes.push({ kind: target.kind, targetId: target.id, month: r.month, patch })
    }
  }
  await saveOccurrences(writes)
}

export interface RowEditValues {
  /** null = varsayılan (plan tutarı; yoksa tutar girilmemiş). */
  amount: number | null
  fromAccountId: string | null
  dueDate: string
  note: string | null
}

/** scope 'month' → yalnız bu ayın kaydı. scope 'forward' → planın varsayılanı
 *  olur; önceki aylar sabitlenir, bu ayın özel değerleri temizlenir. */
export async function saveRowEdit(row: PaymentRow, values: RowEditValues, scope: 'month' | 'forward'): Promise<void> {
  const { target } = row
  const store = usePaymentsStore.getState()
  // Satırı olan hedefin günü hep vardır (günsüz kart satır üretmez); tip için yedek.
  const defaultDue = dueDateFor(row.month, target.dayOfMonth ?? Number(row.dueDate.slice(8, 10)))

  if (scope === 'month') {
    const patch: OccurrencePatch = {
      amount: values.amount,
      dueDate: values.dueDate === defaultDue ? null : values.dueDate,
      fromAccountId: values.fromAccountId === target.defaultFromAccountId ? null : values.fromAccountId,
      note: values.note,
    }
    const occ = row.occurrence
    const empty = patch.amount == null && patch.dueDate == null && patch.fromAccountId == null && !patch.note
    if (empty && !occ?.status) {
      // Hiçbir özel değer kalmadı — kayıt tutmaya gerek yok.
      if (occ) await store.resetOccurrence(target.kind, target.id, row.month)
      return
    }
    await store.saveOccurrence(target.kind, target.id, row.month, patch)
    return
  }

  // Tarih değişmediyse gün de değişmemiş sayılır: 31'i olan plan Eylül'de 30
  // görünür, dokunulmadan kaydedilince 30'a düşmesin.
  const dayOfMonth = values.dueDate === defaultDue ? target.dayOfMonth : Number(values.dueDate.slice(8, 10))
  const changes: DefaultChanges = {
    amount: values.amount !== target.defaultAmount,
    day: dayOfMonth !== target.dayOfMonth,
    from: values.fromAccountId !== target.defaultFromAccountId,
  }
  await freezeBefore(target, row.month, changes)
  await store.savePlan(target.kind, target.id, {
    amount: values.amount,
    fromAccountId: values.fromAccountId,
    dayOfMonth,
  })

  const occ = row.occurrence
  if (occ?.status === 'paid') {
    // Elle ödenmiş ayın donuk değerlerine dokunma; yalnız not.
    await store.saveOccurrence(target.kind, target.id, row.month, { note: values.note })
  } else if (occ) {
    await store.saveOccurrence(target.kind, target.id, row.month, {
      amount: null, dueDate: null, fromAccountId: null, note: values.note,
    })
  } else if (values.note) {
    await store.saveOccurrence(target.kind, target.id, row.month, { note: values.note })
  }
}

export interface PlanSettingsValues {
  amount: number | null
  fromAccountId: string | null
  dayOfMonth: number
  startMonth: string
  isActive: boolean
  notes: string | null
}

/** Hedefin varsayılanları. Bu aydan önceki aylar eski değerleriyle korunur. */
export async function savePlanSettings(target: PaymentTarget, values: PlanSettingsValues): Promise<void> {
  await freezeBefore(target, monthOf(today()), {
    amount: values.amount !== target.defaultAmount,
    day: values.dayOfMonth !== target.dayOfMonth,
    from: values.fromAccountId !== target.defaultFromAccountId,
  })
  await usePaymentsStore.getState().savePlan(target.kind, target.id, values)
}

export async function setTracking(target: PaymentTarget, isActive: boolean): Promise<void> {
  await usePaymentsStore.getState().savePlan(target.kind, target.id, { isActive })
}
