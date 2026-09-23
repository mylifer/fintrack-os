'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, format, parseISO } from 'date-fns'
import type { PaymentSchedule, RecurringTransaction, Transaction } from '@/types'
import { useRecurringStore } from './recurring.store'
import { useTransactionStore } from './transactions.store'
import { usePaymentSchedulesStore } from './paymentSchedules.store'
import { recurringOccurrences } from '@/lib/utils/recurrence'
import { resolvePeriod } from '@/lib/utils/paymentSchedule'
import { today } from '@/lib/utils/date'

/* ── Bildirim merkezi ─────────────────────────────────────────────────────
   Bildirimler TÜRETİLMİŞ veridir — ayrı tablo/entity yok. Kaynaklar:
     • vadesi gelmiş tekrarlayanlar (recurring store getDue),
     • onay bekleyen gelecek işlemler (approvalStatus === 'pending'),
     • yaklaşan (7 gün) pending işlemler + tekrarlayanlar (salt bilgi),
     • ödeme takvimleri: ödenmemiş dönemi gelmiş (aksiyonlu: Ödendi) ya da
       7 gün içinde olanlar — takvim başına tek bildirim.
   Persist edilen TEK şey lastSeenAt. planned.ts projeksiyonları (kaydedilmemiş
   satırlar) burada GÖRÜNMEZ — kaynak şablon zaten recurring-due olarak listede,
   çift bildirim olmasın. */

export type AppNotification =
  | { kind: 'recurring-due'; recurring: RecurringTransaction; dueSince: string; missedCount: number }
  | { kind: 'recurring-upcoming'; recurring: RecurringTransaction }
  | { kind: 'future-tx-due'; tx: Transaction }        // pending && date <= today
  | { kind: 'future-tx-upcoming'; tx: Transaction }   // pending && today < date <= today+7
  // Ödeme takvimi: ödenmemiş en eski dönem (monthKey) — takvim başına TEK bildirim
  | { kind: 'payment-due'; schedule: PaymentSchedule; monthKey: string; dueDate: string; unpaidDueCount: number }
  | { kind: 'payment-upcoming'; schedule: PaymentSchedule; monthKey: string; dueDate: string }

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

  for (const t of useTransactionStore.getState().transactions) {
    if (t.approvalStatus !== 'pending') continue
    const d = t.date.slice(0, 10)
    if (d <= todayStr) out.push({ kind: 'future-tx-due', tx: t })
    else if (d <= horizon) out.push({ kind: 'future-tx-upcoming', tx: t })
  }

  // Sayfa ve rozetle aynı kural (resolvePeriod): ödenmemiş en eski dönem.
  // Ufuk resolvePeriod'da da UPCOMING_DAYS ile aynı (7 gün).
  for (const s of usePaymentSchedulesStore.getState().schedules) {
    if (!s.isActive) continue
    const p = resolvePeriod(s, todayStr)
    if (p.status === 'overdue' || p.status === 'today') {
      out.push({ kind: 'payment-due', schedule: s, monthKey: p.monthKey, dueDate: p.date, unpaidDueCount: p.unpaidDueCount })
    } else if (p.status === 'upcoming') {
      out.push({ kind: 'payment-upcoming', schedule: s, monthKey: p.monthKey, dueDate: p.date })
    }
  }

  return out
}

/** Rozet sayısı = aksiyon bekleyenler (recurring-due + future-tx-due + payment-due). */
export function getActionableCount(list: AppNotification[] = getNotifications()): number {
  return list.reduce((n, x) => n + (x.kind === 'recurring-due' || x.kind === 'future-tx-due' || x.kind === 'payment-due' ? 1 : 0), 0)
}

/** Reaktif bildirim listesi — recurring/transactions/paymentSchedules store'ları
 *  ve gün değişimi (dayTick) değiştikçe yeniden türetilir. */
export function useNotifications(): AppNotification[] {
  const recurring    = useRecurringStore(s => s.recurring)
  const transactions = useTransactionStore(s => s.transactions)
  const schedules    = usePaymentSchedulesStore(s => s.schedules)
  const dayTick      = useNotificationsStore(s => s.dayTick)
  return useMemo(
    () => getNotifications(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recurring, transactions, schedules, dayTick],
  )
}
