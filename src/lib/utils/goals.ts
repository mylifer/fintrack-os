import type { Account, SavingsGoal } from '@/types'
import { toBaseTry } from './fx'
import { subMoney } from './money'

/* ── Birikim hedefi ilerlemesi ────────────────────────────────────────────────
   Saf hesap — store'a/React'e bağımlı değil, tek başına test edilir.

   Mevcut birikim:
     • Hedefe bir hesap bağlıysa o hesabın BUGÜNKÜ bakiyesi (TRY'ye çevrilmiş).
       Negatif bakiye (ör. eksi hesap) birikim sayılmaz → 0.
     • Bağlı hesap silinmiş/arşivlenmişse ya da hiç bağlanmamışsa elle tutulan
       savedAmount. Hesap kaybolunca hedef sıfıra düşmesin diye elle tutara düşer.

   Aylık gereken: kalan tutar / kalan ay. Kalan ay takvim ayı farkıdır ve bu ay
   da sayılır (bugün 25 Eylül, hedef Aralık → Eki+Kas+Ara = 3). Hedef ay bu ay
   ise 1. Tarih geçmişse hedef "gecikmiş"tir ve aylık tutar hesaplanmaz. */

export interface GoalProgress {
  current: number              // TRY
  remaining: number            // TRY, ≥ 0
  percent: number              // 0–100 (üstü 100'e sabitlenir)
  done: boolean
  overdue: boolean             // tarih geçti, hedefe ulaşılmadı
  monthsLeft: number | null    // hedef tarihi yoksa null
  monthlyNeeded: number | null // tarih yok / tamamlandı / gecikmiş → null
  linkedAccount: Account | null
}

export function monthsLeft(todayStr: string, targetDate: string): number {
  const [y, m] = todayStr.slice(0, 7).split('-').map(Number)
  const [ty, tm] = targetDate.slice(0, 7).split('-').map(Number)
  return Math.max(1, (ty - y) * 12 + (tm - m))
}

export function goalProgress(goal: SavingsGoal, accounts: Account[], todayStr: string): GoalProgress {
  const linked = goal.accountId
    ? accounts.find(a => a.id === goal.accountId && !a.isArchived) ?? null
    : null
  const current = linked
    ? Math.max(0, toBaseTry(linked.balance, linked.currency))
    : Math.max(0, goal.savedAmount ?? 0)

  const remaining = Math.max(0, subMoney(goal.targetAmount, current))
  const done = goal.targetAmount > 0 && current >= goal.targetAmount
  const percent = goal.targetAmount > 0 ? Math.min(100, (current / goal.targetAmount) * 100) : 0
  const overdue = !done && !!goal.targetDate && goal.targetDate.slice(0, 10) < todayStr
  const left = goal.targetDate && !overdue ? monthsLeft(todayStr, goal.targetDate) : null
  const monthlyNeeded = left !== null && !done ? Math.round((remaining / left) * 100) / 100 : null

  return { current, remaining, percent, done, overdue, monthsLeft: left, monthlyNeeded, linkedAccount: linked }
}
