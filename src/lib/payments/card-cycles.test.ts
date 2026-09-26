import { describe, it, expect } from 'vitest'
import { cardCycle, cardCycles, lastClosingBefore } from './card-cycles'

describe('lastClosingBefore', () => {
  it('son ödemeden önceki son kesim; aynı gün ise önceki ay', () => {
    expect(lastClosingBefore('2026-10-04', 24)).toBe('2026-09-24')
    expect(lastClosingBefore('2026-10-16', 11)).toBe('2026-10-11')
    expect(lastClosingBefore('2026-10-17', 17)).toBe('2026-09-17')
    expect(lastClosingBefore('2026-03-10', 31)).toBe('2026-02-28')
    expect(lastClosingBefore('2026-10-10', null)).toBe('2026-09-30')   // kesim günü yok → ay sonu
  })
})

describe('cardCycle — varsayılan günler', () => {
  it('kesim 24, son ödeme 4: Ekim ödemesi 24 Eylül kesimli', () => {
    expect(cardCycle({ statementDay: 24, dueDay: 4 }, '2026-10')).toEqual({
      month: '2026-10', from: '2026-08-25', closing: '2026-09-24', dueDate: '2026-10-04',
      closingCustom: false, dueCustom: false, invalid: false,
    })
  })

  it('kesim 11, son ödeme 16: aynı ay', () => {
    expect(cardCycle({ statementDay: 11, dueDay: 16 }, '2026-10')).toMatchObject({
      from: '2026-09-12', closing: '2026-10-11', dueDate: '2026-10-16',
    })
  })

  it('son ödeme günü yoksa döngü kesim ayıyla anılır, son ödeme boş', () => {
    expect(cardCycle({ statementDay: 1, dueDay: null }, '2026-10')).toMatchObject({
      from: '2026-09-02', closing: '2026-10-01', dueDate: null, invalid: false,
    })
  })

  it('kısa ayda gün ay sonuna sıkışır', () => {
    expect(cardCycle({ statementDay: 31, dueDay: 10 }, '2026-03')).toMatchObject({
      closing: '2026-02-28', dueDate: '2026-03-10', from: '2026-02-01',
    })
  })
})

describe('cardCycle — ay bazında özel tarih', () => {
  it('son ödeme hafta sonuna denk gelip kaydırıldı: kesim varsayılan kalır', () => {
    const c = cardCycle({ statementDay: 24, dueDay: 4 }, '2026-10', { dueDate: '2026-10-05' })
    expect(c).toMatchObject({ closing: '2026-09-24', dueDate: '2026-10-05', dueCustom: true, closingCustom: false })
  })

  it('özel kesim, sonraki dönemin başını da kaydırır', () => {
    const days = { statementDay: 24, dueDay: 4 }
    const overrides = new Map([['2026-10', { statementDate: '2026-09-23' }]])
    const [oct, nov] = cardCycles(days, overrides, '2026-10', '2026-11')
    expect(oct).toMatchObject({ closing: '2026-09-23', closingCustom: true })
    expect(nov).toMatchObject({ from: '2026-09-24', closing: '2026-10-24' })
  })

  it('kesim son ödemeden sonraysa işaretlenir', () => {
    expect(cardCycle({ statementDay: 24, dueDay: 4 }, '2026-10', { statementDate: '2026-10-06' }).invalid).toBe(true)
  })

  it('ardışık döngüler boşluksuz ve örtüşmesiz', () => {
    const cs = cardCycles({ statementDay: 28, dueDay: 7 }, new Map(), '2026-01', '2026-12')
    for (let i = 1; i < cs.length; i++) {
      const next = new Date(cs[i - 1].closing + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1)
      expect(cs[i].from).toBe(next.toISOString().slice(0, 10))
    }
  })
})
