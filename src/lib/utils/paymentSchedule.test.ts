import { describe, it, expect } from 'vitest'
import type { PaymentSchedule } from '@/types'
import {
  addMonthsKey, defaultDueDateForMonth, dueDateForMonth, isIsoDay, isPaymentDue,
  overrideBounds, resolvePeriod, validateOverride,
} from './paymentSchedule'

/* ────────────────────────────────────────────────────────────────────────
   Ödeme Takvimi — dönem çözümleme

   Kural: hatırlatma ÖDENMEMİŞ EN ESKİ döneme bakar. Eski kural yalnızca
   bugünün ayına bakıyordu; bu testler onun ürettiği hataları sabitler:
     • sonraki aya kaydırılan tarih (30 Eylül → 1 Ekim) hiç hatırlatılmıyordu,
     • "vadesi geldi" ay sonuna kadar sönmüyordu (dueDay=1 → hiç sönmüyordu),
     • ondalıklı dueDay "2026-09-5.5" üretip sayfayı çökertiyordu.
──────────────────────────────────────────────────────────────────────── */

const base = (p: Partial<PaymentSchedule> = {}): PaymentSchedule => ({
  id: 's1', name: 'Kart', type: 'credit_card', dueDay: 5, isActive: true,
  createdAt: '2026-01-01T09:00:00', ...p,
})

describe('ay anahtarları ve varsayılan tarih', () => {
  it('addMonthsKey yıl sınırını iki yönde de sarar', () => {
    expect(addMonthsKey('2026-12', 1)).toBe('2027-01')
    expect(addMonthsKey('2026-01', -1)).toBe('2025-12')
    expect(addMonthsKey('2026-05', -17)).toBe('2024-12')
  })

  it('kısa aylarda ay sonuna sabitlenir', () => {
    expect(defaultDueDateForMonth(31, '2026-02')).toBe('2026-02-28')
    expect(defaultDueDateForMonth(31, '2028-02')).toBe('2028-02-29')
    expect(defaultDueDateForMonth(31, '2026-04')).toBe('2026-04-30')
  })

  it('bozuk dueDay (ondalık/NaN) geçerli bir ISO gün üretir', () => {
    expect(defaultDueDateForMonth(5.5, '2026-09')).toBe('2026-09-05')
    expect(isIsoDay(defaultDueDateForMonth(Number.NaN, '2026-09'))).toBe(true)
  })

  it('geçersiz override yok sayılır', () => {
    const s = base({ overrides: { '2026-09': '2026-09-5.5', '2026-10': '2026-02-30' } })
    expect(dueDateForMonth(s, '2026-09')).toBe('2026-09-05')
    expect(dueDateForMonth(s, '2026-10')).toBe('2026-10-05')
  })
})

