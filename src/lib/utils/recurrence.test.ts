import { describe, it, expect } from 'vitest'
import { advanceDueDate, recurringOccurrences, nextDueAfter } from './recurrence'
import type { RecurringTransaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   recurrence — saf tekrarlama matematiği

   Bu modülün iki tüketicisi var ve İKİSİ DE aynı sonucu vermek zorunda:
   gerçek üretim (recurring sayfası "Kaydet" → recurring.store.markGenerated)
   ve projeksiyon (planned.ts → forecast/dashboard). Ayrışırlarsa kullanıcı
   projeksiyonda gördüğü işlemi kaydettiğinde farklı bir tarih alır.
──────────────────────────────────────────────────────────────────────── */

function rec(p: Partial<RecurringTransaction> & Pick<RecurringTransaction, 'nextDueDate' | 'frequency'>): RecurringTransaction {
  return {
    id: 'r1', name: 'Kira', type: 'expense', amount: 100, currency: 'TRY',
    accountId: 'a', description: 'Kira', startDate: p.nextDueDate,
    isActive: true, createdAt: '2026-01-01', ...p,
  }
}

describe('advanceDueDate', () => {
  it('her frekansı bir dönem ileri taşır', () => {
    expect(advanceDueDate('2026-03-10', 'daily')).toBe('2026-03-11')
    expect(advanceDueDate('2026-03-10', 'weekly')).toBe('2026-03-17')
    expect(advanceDueDate('2026-03-10', 'monthly')).toBe('2026-04-10')
    expect(advanceDueDate('2026-03-10', 'yearly')).toBe('2027-03-10')
  })

  it('ay ve yıl sınırlarını doğru geçer', () => {
    expect(advanceDueDate('2026-12-31', 'daily')).toBe('2027-01-01')
    expect(advanceDueDate('2026-12-15', 'monthly')).toBe('2027-01-15')
  })

  it('artık yılı doğru işler', () => {
    expect(advanceDueDate('2028-02-28', 'daily')).toBe('2028-02-29')   // 2028 artık yıl
    expect(advanceDueDate('2027-02-28', 'daily')).toBe('2027-03-01')
  })
})

describe('recurringOccurrences', () => {
  it('nextDueDate ile asOf arasındaki TÜM dönemleri üretir (çevrimdışı telafi)', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-04-20')).toEqual([
      '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15',
    ])
  })

  it('asOf gününe DENK gelen oluşumu dahil eder (kapsayıcı sınır)', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-02-15')).toEqual(['2026-01-15', '2026-02-15'])
  })

  it('endDate sonrasını üretmez ama endDate gününü dahil eder', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly', endDate: '2026-03-15' })
    expect(recurringOccurrences(r, '2026-12-31')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('nextDueDate geleceğe aitse hiçbir şey üretmez', () => {
    const r = rec({ nextDueDate: '2026-06-01', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-03-01')).toEqual([])
  })

  it('çok bayat bir nextDueDate sonsuz döngüye girmez (OCCURRENCE_CAP)', () => {
    const r = rec({ nextDueDate: '1990-01-01', frequency: 'daily' })
    expect(recurringOccurrences(r, '2026-01-01')).toHaveLength(1000)
  })
})

describe('nextDueAfter', () => {
  it('asOf tarihinden KESİNLİKLE sonraki ilk oluşumu verir', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly' })
    expect(nextDueAfter(r, '2026-03-20')).toBe('2026-04-15')
  })

  it('asOf oluşum gününe denk gelirse bir sonrakine geçer', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly' })
    expect(nextDueAfter(r, '2026-01-15')).toBe('2026-02-15')
  })

  it('recurringOccurrences ile tutarlıdır: üretilen son oluşumdan sonra gelir', () => {
    const r = rec({ nextDueDate: '2026-01-15', frequency: 'monthly' })
    const asOf = '2026-04-20'
    const occ  = recurringOccurrences(r, asOf)
    expect(nextDueAfter(r, asOf) > occ[occ.length - 1]).toBe(true)
  })
})

/* ── Ayın 29-31'i: gün kayması — düzeltilen hata #17 ──────────────────────
   date-fns `addMonths(31 Ocak, 1)` = 28 Şubat (ayın son gününe kırpar) ve sonuç
   nextDueDate olarak KALICI yazılıyordu: şablon ayın 31'ine bir daha dönmüyordu.
   Düzeltme: ay/yıl adımı başlangıç tarihinin gününe (çapa) geri döner. Formdaki
   "Ayın Günü" alanı takvimde hiç okunmadığı için kaldırıldı.
──────────────────────────────────────────────────────────────────────── */
describe('ayın 31\'i — düzeltilen hata #17', () => {
  it('kısa ayda ay sonuna kırpar', () => {
    expect(advanceDueDate('2026-01-31', 'monthly', 31)).toBe('2026-02-28')
  })

  it('kısa aydan sonra çapa güne geri döner (31 → 28 → 31)', () => {
    expect(advanceDueDate('2026-02-28', 'monthly', 31)).toBe('2026-03-31')
  })

  it('aylık dizi ayın gününü korur', () => {
    const r = rec({ nextDueDate: '2026-01-31', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ])
    expect(nextDueAfter(r, '2026-05-31')).toBe('2026-06-30')
  })

  it('daha önce 28\'e kaymış şablon bir sonraki adımda çapaya döner', () => {
    // Kaymış nextDueDate verisi yeniden YAZILMAZ; yalnız sonraki oluşum düzelir.
    const r = rec({ startDate: '2026-01-31', nextDueDate: '2026-09-28', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-11-30')).toEqual(['2026-09-28', '2026-10-31', '2026-11-30'])
  })

  it('çapası 28 ve altı olan şablonun farklı günlü eski nextDueDate\'i kaydırılmaz', () => {
    const r = rec({ startDate: '2026-01-20', nextDueDate: '2026-03-10', frequency: 'monthly' })
    expect(recurringOccurrences(r, '2026-04-15')).toEqual(['2026-03-10', '2026-04-10'])
  })

  it('yıllık 29 Şubat artık yılda yeniden 29\'a döner', () => {
    const r = rec({ nextDueDate: '2028-02-29', frequency: 'yearly' })
    expect(recurringOccurrences(r, '2032-03-01')).toEqual([
      '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29',
    ])
  })

  it('çapa verilmezse eski davranış korunur (günlük/haftalık etkilenmez)', () => {
    expect(advanceDueDate('2026-02-28', 'monthly')).toBe('2026-03-28')
    expect(advanceDueDate('2026-02-28', 'weekly', 31)).toBe('2026-03-07')
  })
})
