import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Account, PaymentPlan } from '@/types'
import { buildSchedule, buildTargets, planIdFor, type PaymentRow } from './schedule'

/* ────────────────────────────────────────────────────────────────────────
   Ödeme takibi eylemleri — kartta son ödeme tarihi

   Kartın takvimdeki tarihi kart döngüsünden gelir (kesim + fark, tatil kuralı);
   plan.dayOfMonth'tan değil. Dokunulmadan kaydedilen tarih "değişmedi"
   sayılmalı: gereksiz aya özel tarih ya da kaymış gün (25 → 26) yazılmasın.
   Elle girilen gün, hesaptaki fark (dueGapDays) yüzünden etkisiz kalmasın.

   Store'lar mock'lanır; test eylemin YAZDIKLARINI doğrular.
──────────────────────────────────────────────────────────────────────── */

const calls = {
  savePlan: [] as { kind: string; id: string; patch: Record<string, unknown> }[],
  saveOccurrence: [] as { month: string; patch: Record<string, unknown> }[],
  saveOccurrences: [] as unknown[][],
  resetOccurrence: [] as string[],
  updateAccount: [] as { id: string; patch: Partial<Account> }[],
}
let accounts: Account[] = []

vi.mock('@/store/payments.store', () => ({
  usePaymentsStore: {
    getState: () => ({
      occurrences: [],
      savePlan: async (kind: string, id: string, patch: Record<string, unknown>) => { calls.savePlan.push({ kind, id, patch }) },
      saveOccurrence: async (_k: string, _id: string, month: string, patch: Record<string, unknown>) => {
        calls.saveOccurrence.push({ month, patch })
      },
      saveOccurrences: async (writes: unknown[]) => { calls.saveOccurrences.push(writes) },
      resetOccurrence: async (_k: string, _id: string, month: string) => { calls.resetOccurrence.push(month) },
    }),
  },
}))
vi.mock('@/store/accounts.store', () => ({
  useAccountStore: {
    getState: () => ({
      accounts,
      update: async (id: string, patch: Partial<Account>) => { calls.updateAccount.push({ id, patch }) },
    }),
  },
}))
vi.mock('@/store/transactions.store', () => ({
  useTransactionStore: { getState: () => ({ transactions: [] }) },
}))
vi.mock('@/store/debts.store', () => ({
  useDebtStore: { getState: () => ({}) },
}))

const { saveRowEdit, savePlanSettings } = await import('./actions')

function card(p: Partial<Account> = {}): Account {
  return {
    id: 'card1', name: 'Bonus', type: 'credit_card', currency: 'TRY', balance: 0, initialBalance: 0,
    color: '#10b981', isArchived: false, createdAt: '2026-01-01T00:00:00.000Z',
    statementDay: 15, dueGapDays: 10, ...p,
  }
}

const plan = (dayOfMonth: number): PaymentPlan => ({
  id: planIdFor('card', 'card1'), targetKind: 'card', targetId: 'card1', dayOfMonth, isActive: true,
  createdAt: '2026-10-01', updatedAt: '2026-10-01',
})

/** Kesim 15 + fark 10 → son ödeme 25; 25 Ekim 2026 Pazar → satır 26 Ekim. */
function octoberRow(): PaymentRow {
  const targets = buildTargets({ accounts, debts: [], plans: [plan(25)] })
  const [row] = buildSchedule({ targets, occurrences: [], transactions: [], from: '2026-10', to: '2026-10', todayStr: '2026-10-05' })
  return row
}

const values = (dueDate: string) => ({ amount: null, fromAccountId: null, dueDate, note: null })

beforeEach(() => {
  accounts = [card()]
  for (const list of Object.values(calls)) list.length = 0
})

describe('saveRowEdit — kart son ödeme tarihi', () => {
  it('dokunulmamış (tatille kaymış) tarih "yalnız bu ay"da aya özel tarih yazmaz', async () => {
    const row = octoberRow()
    expect(row.dueDate).toBe('2026-10-26')
    await saveRowEdit(row, values(row.dueDate), 'month')
    expect(calls.saveOccurrence).toEqual([])
    expect(calls.resetOccurrence).toEqual([])
  })

  it('dokunulmamış tarih "bu ve sonraki aylar"da günü değiştirmez, geçmişi dondurmaz, farkı silmez', async () => {
    const row = octoberRow()
    await saveRowEdit(row, values(row.dueDate), 'forward')
    expect(calls.savePlan).toEqual([{ kind: 'card', id: 'card1', patch: { amount: null, fromAccountId: null, dayOfMonth: 25 } }])
    expect(calls.saveOccurrences).toEqual([])
    expect(calls.updateAccount).toEqual([])
  })

  it('elle değişen tarih "yalnız bu ay"da aya özel tarih olur', async () => {
    await saveRowEdit(octoberRow(), values('2026-10-20'), 'month')
    expect(calls.saveOccurrence).toEqual([{ month: '2026-10', patch: { amount: null, dueDate: '2026-10-20', fromAccountId: null, note: null } }])
  })

  it('elle değişen tarih "bu ve sonraki aylar"da günü değiştirir ve farkı siler (sabit gün)', async () => {
    await saveRowEdit(octoberRow(), values('2026-10-20'), 'forward')
    expect(calls.savePlan[0].patch.dayOfMonth).toBe(20)
    expect(calls.updateAccount).toEqual([{ id: 'card1', patch: { dueGapDays: null } }])
  })
})

describe('savePlanSettings — kart son ödeme günü', () => {
  const settings = (dayOfMonth: number) => ({
    amount: null, fromAccountId: null, dayOfMonth, startMonth: '2026-11', isActive: true, notes: null,
  })
  const target = () => buildTargets({ accounts, debts: [], plans: [plan(25)] })[0]

  it('farklı gün girilince hesaptaki fark silinir — yoksa yeni gün etkisiz kalırdı', async () => {
    await savePlanSettings(target(), settings(20))
    expect(calls.updateAccount).toEqual([{ id: 'card1', patch: { dueGapDays: null } }])
    expect(calls.savePlan[0].patch.dayOfMonth).toBe(20)
  })

  it('gün değişmediyse ya da kesim + farkın günüyse fark korunur', async () => {
    await savePlanSettings(target(), settings(25))
    accounts = [card({ dueGapDays: 12 })]
    await savePlanSettings(target(), settings(27))
    expect(calls.updateAccount).toEqual([])
  })
})
