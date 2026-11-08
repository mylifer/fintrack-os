import { describe, it, expect } from 'vitest'
import { enrichCategories } from './shared'
import type { Category, Transaction } from '@/types'

function cat(p: Partial<Category> & Pick<Category, 'id' | 'name'>): Category {
  return { icon: 'x', color: '#000', scope: 'expense', isSystem: false, sortOrder: 0, ...p } as Category
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'amount'>): Transaction {
  return {
    type: 'expense', currency: 'TRY', amountTry: p.amount, description: p.id, isInstallment: false,
    date: '2026-03-01', accountId: 'a', createdAt: '2026-03-01', updatedAt: '2026-03-01', ...p,
  } as Transaction
}

describe('enrichCategories — arşivli alt kategoriler', () => {
  it('arşivli alt kategorinin tutarı aktif üst kategorinin toplamına eklenir', () => {
    const categories = [
      cat({ id: 'p', name: 'Ev' }),
      cat({ id: 'c', name: 'Eski', parentId: 'p', isArchived: true }),
    ]
    const txs = [
      tx({ id: 't1', amount: 50, categoryId: 'p' }),
      tx({ id: 't2', amount: 100, categoryId: 'c' }),
    ]
    const rows = enrichCategories(categories, txs, 'expense', '2026-12-31')
    expect(rows.map(r => r.category.id)).toEqual(['p'])
    expect(rows[0].expense).toBe(150)
    expect(rows[0].magnitude).toBe(150)
    expect(rows[0].flowCount).toBe(2)
  })

  it('aktif üstü olmayan arşivli kategori satır üretmez ve toplamı yoktur', () => {
    const categories = [
      cat({ id: 'p', name: 'Ev', isArchived: true }),
      cat({ id: 'q', name: 'Market' }),
    ]
    const rows = enrichCategories(categories, [tx({ id: 't', amount: 10, categoryId: 'p' })], 'expense', '2026-12-31')
    expect(rows.map(r => r.category.id)).toEqual(['q'])
    expect(rows[0].magnitude).toBe(0)
  })
})
