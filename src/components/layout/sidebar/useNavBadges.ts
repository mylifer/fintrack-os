'use client'

import { rowInWorkspace } from '@/lib/workspace-context'
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  useAccountStore, useRecurringStore, useTransactionStore, useDebtStore, usePaymentsStore, useWorkspaceStore,
} from '@/store'
import { useStatementDraftsStore } from '@/store/statement-drafts.store'
import { assignCardPayments, buildSchedule, buildTargets, monthOf } from '@/lib/payments/schedule'
import { today } from '@/lib/utils/date'
import type { NavItem } from './nav'

export interface NavBadgeCounts {
  dueCount: number
  paymentAlertCount: number
  draftCount: number
}

/* Navigasyon rozetlerinin tek kaynağı: kenar çubuğu varyantları
   (useSidebarData üzerinden) ve mobil "Diğer" sayfası aynı sayıları okur. */
export function useNavBadges(): NavBadgeCounts {
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const allAccounts  = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(useShallow(s => s.transactions))
  const debts        = useDebtStore(useShallow(s => s.debts))
  // Sayaç selector İÇİNDE hesaplanır: getDue fonksiyonunu seçmek (sabit referans)
  // tekrarlayanlar değişince yeniden render tetiklemiyor, rozet eskiyordu.
  const dueCount     = useRecurringStore(s => s.getDue(today()).length)

  // Yarım kalan ekstreler (bu cihazdaki taslaklar, aktif çalışma alanı)
  const activeWorkspace = useWorkspaceStore(s => s.activeId)
  const draftCount = useStatementDraftsStore(s => s.drafts.filter(d => !activeWorkspace || rowInWorkspace(d, activeWorkspace)).length)
  useEffect(() => { useStatementDraftsStore.getState().load() }, [])

  // Ödeme Takibi rozeti: gecikmiş ya da son günü bugün olan kart/borç ödemesi.
  // Sayfadaki "Gecikmiş" ile aynı kaynak (buildSchedule), takip başlangıcından
  // bugünün ayına kadar.
  const paymentPlans       = usePaymentsStore(s => s.plans)
  const paymentOccurrences = usePaymentsStore(s => s.occurrences)
  const paymentAlertCount  = useMemo(() => {
    const todayStr = today()
    const current = monthOf(todayStr)
    const targets = buildTargets({ accounts, debts, plans: paymentPlans })
    if (targets.length === 0) return 0
    const from = targets.reduce((m, t) => (t.startMonth < m ? t.startMonth : m), current)
    // cardPayments TÜM hesaplardan (arşivli kartlar dahil) — bildirim merkezi ve
    // sayfayla aynı eşleme. Verilmezse "tek aktif kart" kuralı arşivli kartın
    // adını taşıyan ödemeyi aktif karta yazıp rozeti sayfadan ayırabiliyordu.
    return buildSchedule({
      targets, occurrences: paymentOccurrences, transactions, from, to: current, todayStr,
      cardPayments: assignCardPayments(allAccounts, transactions),
    })
      .filter(r => r.timing === 'overdue' || r.timing === 'today')
      .length
  }, [accounts, allAccounts, debts, paymentPlans, paymentOccurrences, transactions])

  return { dueCount, paymentAlertCount, draftCount }
}

/** Öğenin rozet sayısı ve tonu; rozet yoksa ya da sayı 0 ise null. */
export function navBadge(item: NavItem, c: NavBadgeCounts): { count: number; tone: 'warn' | 'danger'; title?: string } | null {
  switch (item.badge) {
    case 'due':      return c.dueCount > 0 ? { count: c.dueCount, tone: 'warn', title: 'Vadesi gelen tekrarlayan' } : null
    case 'drafts':   return c.draftCount > 0 ? { count: c.draftCount, tone: 'warn', title: 'Onaylanmamış ekstre' } : null
    case 'payments': return c.paymentAlertCount > 0
      ? { count: c.paymentAlertCount, tone: 'danger', title: 'Gecikmiş ya da son günü bugün olan ödeme' }
      : null
    default:         return null
  }
}
