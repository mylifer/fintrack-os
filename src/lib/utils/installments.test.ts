import { describe, it, expect } from 'vitest'
import { collapseInstallments } from './installments'
import { calcPeriodFlow, excludeFuture } from './calculations'
import type { Transaction } from '@/types'

/* ── Factory ────────────────────────────────────────────────────────── */

let seq = 0
function tx(over: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `t-${seq}`,
    type: 'expense',
    amount: 100,
    amountTry: 100,
    currency: 'TRY',
    date: '2026-01-15',
    accountId: 'acc-1',
    description: `İşlem ${seq}`,
    isInstallment: false,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...over,
  }
}

/** 12.000₺'lik 3 taksitli alışveriş: Ocak / Şubat / Mart. */
function group(groupId = 'g-1', amounts = [4000, 4000, 4000]): Transaction[] {
  return amounts.map((amount, i) =>
    tx({
      amount,
      amountTry: amount,
      date: `2026-0${i + 1}-15`,
      description: 'Buzdolabı',
      categoryId: 'cat-ev',
      isInstallment: true,
      installTotal: amounts.length,
      installIndex: i + 1,
      installGroupId: groupId,
    }),
  )
}

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('collapseInstallments', () => {
  it('taksitli grubu satın alma ayına tek toplam gider olarak indirger', () => {
    const out = collapseInstallments(group())
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-15')
    expect(out[0].amount).toBe(12000)
    expect(out[0].amountTry).toBe(12000)
    expect(out[0].installTotal).toBe(3)
    expect(out[0].installIndex).toBeUndefined()
  })

  it('kuruş kalanını kaybetmez (splitMoney bölünmesi)', () => {
    const out = collapseInstallments(group('g-2', [333.34, 333.33, 333.33]))
    expect(out[0].amount).toBe(1000)
    expect(out[0].amountTry).toBe(1000)
  })

  it('satın alma satırının kimliğini ve alanlarını korur', () => {
    const rows = group()
    const out  = collapseInstallments(rows)
    expect(out[0].id).toBe(rows[0].id)
    expect(out[0].categoryId).toBe('cat-ev')
    expect(out[0].installGroupId).toBe('g-1')
  })

  it('dizi tarihe göre tersten sıralıyken de ilk taksiti baş alır', () => {
    const out = collapseInstallments([...group()].reverse())
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-15')
    expect(out[0].amount).toBe(12000)
  })

  it('taksitsiz satırları ve sırayı korur; grup yoksa aynı diziyi döner', () => {
    const plain = [tx({ date: '2026-01-01' }), tx({ date: '2026-02-01' })]
    expect(collapseInstallments(plain)).toBe(plain)

    const mixed = [plain[0], ...group(), plain[1]]
    const out   = collapseInstallments(mixed)
    expect(out.map(t => t.id)).toEqual([plain[0].id, mixed[1].id, plain[1].id])
  })

  it('birden fazla grubu birbirine karıştırmaz', () => {
    const out = collapseInstallments([...group('g-1'), ...group('g-2', [500, 500])])
    expect(out).toHaveLength(2)
    expect(out.map(t => t.amount)).toEqual([12000, 1000])
  })

  it('gelecek/onay bekleyen taksitler de toplama girer (indirgeme excludeFuture ÖNCE)', () => {
    // Bugün Ocak sonu varsayımı: Şubat/Mart taksitleri henüz işlenmemiş.
    const rows = group()
    const collapsed = collapseInstallments(rows)
    const posted    = excludeFuture(collapsed, '2026-01-31')
    expect(posted).toHaveLength(1)
    expect(calcPeriodFlow(posted, '2026-01-01', '2026-01-31').expense).toBe(12000)

    // Ham defterde aynı dönem yalnız ilk taksiti görürdü.
    expect(calcPeriodFlow(excludeFuture(rows, '2026-01-31'), '2026-01-01', '2026-01-31').expense).toBe(4000)
  })

  it('iade (negatif gider) taksiti toplamdan düşer', () => {
    const rows = [...group('g-3', [1000, 1000]), tx({
      amount: -400,
      amountTry: -400,
      date: '2026-03-01',
      isInstallment: true,
      installTotal: 2,
      installIndex: 3,
      installGroupId: 'g-3',
    })]
    expect(collapseInstallments(rows)[0].amount).toBe(1600)
  })
})
