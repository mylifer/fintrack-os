import { describe, it, expect, beforeAll } from 'vitest'
import { compareByAmount, sortWithinDay } from './shared'
import { setBaseRates } from '@/lib/utils/fx'
import type { Transaction } from '@/types'

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'amount'>): Transaction {
  return {
    type: 'expense', currency: 'TRY', description: p.id, isInstallment: false,
    date: '2026-03-01', accountId: 'a', createdAt: '2026-03-01', updatedAt: '2026-03-01', ...p,
  } as Transaction
}

describe('compareByAmount — para birimine duyarlı tutar sıralaması', () => {
  beforeAll(() => {
    setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43 } as never)
  })

  it('$100, ₺500\'ün üstünde sıralanır (₺ karşılığıyla kıyas)', () => {
    const usd = tx({ id: 'usd', amount: 100, currency: 'USD' })
    const tl  = tx({ id: 'tl', amount: 500 })
    expect(sortWithinDay([tl, usd], 'amount-desc').map(t => t.id)).toEqual(['usd', 'tl'])
    expect(sortWithinDay([usd, tl], 'amount-asc').map(t => t.id)).toEqual(['tl', 'usd'])
  })

  it('kayıtlı amountTry anlık görüntüsü önceliklidir ve işaret yok sayılır', () => {
    const refund = tx({ id: 'r', amount: -10, currency: 'USD', amountTry: -400 })
    const tl     = tx({ id: 'tl', amount: 350 })
    expect(compareByAmount(refund, tl, 'amount-desc')).toBeLessThan(0)
  })
})
