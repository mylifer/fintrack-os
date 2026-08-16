import { describe, it, expect } from 'vitest'
import {
  equalSplit, splitsMatchAmount, splitsAreValid, rebalanceSplits, rescaleSplits,
  primarySplitCategoryId, txCategorySlices, expandByCategory, txHasCategory, txCategoryIds,
} from './categorySplits'
import { sumMoney } from './money'
import type { Transaction } from '@/types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1', type: 'expense', amount: 1000, currency: 'TRY', date: '2026-08-16',
  accountId: 'a1', description: 'Market', isInstallment: false,
  createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
})

describe('equalSplit', () => {
  it('bölünemeyen tutarda kuruş kalanını ilk paylara dağıtır ve toplamı korur', () => {
    const s = equalSplit(1000, ['a', 'b', 'c'])
    expect(s.map(x => x.amount)).toEqual([333.34, 333.33, 333.33])
    expect(sumMoney(s.map(x => x.amount))).toBe(1000)
  })

  it('float toplamada kayma yaratmaz (0.1 + 0.2 vakası)', () => {
    const s = equalSplit(0.3, ['a', 'b'])
    expect(sumMoney(s.map(x => x.amount))).toBe(0.3)
  })
})

describe('splitsMatchAmount / splitsAreValid', () => {
  it('bir kuruş sapmayı yakalar', () => {
    expect(splitsMatchAmount([{ categoryId: 'a', amount: 500 }, { categoryId: 'b', amount: 499.99 }], 1000)).toBe(false)
  })

  it('tek pay geçerli bir bölme değildir', () => {
    expect(splitsAreValid([{ categoryId: 'a', amount: 1000 }], 1000)).toBe(false)
  })

  it('kategorisi boş pay geçersizdir', () => {
    expect(splitsAreValid([{ categoryId: 'a', amount: 500 }, { categoryId: '', amount: 500 }], 1000)).toBe(false)
  })

  it('toplamı tutan çok paylı bölme geçerlidir', () => {
    expect(splitsAreValid(equalSplit(1000, ['a', 'b', 'c']), 1000)).toBe(true)
  })
})

describe('rebalanceSplits', () => {
  const base = equalSplit(1000, ['a', 'b', 'c'])   // 333.34 / 333.33 / 333.33

  it('bir payı büyütünce farkı diğerlerine oranlarınca dağıtır, toplam sabit kalır', () => {
    const next = rebalanceSplits(base, 0, 700, 1000)
    expect(next[0].amount).toBe(700)
    expect(sumMoney(next.map(s => s.amount))).toBe(1000)
  })

  it('tutarın üstüne çıkan girişi kırpar, diğer paylar sıfırlanır', () => {
    const next = rebalanceSplits(base, 1, 99999, 1000)
    expect(next[1].amount).toBe(1000)
    expect(sumMoney(next.map(s => s.amount))).toBe(1000)
  })

  it('negatif tutarda (iade) işareti korur', () => {
    const neg = equalSplit(-1000, ['a', 'b'])
    const next = rebalanceSplits(neg, 0, -800, -1000)
    expect(next[0].amount).toBe(-800)
    expect(next[1].amount).toBe(-200)
    expect(sumMoney(next.map(s => s.amount))).toBe(-1000)
  })
})

describe('rescaleSplits', () => {
  it('tutar değişince oranları korur ve yeni toplama tam oturur', () => {
    const s = rescaleSplits([{ categoryId: 'a', amount: 750 }, { categoryId: 'b', amount: 250 }], 400)
    expect(s.map(x => x.amount)).toEqual([300, 100])
    expect(sumMoney(s.map(x => x.amount))).toBe(400)
  })

  it('yuvarlanamayan oranda bile toplam TAM tutar', () => {
    const s = rescaleSplits(equalSplit(1000, ['a', 'b', 'c']), 100.01)
    expect(sumMoney(s.map(x => x.amount))).toBe(100.01)
  })

  it('tüm paylar sıfırken eşit bölüşe düşer', () => {
    const s = rescaleSplits([{ categoryId: 'a', amount: 0 }, { categoryId: 'b', amount: 0 }], 50)
    expect(s.map(x => x.amount)).toEqual([25, 25])
  })
})

