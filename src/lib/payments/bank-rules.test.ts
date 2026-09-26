import { describe, it, expect } from 'vitest'
import { isBusinessDay, isHoliday, nextBusinessDay } from './tr-holidays'
import { bankRuleFor, gapBetween, nominalDueDay, resolveCardDays } from './bank-rules'
import { cardCycle, cardCycles } from './card-cycles'

describe('tr-holidays', () => {
  it('sabit ve dini tatiller; arife iş günü', () => {
    expect(isHoliday('2026-04-23')).toBe(true)
    expect(isHoliday('2026-10-29')).toBe(true)
    expect(isHoliday('2026-03-20')).toBe(true)   // Ramazan Bayramı 1. gün
    expect(isHoliday('2026-05-27')).toBe(true)   // Kurban Bayramı 1. gün
    expect(isHoliday('2026-03-19')).toBe(false)  // arife — yarım gün, bankalar açık
    expect(isHoliday('2027-03-09')).toBe(true)
  })

  it('hafta sonu ve tatil sonrası ilk iş günü', () => {
    expect(isBusinessDay('2026-10-04')).toBe(false)             // Pazar
    expect(nextBusinessDay('2026-10-03')).toBe('2026-10-05')    // Cumartesi → Pazartesi
    expect(nextBusinessDay('2026-05-27')).toBe('2026-06-01')    // Kurban Bayramı + hafta sonu
    expect(nextBusinessDay('2026-10-28')).toBe('2026-10-28')    // 28 Ekim yarım gün → iş günü
  })
})

describe('bank-rules', () => {
  it('kart adından banka; VakıfBank kesimi de kaydırır', () => {
    expect(bankRuleFor('Garanti Platinum')).toMatchObject({ key: 'garanti', gapDays: 10, holidayRule: 'due' })
    expect(bankRuleFor('Yapı Kredi Platinum').key).toBe('yapikredi')
    expect(bankRuleFor('QNB').key).toBe('qnb')
    expect(bankRuleFor('Kuveyt Türk').key).toBe('kuveyt')
    expect(bankRuleFor('Odeabank Private').key).toBe('odea')
    expect(bankRuleFor('Burgan').key).toBe('burgan')
    expect(bankRuleFor('VakıfBank World').holidayRule).toBe('both')
    expect(bankRuleFor('Getir').key).toBe('other')
  })

  it('nominal son ödeme günü ve fark', () => {
    expect(nominalDueDay(24, 10)).toBe(4)
    expect(nominalDueDay(1, 10)).toBe(11)
    expect(nominalDueDay(28, 10)).toBe(8)
    expect(gapBetween(24, 4)).toBe(10)
    expect(gapBetween(11, 16)).toBe(5)
    expect(gapBetween(17, 17)).toBe(30)
  })

  it('kartın günleri: son ödeme yoksa banka kuralı; tutarlıysa türetilir; olağan dışıysa işaretlenir', () => {
    const acc = (statementDay: number) => ({ name: 'Garanti Business', statementDay })
    expect(resolveCardDays(acc(11), null).days).toMatchObject({ gapDays: 10, holidayRule: 'due' })
    expect(resolveCardDays(acc(24), { dayOfMonth: 4 }).days.gapDays).toBe(10)
    const odd = resolveCardDays(acc(11), { dayOfMonth: 16 })
    expect(odd.days.gapDays).toBeNull()
    expect(odd.inconsistent).toEqual({ gap: 5, suggestDue: 21, suggestClosing: 6 })
    expect(resolveCardDays({ ...acc(11), dueGapDays: 12 }, { dayOfMonth: 16 }).days.gapDays).toBe(12)
  })
})

describe('kesim + fark ve tatil kuralı', () => {
  it('yalnız son ödeme kayar (Garanti vb.): kesim yerinde, son ödeme ilk iş günü', () => {
    const days = { statementDay: 24, dueDay: null, gapDays: 10, holidayRule: 'due' as const }
    // Eylül 24 + 10 = 4 Ekim Pazar → 5 Ekim
    expect(cardCycle(days, '2026-10')).toMatchObject({ closing: '2026-09-24', dueDate: '2026-10-05', dueShifted: true, closingShifted: false })
    // Ay uzunluğu: 24 Şubat + 10 = 6 Mart (Cuma)
    expect(cardCycle(days, '2026-03')).toMatchObject({ closing: '2026-02-24', dueDate: '2026-03-06', dueShifted: false })
  })

  it('kesim ile aynı ay ödenen kart (11 + 10)', () => {
    expect(cardCycle({ statementDay: 11, dueDay: null, gapDays: 10, holidayRule: 'due' }, '2026-10'))
      .toMatchObject({ closing: '2026-10-11', dueDate: '2026-10-21' })
  })

  it('kesim de kayar (VakıfBank): 2026 tablosundaki satırları üretir', () => {
    const cycle = (sd: number, m: string) => cardCycle({ statementDay: sd, dueDay: null, gapDays: 10, holidayRule: 'both' }, m)
    // [kesim günü, ödeme ayı, beklenen kesim, beklenen son ödeme] — vakifkart.com.tr
    const rows: [number, string, string, string][] = [
      [5, '2026-02', '2026-02-06', '2026-02-16'],   // 15 Şubat Pazar
      [10, '2026-03', '2026-03-13', '2026-03-23'],  // 20–22 Mart Ramazan Bayramı
      [13, '2026-04', '2026-04-14', '2026-04-24'],  // 23 Nisan
      [5, '2026-04', '2026-04-05', '2026-04-15'],   // kesim Pazar olabilir
      [23, '2026-10', '2026-09-25', '2026-10-05'],  // 3 Ekim Cumartesi
      [30, '2026-05', '2026-05-01', '2026-05-11'],  // 10 Mayıs Pazar; kesim 1 Mayıs tatilinde olabilir
    ]
    for (const [sd, m, c, d] of rows) expect(cycle(sd, m)).toMatchObject({ closing: c, dueDate: d })
  })

  it('her ödeme ayına tek ekstre, dönemler boşluksuz', () => {
    const cs = cardCycles({ statementDay: 20, dueDay: null, gapDays: 10, holidayRule: 'due' }, new Map(), '2026-01', '2026-12')
    expect(new Set(cs.map(c => c.closing)).size).toBe(12)
    for (let i = 1; i < cs.length; i++) expect(cs[i].from > cs[i - 1].closing).toBe(true)
  })
})
