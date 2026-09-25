import { describe, it, expect, beforeAll } from 'vitest'
import type { Account, PriceData, SavingsGoal } from '@/types'
import { goalProgress, monthsLeft } from './goals'
import { setBaseRates } from './fx'

const goal = (o: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g', name: 'Tatil', targetAmount: 50000, color: '#10B981', createdAt: '', updatedAt: '', ...o,
})
const account = (o: Partial<Account> = {}): Account => ({
  id: 'a', name: 'Birikim', type: 'savings', currency: 'TRY', balance: 0, initialBalance: 0,
  color: '#000', isArchived: false, createdAt: '', ...o,
})

beforeAll(() => {
  setBaseRates({ usdTry: 40, eurTry: 45, gbpTry: 52, goldGramTry: 0, updatedAt: 0 } as PriceData)
})

describe('monthsLeft', () => {
  it('bu ay dahil takvim ayı farkı; hedef bu aysa 1', () => {
    expect(monthsLeft('2026-09-25', '2026-12-31')).toBe(3)
    expect(monthsLeft('2026-09-25', '2026-09-30')).toBe(1)
    expect(monthsLeft('2026-09-25', '2027-09-01')).toBe(12)
  })
})

describe('goalProgress', () => {
  it('elle takip: kalan, yüzde ve aylık gereken tutar', () => {
    const p = goalProgress(goal({ savedAmount: 20000, targetDate: '2026-12-31' }), [], '2026-09-25')
    expect(p.current).toBe(20000)
    expect(p.remaining).toBe(30000)
    expect(p.percent).toBe(40)
    expect(p.monthsLeft).toBe(3)
    expect(p.monthlyNeeded).toBe(10000)
    expect(p.done).toBe(false)
  })

  it('bağlı hesap: bakiye TRY\'ye çevrilir, elle tutar yok sayılır', () => {
    const p = goalProgress(goal({ accountId: 'a', savedAmount: 1 }), [account({ currency: 'USD', balance: 500 })], '2026-09-25')
    expect(p.current).toBe(20000)
    expect(p.linkedAccount?.id).toBe('a')
    expect(p.monthlyNeeded).toBeNull() // tarih yok
  })

  it('bağlı hesap silinmiş/arşivliyse elle tutara düşer; negatif bakiye birikim sayılmaz', () => {
    expect(goalProgress(goal({ accountId: 'yok', savedAmount: 700 }), [], '2026-09-25').current).toBe(700)
    expect(goalProgress(goal({ accountId: 'a', savedAmount: 700 }), [account({ isArchived: true, balance: 9 })], '2026-09-25').current).toBe(700)
    expect(goalProgress(goal({ accountId: 'a' }), [account({ balance: -300 })], '2026-09-25').current).toBe(0)
  })

  it('hedefe ulaşınca tamamlandı; yüzde 100\'de sabitlenir, aylık tutar yok', () => {
    const p = goalProgress(goal({ savedAmount: 60000, targetDate: '2026-12-31' }), [], '2026-09-25')
    expect(p.done).toBe(true)
    expect(p.percent).toBe(100)
    expect(p.remaining).toBe(0)
    expect(p.monthlyNeeded).toBeNull()
  })

  it('tarih geçti ve hedefe ulaşılmadıysa gecikmiş', () => {
    const p = goalProgress(goal({ savedAmount: 100, targetDate: '2026-08-31' }), [], '2026-09-25')
    expect(p.overdue).toBe(true)
    expect(p.monthlyNeeded).toBeNull()
  })
})
