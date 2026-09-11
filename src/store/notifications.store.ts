'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, format, parseISO } from 'date-fns'
import type { RecurringTransaction, Transaction } from '@/types'
import { useRecurringStore } from './recurring.store'
import { useTransactionStore } from './transactions.store'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { usePaymentsStore } from './payments.store'
import { recurringOccurrences } from '@/lib/utils/recurrence'
import { today } from '@/lib/utils/date'
import { awaitsApproval } from '@/lib/utils/calculations'
import { buildSchedule, buildTargets, monthOf, type PaymentRow } from '@/lib/payments/schedule'

/* ── Bildirim merkezi ─────────────────────────────────────────────────────
   Bildirimler TÜRETİLMİŞ veridir — ayrı tablo/entity yok. Kaynaklar:
     • vadesi gelmiş tekrarlayanlar (recurring store getDue),
     • onay bekleyen gelecek işlemler (awaitsApproval — taksitler hariç),
     • ödeme takibi: son günü bugün ya da geçmiş, ödenmemiş kart/borç ödemeleri
       (lib/payments/schedule.ts — sayfadaki "Gecikmiş/Bugün" ile aynı satırlar),
     • yaklaşan (7 gün) pending işlemler + tekrarlayanlar + ödemeler (salt bilgi).
   Ödeme bildirimi, tekrarlayanlar gibi onay ANINDA işlem üretir; önceden taslak
   işlem YAZILMAZ. Kullanıcı transferi elle girerse ay tespitle ödendi olur ve
   bildirim kendiliğinden düşer — çift kayıt ya da silinecek taslak oluşmaz.
   Persist edilen TEK şey lastSeenAt. planned.ts projeksiyonları (kaydedilmemiş
   satırlar) burada GÖRÜNMEZ — kaynak şablon zaten recurring-due olarak listede,
   çift bildirim olmasın. */

export type AppNotification =
  | { kind: 'recurring-due'; recurring: RecurringTransaction; dueSince: string; missedCount: number }
  | { kind: 'recurring-upcoming'; recurring: RecurringTransaction }
  | { kind: 'future-tx-due'; tx: Transaction }        // pending && date <= today
  | { kind: 'future-tx-upcoming'; tx: Transaction }   // pending && today < date <= today+7
  | { kind: 'payment-due'; row: PaymentRow }          // kart/borç ödemesi: son günü bugün ya da geçti
  | { kind: 'payment-upcoming'; row: PaymentRow }     // kart/borç ödemesi: 7 gün içinde

const UPCOMING_DAYS = 7

interface NotificationsState {
  lastSeenAt: string | null   // persist edilen tek alan — "yeni" vurgusu için
  dayTick: number             // gün değişiminde artar → türetilmiş listeler tazelenir
  markSeen: () => void
  refresh: () => void
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    set => ({
      lastSeenAt: null,
      dayTick: 0,
      markSeen: () => set({ lastSeenAt: new Date().toISOString() }),
      // DataProvider gece yarısı geçişinde çağırır: bildirimler today()'e bağlı
      // türetildiğinden, store'lar değişmese de sayaç/panel yeniden hesaplanmalı.
      refresh: () => set(s => ({ dayTick: s.dayTick + 1 })),
    }),
    { name: 'fintrack-notifications', partialize: s => ({ lastSeenAt: s.lastSeenAt }) },
  ),
)

/** Anlık bildirim listesi (store state'lerinden türetilir, reaktif değildir —
 *  bileşenlerde useNotifications() kullanın). */
export function getNotifications(): AppNotification[] {
  const todayStr = today()
  const horizon = format(addDays(parseISO(todayStr), UPCOMING_DAYS), 'yyyy-MM-dd')
  const out: AppNotification[] = []

  const recurringStore = useRecurringStore.getState()
  for (const r of recurringStore.getDue(todayStr)) {
    out.push({
      kind: 'recurring-due',
      recurring: r,
      dueSince: r.nextDueDate,
      missedCount: recurringOccurrences(r, todayStr).length,
    })
  }
  for (const r of recurringStore.recurring) {
    if (!r.isActive) continue
    if (r.endDate && r.endDate < todayStr) continue
    if (r.nextDueDate > todayStr && r.nextDueDate <= horizon) {
      out.push({ kind: 'recurring-upcoming', recurring: r })
    }
  }

  const transactions = useTransactionStore.getState().transactions
  for (const t of transactions) {
    if (!awaitsApproval(t)) continue   // taksitler onay beklemez
    const d = t.date.slice(0, 10)
    if (d <= todayStr) out.push({ kind: 'future-tx-due', tx: t })
    else if (d <= horizon) out.push({ kind: 'future-tx-upcoming', tx: t })
  }

  // Ödeme takibi — ödeme günü girilmemiş kartlar satır üretmez (varsayım yok).
  const { plans, occurrences } = usePaymentsStore.getState()
  const targets = buildTargets({
    accounts: useAccountStore.getState().accounts,
    debts: useDebtStore.getState().debts,
    plans,
  })
  if (targets.length > 0) {
    const current = monthOf(todayStr)
    const from = targets.reduce((m, t) => (t.startMonth < m ? t.startMonth : m), current)
    const rows = buildSchedule({ targets, occurrences, transactions, from, to: monthOf(horizon), todayStr })
    for (const row of rows) {
      if (row.timing === 'overdue' || row.timing === 'today') out.push({ kind: 'payment-due', row })
      else if (row.timing === 'soon') out.push({ kind: 'payment-upcoming', row })
    }
  }

  return out
}

/** Rozet sayısı = aksiyon bekleyenler (recurring-due + future-tx-due + payment-due). */
export function getActionableCount(list: AppNotification[] = getNotifications()): number {
  return list.reduce(
    (n, x) => n + (x.kind === 'recurring-due' || x.kind === 'future-tx-due' || x.kind === 'payment-due' ? 1 : 0),
    0,
  )
}

/** Reaktif bildirim listesi — kaynak store'lar ve gün değişimi (dayTick)
 *  değiştikçe yeniden türetilir. */
export function useNotifications(): AppNotification[] {
  const recurring    = useRecurringStore(s => s.recurring)
  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(s => s.accounts)
  const debts        = useDebtStore(s => s.debts)
  const plans        = usePaymentsStore(s => s.plans)
  const occurrences  = usePaymentsStore(s => s.occurrences)
  const dayTick      = useNotificationsStore(s => s.dayTick)
  return useMemo(
    () => getNotifications(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recurring, transactions, accounts, debts, plans, occurrences, dayTick],
  )
}
