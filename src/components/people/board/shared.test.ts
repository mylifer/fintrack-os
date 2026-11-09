import { describe, it, expect } from 'vitest'
import { enrichPeople } from './shared'
import type { Person, Transaction } from '@/types'

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'amount'>): Transaction {
  return {
    type: 'expense', currency: 'TRY', amountTry: p.amount, description: p.id, isInstallment: false,
    date: '2026-03-01', accountId: 'a', createdAt: '2026-03-01', updatedAt: '2026-03-01', ...p,
  } as Transaction
}

const person: Person = { id: 'r1', name: 'Migros', role: 'recipient', createdAt: '2026-01-01' }

describe('enrichPeople — ortalama paydası', () => {
  it('expenseCount yalnız gider satırlarını sayar; gelir/transfer flowCount’a girer ama ortalamaya girmez', () => {
    const txs = [
      tx({ id: 'e1', amount: 100, recipientId: 'r1' }),
      tx({ id: 'e2', amount: 300, recipientId: 'r1' }),
      tx({ id: 'i1', amount: 50, recipientId: 'r1', type: 'income' }),
      tx({ id: 't1', amount: 1_000, recipientId: 'r1', type: 'transfer', toAccountId: 'b' }),
    ]
    const [row] = enrichPeople([person], txs, 'recipientId', '2026-12-31')
    expect(row.flowCount).toBe(4)
    expect(row.expenseCount).toBe(2)
    expect(row.expense / row.expenseCount).toBe(200)
  })
})
