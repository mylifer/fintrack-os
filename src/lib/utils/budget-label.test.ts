import { describe, it, expect } from 'vitest'
import type { Budget, Category } from '@/types'
import { resolveBudgetCategories } from './calculations'

const cat = (o: Partial<Category>): Category => ({
  id: 'c1', name: 'Market', icon: 'shopping-cart', color: '#000', scope: 'expense',
  isSystem: false, sortOrder: 0, ...o,
})

const budget = (o: Partial<Budget>): Budget => ({
  id: 'b1', categoryId: 'c1', amount: 100, period: 'monthly', rollover: false, alertThreshold: 80, ...o,
})

describe('resolveBudgetCategories', () => {
  it('live single category → name + not archived', () => {
    const r = resolveBudgetCategories(budget({ categoryId: 'c1' }), [cat({ id: 'c1', name: 'Market' })])
    expect(r.label).toBe('Market')
    expect(r.archived).toBe(false)
    expect(r.cats).toHaveLength(1)
  })

  it('live multi-category (JSON array) → names joined with ", "', () => {
    const cats = [cat({ id: 'c1', name: 'Market' }), cat({ id: 'c2', name: 'Ulaşım' })]
    const r = resolveBudgetCategories(budget({ categoryId: JSON.stringify(['c1', 'c2']) }), cats)
    expect(r.label).toBe('Market, Ulaşım')
    expect(r.archived).toBe(false)
    expect(r.cats).toHaveLength(2)
  })

  it('no live category + snapshot → "<name> (arşiv)" + archived', () => {
    const r = resolveBudgetCategories(budget({ categoryId: 'gone', categoryName: 'Market' }), [])
    expect(r.label).toBe('Market (arşiv)')
    expect(r.archived).toBe(true)
    expect(r.cats).toHaveLength(0)
  })

  it('no live category + no snapshot → generic placeholder + archived', () => {
    const r = resolveBudgetCategories(budget({ categoryId: 'gone' }), [])
    expect(r.label).toBe('Bütçe (kategorisi silinmiş)')
    expect(r.archived).toBe(true)
    expect(r.cats).toHaveLength(0)
  })
})