describe('resolvePeriod — ödenmemiş en eski dönem', () => {
  it('ödenmemiş dönem ödendi işaretlenene kadar gecikmiş kalır, sonra kalkar', () => {
    const s = base({ createdAt: '2026-09-01T09:00:00' })
    const before = resolvePeriod(s, '2026-09-23')
    expect(before).toMatchObject({ monthKey: '2026-09', date: '2026-09-05', status: 'overdue', daysDelta: -18 })

    const paid = { ...s, paidMonths: { '2026-09': '2026-09-23' } }
    expect(resolvePeriod(paid, '2026-09-23')).toMatchObject({ monthKey: '2026-10', date: '2026-10-05', status: 'normal' })
    expect(isPaymentDue(paid, '2026-09-23')).toBe(false)
  })

  it('dueDay=1: ödenince rozet söner (eskiden ayın her günü due idi)', () => {
    const s = base({ dueDay: 1, createdAt: '2026-09-01T09:00:00', paidMonths: { '2026-09': '2026-09-01' } })
    for (let d = 2; d <= 23; d++) {
      expect(isPaymentDue(s, `2026-09-${String(d).padStart(2, '0')}`)).toBe(false)
    }
  })

  it('sonraki aya kaydırılan tarih günü gelince "bugün" olur (30 Eylül → 1 Ekim)', () => {
    const s = base({
      dueDay: 30, createdAt: '2026-09-01T09:00:00',
      overrides: { '2026-09': '2026-10-01' },
    })
    expect(resolvePeriod(s, '2026-09-30')).toMatchObject({ monthKey: '2026-09', status: 'upcoming', daysDelta: 1 })
    expect(resolvePeriod(s, '2026-10-01')).toMatchObject({ monthKey: '2026-09', date: '2026-10-01', status: 'today' })
    expect(isPaymentDue(s, '2026-10-01')).toBe(true)
  })

  it('önceki aya çekilen tarih o gün "bugün" olur, "0g kaldı" değil', () => {
    const s = base({
      dueDay: 1, createdAt: '2026-09-01T09:00:00',
      paidMonths: { '2026-09': '2026-09-01' },
      overrides: { '2026-10': '2026-09-30' },
    })
    expect(resolvePeriod(s, '2026-09-30')).toMatchObject({ monthKey: '2026-10', status: 'today', daysDelta: 0 })
  })

  it('ay sınırını aşan yakın vade "upcoming" (ödenmiş ay atlanır)', () => {
    const s = base({ createdAt: '2026-09-01T09:00:00', paidMonths: { '2026-09': '2026-09-04' } })
    expect(resolvePeriod(s, '2026-09-29')).toMatchObject({ monthKey: '2026-10', status: 'upcoming', daysDelta: 6 })
  })

  it('oluşturulmadan önceki dönemler gecikmiş sayılmaz', () => {
    // 23 Eylül'de, günü 5 olan bir kart eklendi → Eylül dönemi kapsam dışı
    const s = base({ createdAt: '2026-09-23T10:00:00' })
    expect(resolvePeriod(s, '2026-09-23')).toMatchObject({ monthKey: '2026-10', status: 'normal', daysDelta: 12 })
  })

  it('oluşturulduğu günün son ödeme günü "bugün"', () => {
    const s = base({ dueDay: 23, createdAt: '2026-09-23T10:00:00' })
    expect(resolvePeriod(s, '2026-09-23').status).toBe('today')
  })

  it('birikmiş ödenmemiş dönemleri sayar; en eskisini gösterir', () => {
    const s = base({ createdAt: '2026-07-01T09:00:00' })
    expect(resolvePeriod(s, '2026-09-23')).toMatchObject({ monthKey: '2026-07', unpaidDueCount: 3 })
  })

  it('geriye en fazla 12 ay bakar', () => {
    const s = base({ createdAt: '2020-01-01T09:00:00' })
    const r = resolvePeriod(s, '2026-09-23')
    expect(r.monthKey).toBe('2025-09')
    expect(r.unpaidDueCount).toBe(13)
  })

  it('pasif takvim hiçbir zaman due değildir', () => {
    expect(isPaymentDue(base({ isActive: false }), '2026-09-23')).toBe(false)
  })
})

describe('override doğrulaması', () => {
  it('komşu dönemlerin arasına izin verir — komşu aya taşma dahil', () => {
    const s = base({ dueDay: 30 })
    expect(overrideBounds(s, '2026-09')).toEqual({ min: '2026-08-31', max: '2026-10-29' })
    expect(validateOverride(s, '2026-09', '2026-10-01')).toBeNull()
  })

  it('komşu dönemi geçen, ay dışı ya da bozuk tarihi reddeder', () => {
    const s = base({ dueDay: 30 })
    expect(validateOverride(s, '2026-09', '2027-03-15')).not.toBeNull()
    expect(validateOverride(s, '2026-09', '2026-10-30')).not.toBeNull()
    expect(validateOverride(s, '2026-09', '2026-08-30')).not.toBeNull()
    expect(validateOverride(s, '2026-09', '')).not.toBeNull()
  })
})
