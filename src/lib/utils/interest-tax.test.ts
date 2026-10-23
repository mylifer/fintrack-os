import { describe, it, expect } from 'vitest'
import { impliedTaxRate, interestTaxId, isInterestCategory, splitInterest, withLinkedInterestTax } from './interest-tax'

describe('splitInterest', () => {
  it('brüt girilince stopaj brüt × oran', () => {
    expect(splitInterest(308.22, 17.5, 'gross')).toEqual({ gross: 308.22, tax: 53.94, net: 254.28 })
    // Banka ekranındaki gerçek örnek: 22,27 brüt faizden 3,90 stopaj
    expect(splitInterest(22.27, 17.5, 'gross')).toEqual({ gross: 22.27, tax: 3.9, net: 18.37 })
  })

  it('net girilince hesaba etki girilen tutarla aynı kalır', () => {
    const s = splitInterest(254.28, 17.5, 'net')
    expect(s).toEqual({ gross: 308.22, tax: 53.94, net: 254.28 })
    expect(Math.round((s.gross - s.tax) * 100) / 100).toBe(254.28)
  })

  it('net modunda bulunan brüt, bankanın stopaj hesabıyla tutarlıdır', () => {
    for (const net of [0.01, 1, 12.34, 999.99, 4321.5]) {
      const s = splitInterest(net, 17.5, 'net')
      expect(Math.round(s.gross * 0.175 * 100) / 100).toBeCloseTo(s.tax, 2)
      expect(Math.round((s.gross - s.tax) * 100)).toBe(Math.round(net * 100))
    }
  })

  it('oran 0 ise stopaj yok', () => {
    expect(splitInterest(100, 0, 'net')).toEqual({ gross: 100, tax: 0, net: 100 })
  })
})

describe('impliedTaxRate', () => {
  it('kayıtlı satırlardan oranı geri bulur', () => {
    expect(impliedTaxRate(308.22, 53.94)).toBe(17.5)
    expect(impliedTaxRate(0, 0)).toBe(0)
  })
})

describe('isInterestCategory', () => {
  const cats = [
    { id: 'f', name: 'Faiz Geliri', scope: 'income' as const },
    { id: 'm', name: 'Mevduat', scope: 'income' as const, parentId: 'f' },
    { id: 's', name: 'Maaş', scope: 'income' as const },
    { id: 'e', name: 'Kredi Faizi', scope: 'expense' as const },
  ]
  it('adında ya da üst kategorisinde faiz geçen GELİR kategorisi', () => {
    expect(isInterestCategory('f', cats)).toBe(true)
    expect(isInterestCategory('m', cats)).toBe(true)
    expect(isInterestCategory('s', cats)).toBe(false)
    expect(isInterestCategory('e', cats)).toBe(false)
    expect(isInterestCategory(undefined, cats)).toBe(false)
  })
})

describe('withLinkedInterestTax', () => {
  it('faiz satırını silerken stopaj satırını da ekler', () => {
    const income = { id: 'i1', type: 'income' as const }
    const tax = { id: interestTaxId('i1'), type: 'expense' as const }
    const other = { id: 'x', type: 'expense' as const }
    expect(withLinkedInterestTax([income], [income, tax, other]).map(t => t.id)).toEqual(['i1', tax.id])
    expect(withLinkedInterestTax([other], [income, tax, other]).map(t => t.id)).toEqual(['x'])
  })

  it('kimlik türetimi kararlıdır', () => {
    expect(interestTaxId('abc')).toBe(interestTaxId('abc'))
    expect(interestTaxId('abc')).not.toBe(interestTaxId('abd'))
  })
})