describe('primarySplitCategoryId', () => {
  it('en büyük payın kategorisini verir', () => {
    expect(primarySplitCategoryId([
      { categoryId: 'a', amount: 300 },
      { categoryId: 'b', amount: 700 },
    ])).toBe('b')
  })

  it('iade (negatif) paylarda da büyüklüğe bakar', () => {
    expect(primarySplitCategoryId([
      { categoryId: 'a', amount: -300 },
      { categoryId: 'b', amount: -700 },
    ])).toBe('b')
  })
})

describe('txCategorySlices', () => {
  it('bölünmemiş işlemi aynen (aynı referansla) geçirir', () => {
    const t = tx()
    expect(txCategorySlices(t)[0]).toBe(t)
  })

  it('payları ayrı satırlara açar ve amountTry snapshotını oranla böler', () => {
    const t = tx({
      amount: 1000, amountTry: 1000,
      categorySplits: [{ categoryId: 'a', amount: 750 }, { categoryId: 'b', amount: 250 }],
    })
    const slices = txCategorySlices(t)
    expect(slices.map(s => s.categoryId)).toEqual(['a', 'b'])
    expect(slices.map(s => s.amount)).toEqual([750, 250])
    expect(slices.map(s => s.amountTry)).toEqual([750, 250])
    expect(sumMoney(slices.map(s => s.amountTry!))).toBe(t.amountTry)
  })

  it('yabancı para: TRY snapshotı kuruşu kuruşuna korunur', () => {
    const t = tx({
      amount: 100, currency: 'USD', amountTry: 3333.33,
      categorySplits: equalSplit(100, ['a', 'b', 'c']),
    })
    const slices = txCategorySlices(t)
    expect(sumMoney(slices.map(s => s.amountTry!))).toBe(3333.33)
  })

  it('snapshot yoksa dilimlere de yazılmaz (canlı kur çevirisi korunur)', () => {
    const t = tx({ amountTry: undefined, categorySplits: equalSplit(1000, ['a', 'b']) })
    expect(txCategorySlices(t).every(s => s.amountTry === undefined)).toBe(true)
  })

  it('dilimler yeniden açılmasın diye categorySplits taşımaz', () => {
    const t = tx({ categorySplits: equalSplit(1000, ['a', 'b']) })
    expect(txCategorySlices(t).every(s => s.categorySplits === undefined)).toBe(true)
  })
})

describe('expandByCategory', () => {
  it('bölünmüş satır yoksa diziyi aynen döndürür', () => {
    const list = [tx(), tx({ id: 't2' })]
    expect(expandByCategory(list)).toBe(list)
  })

  it('toplam tutarı değiştirmez, yalnızca kategoriye dağıtır', () => {
    const list = [
      tx({ id: 't1', amount: 1000, categorySplits: equalSplit(1000, ['a', 'b']) }),
      tx({ id: 't2', amount: 500, categoryId: 'c' }),
    ]
    const out = expandByCategory(list)
    expect(out).toHaveLength(3)
    expect(sumMoney(out.map(t => t.amount))).toBe(1500)
  })
})

describe('txHasCategory / txCategoryIds', () => {
  it('paylardan biri eşleşirse işlem o kategoriye aittir', () => {
    const t = tx({ categoryId: 'a', categorySplits: [{ categoryId: 'a', amount: 600 }, { categoryId: 'b', amount: 400 }] })
    expect(txHasCategory(t, 'b')).toBe(true)
    expect(txHasCategory(t, 'z')).toBe(false)
    expect(txCategoryIds(t)).toEqual(['a', 'b'])
  })

  it('bölünmemiş işlemde tek kategoriye düşer', () => {
    expect(txCategoryIds(tx({ categoryId: 'a' }))).toEqual(['a'])
    expect(txCategoryIds(tx({ categoryId: undefined }))).toEqual([])
  })
})
