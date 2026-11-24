'use client'

import { useMemo } from 'react'
import { useAccountStore, usePaymentsStore, useTransactionStore } from '@/store'
import { buildCardStatements } from '@/lib/utils/card-statement'
import { assignCardPayments } from '@/lib/payments/schedule'
import { planIdFor } from '@/lib/payments/ids'
import { resolveCardDays } from '@/lib/payments/bank-rules'
import { today } from '@/lib/utils/date'
import type { Account } from '@/types'

/** Kredi kartının ekstreleri — Ekstre paneli ile hesap üst bandı AYNI sonucu
 *  okusun diye tek yerde hesaplanır (kesim + fark ve tatil kuralı Kart
 *  Takvimi ile aynı: bank-rules). */
export function useCardStatements(account: Account) {
  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(s => s.accounts)
  const plan = usePaymentsStore(s => s.plans.find(p => p.id === planIdFor('card', account.id)))
  const occurrences = usePaymentsStore(s => s.occurrences)

  const todayStr = today()
  const resolved = resolveCardDays(account, plan)
  const result = useMemo(() => buildCardStatements(account, transactions, {
    days: resolved.days,
    payments: assignCardPayments(accounts, transactions).get(account.id) ?? [],
    dueDay: plan?.dayOfMonth ?? null,
    minPayPct: account.minPayPct && account.minPayPct !== 3 ? account.minPayPct : null,
    todayStr,
    // Kart Takvimi'nde aya özel girilen kesim / son ödeme tarihleri
    overrides: new Map(occurrences
      .filter(o => o.targetKind === 'card' && o.targetId === account.id && !o.deleted_at)
      .map(o => [o.month, { statementDate: o.statementDate ?? null, dueDate: o.dueDate ?? null }])),
    // resolved.days: account + plan değerlerinden türer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [account, accounts, transactions, plan?.dayOfMonth, todayStr, occurrences])

  return { result, plan, resolved }
}
