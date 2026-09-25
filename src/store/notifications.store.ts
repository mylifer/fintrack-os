'use client'

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, format, parseISO } from 'date-fns'
import type { BudgetWithSpent, MonthYear, RecurringTransaction, Transaction } from '@/types'
import { useRecurringStore } from './recurring.store'
import { useTransactionStore } from './transactions.store'
import { useAccountStore } from './accounts.store'
import { useDebtStore } from './debts.store'
import { usePaymentsStore } from './payments.store'
import { useBudgetStore } from './budgets.store'
import { useCategoryStore } from './categories.store'
import { recurringOccurrences } from '@/lib/utils/recurrence'
import { collapseInstallments } from '@/lib/utils/installments'
import { today, currentMonthYear } from '@/lib/utils/date'
import { awaitsApproval } from '@/lib/utils/calculations'
import { assignCardPayments, buildSchedule, buildTargets, monthOf, type PaymentRow } from '@/lib/payments/schedule'

/* ── Bildirim merkezi ─────────────────────────────────────────────────────
   Bildirimler TÜRETİLMİŞ veridir — ayrı tablo/entity yok. Kaynaklar:
     • vadesi gelmiş tekrarlayanlar (recurring store getDue),
     • onay bekleyen gelecek işlemler (awaitsApproval — taksitler hariç),
     • ödeme takibi: son günü bugün ya da geçmiş, ödenmemiş kart/borç ödemeleri
       (lib/payments/schedule.ts — sayfadaki "Gecikmiş/Bugün" ile aynı satırlar),
     • yaklaşan (7 gün) pending işlemler + tekrarlayanlar + ödemeler (salt bilgi),
     • bu ay uyarı eşiğini geçen ya da aşılan bütçeler (salt bilgi — rozete
       sayılmaz: ay boyunca kapatılamaz, sayaç hep dolu kalırdı. Onun yerine
       zil, GÖRÜLMEMİŞ bir bütçe uyarısında nokta gösterir; bkz. budgetAlertKey).
   Ödeme bildirimi, tekrarlayanlar gibi onay ANINDA işlem üretir; önceden taslak
   işlem YAZILMAZ. Kullanıcı transferi elle girerse ay tespitle ödendi olur ve
   bildirim kendiliğinden düşer — çift kayıt ya da silinecek taslak oluşmaz.
   Persist edilenler: lastSeenAt ve görülmüş bütçe uyarısı anahtarları.
   planned.ts projeksiyonları (kaydedilmemiş satırlar) burada GÖRÜNMEZ — kaynak
   şablon zaten recurring-due olarak listede, çift bildirim olmasın. */

export type AppNotification =
  | { kind: 'recurring-due'; recurring: RecurringTransaction; dueSince: string; missedCount: number }
  | { kind: 'recurring-upcoming'; recurring: RecurringTransaction }
  | { kind: 'future-tx-due'; tx: Transaction }        // pending && date <= today
  | { kind: 'future-tx-upcoming'; tx: Transaction }   // pending && today < date <= today+7
  | { kind: 'payment-due'; row: PaymentRow }          // kart/borç ödemesi: son günü bugün ya da geçti
  | { kind: 'payment-upcoming'; row: PaymentRow }     // kart/borç ödemesi: 7 gün içinde
  | { kind: 'budget-alert'; budget: BudgetWithSpent; month: MonthYear } // bu ay: eşik geçildi ya da aşıldı

const UPCOMING_DAYS = 7

/** Bir bütçe uyarısının kimliği: ay VE durum dahil — aynı ay 'warning'ten
 *  'exceeded'a geçen bütçe, görülmüş olsa bile yeniden "yeni" sayılır. */
export function budgetAlertKey(n: Extract<AppNotification, { kind: 'budget-alert' }>): string {
  return `${n.budget.id}:${n.month.year}-${n.month.month}:${n.budget.status}`
}

interface NotificationsState {
  lastSeenAt: string | null   // "yeni" vurgusu için
  seenBudgetAlerts: string[]  // panel açıldığında görülen bütçe uyarıları (budgetAlertKey)
  dayTick: number             // gün değişiminde artar → türetilmiş listeler tazelenir
  markSeen: (budgetAlertKeys?: string[]) => void
  refresh: () => void
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    set => ({
      lastSeenAt: null,
      seenBudgetAlerts: [],
      dayTick: 0,
      markSeen: budgetAlertKeys => set(s => ({
        lastSeenAt: new Date().toISOString(),
        // Yalnız GÜNCEL uyarılar saklanır: geçen ayların anahtarları birikmesin
        seenBudgetAlerts: budgetAlertKeys ?? s.seenBudgetAlerts,
      })),
      // DataProvider gece yarısı geçişinde çağırır: bildirimler today()'e bağlı
      // türetildiğinden, store'lar değişmese de sayaç/panel yeniden hesaplanmalı.
      refresh: () => set(s => ({ dayTick: s.dayTick + 1 })),
    }),
    {
      name: 'fintrack-notifications',
      partialize: s => ({ lastSeenAt: s.lastSeenAt, seenBudgetAlerts: s.seenBudgetAlerts }),
    },
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
  const accounts = useAccountStore.getState().accounts
  const { plans, occurrences } = usePaymentsStore.getState()
  const targets = buildTargets({ accounts, debts: useDebtStore.getState().debts, plans })
  if (targets.length > 0) {
    const current = monthOf(todayStr)
    const from = targets.reduce((m, t) => (t.startMonth < m ? t.startMonth : m), current)
    const rows = buildSchedule({
      targets, occurrences, transactions, from, to: monthOf(horizon), todayStr,
      cardPayments: assignCardPayments(accounts, transactions),
    })
    for (const row of rows) {
      if (row.timing === 'overdue' || row.timing === 'today') out.push({ kind: 'payment-due', row })
      else if (row.timing === 'soon') out.push({ kind: 'payment-upcoming', row })
    }
  }

  // Bütçeler — Bütçeler sayfasıyla AYNI taban (taksitler satın alma ayına
  // toplu yazılır), yoksa sayfa "ok" derken bildirim "aşıldı" diyebilirdi.
  const month = currentMonthYear()
  for (const budget of useBudgetStore.getState().getMonthBudgets(month, collapseInstallments(transactions))) {
    if (budget.status !== 'ok') out.push({ kind: 'budget-alert', budget, month })
  }

  return out
}

/** Panel açıldığından beri görülmemiş bir bütçe uyarısı var mı? (zil noktası) */
export function hasUnseenBudgetAlert(list: AppNotification[], seen: string[]): boolean {
  return list.some(n => n.kind === 'budget-alert' && !seen.includes(budgetAlertKey(n)))
}

/** Şu anki bütçe uyarılarının anahtarları — markSeen'e verilir. */
export function currentBudgetAlertKeys(list: AppNotification[]): string[] {
  return list.flatMap(n => (n.kind === 'budget-alert' ? [budgetAlertKey(n)] : []))
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
  const budgets      = useBudgetStore(s => s.budgets)
  const categories   = useCategoryStore(s => s.categories)
  const dayTick      = useNotificationsStore(s => s.dayTick)
  return useMemo(
    () => getNotifications(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recurring, transactions, accounts, debts, plans, occurrences, budgets, categories, dayTick],
  )
}
