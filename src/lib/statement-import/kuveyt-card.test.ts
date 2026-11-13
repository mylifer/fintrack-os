import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseKuveytCard } from './kuveyt-card'
import { parseStatement } from './statement'
import { expectSameAcrossPageBreak } from './test-helpers'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

// Gerçek ekstredeki konumlar: üst bilgi etiketi 331, değeri sağ kenarı 574;
// tablo tarih 34, açıklama 93, TUTAR 476 (değerler sağa yaslı, 513), ALTIN PUAN 570.
const label = (y: number, tr: string, en: string, value: string) => [left(331, `${tr} /`, y), left(400, en, y), right(574, value, y)]

const page = (rows: PdfItem[]) => ({
  lines: groupLines([
    left(30, 'KREDİ KARTI EKSTRESİ / Credit Card Statement', 760),
    ...label(712, 'Kart No', 'Card Number', '518896******1234'),
    ...label(667, 'Hesap Kesim Tarihi', 'Statement Issue Date', '23/10/2026'),
    ...label(658, 'Son Ödeme Tarihi', 'Due Date for Payment', '02/11/2026'),
    ...label(650, 'Dönem Borcunuz', 'Your Current Debt', '1.600,00 TL'),
    ...label(642, 'Asgari Ödeme Tutarı', 'Minimum Payment Amount', '1.600,00 TL'),
    ...label(605, 'Sonraki Hesap Kesim Tarihi', 'Next Statement Date', '23/11/2026'),
    ...label(596, 'Sonraki Son Ödeme Tarihi', 'Next Due Date for Payment', '03/12/2026'),
    left(34, 'İŞLEM TARİHİ', 537), left(93, 'İŞLEM AÇIKLAMASI', 537), left(476, 'TUTAR', 537), left(526, 'ALTIN', 537), left(547, 'PUAN', 537),
    left(93, '518896******1234 ile yapılan işlemler', 518),
    ...rows,
    left(111, 'Devreden Bakiye', 460), left(222, 'Dönem Harcamaları', 460), left(335, 'Ödemeleriniz', 460), left(448, 'Dönem Borcunuz', 460),
    left(123, '1.350,00', 444.3), left(186, '+', 443.7), left(233, '1.600,00', 444.3), left(339, '1.350,00', 444.3), left(461, '1.600,00', 444.3),
    left(299, '-', 440.7), left(412, '=', 441.2),
    left(130, '0,00', 400), left(241, '0,00', 400), left(347, '0,00', 400), left(465, '0,00', 400),
    left(30, 'Kuveyt Türk Katılım Bankası A.Ş.', 100),
  ]),
})

const rows = [
  left(34, '13/08/2026', 505), left(94, 'Taksit - ÖZEL DURU VETERİNERL', 505), left(217, 'İSTANBUL', 505), left(263, 'TR', 505),
  left(349, '6.750,00 TL İşlemin 3 / 5 Taksidi', 505), right(513, '1.350,00 TL', 505), right(570, '0.00', 505),
  left(34, '05/10/2026', 489), left(94, 'Kredi Kartı Borç Ödeme', 489), right(513, '-1.350,00 TL', 489), right(570, '0.00', 489),
  left(34, '10/10/2026', 473), left(94, 'MİGROS ERENKÖY', 473), left(217, 'İSTANBUL', 473), left(263, 'TR', 473), right(513, '250,00 TL', 473), right(570, '2.50', 473),
]

describe('Kuveyt Türk kredi kartı ekstresi', () => {
  it('tarihler, devir, taksit, ödeme ve dönem borcu kontrolü', () => {
    const st = parseKuveytCard([page(rows)])!
    expect(st).toMatchObject({
      bank: 'kuveyt', cards: ['1234'], statementDate: '2026-10-23', dueDate: '2026-11-02',
      nextStatementDate: '2026-11-23', nextDueDate: '2026-12-03',
    })
    expect(st.summary).toEqual({ previous: 1350, spending: 1600, fees: 0, payments: 1350, debt: 1600, minPayment: 1600 })
    expect(st.check).toMatchObject({ ok: true, computed: 1600, expected: 1600 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.bonus, l.description])).toEqual([
      [null, 'carry', 1350, null, 'Önceki dönem bakiyesi'],
      // Alım 13 Ağu, 3. taksit: satır tarihi alım + 2 ay
      ['2026-10-13', 'purchase', 1350, null, 'ÖZEL DURU VETERİNERL'],
      ['2026-10-05', 'payment', -1350, null, 'Kredi Kartı Borç Ödeme'],
      ['2026-10-10', 'purchase', 250, 2.5, 'MİGROS ERENKÖY'],
    ])
    expect(st.lines[1].installment).toEqual({ index: 3, count: 5, total: 6750 })
    expect(parseStatement([page(rows)]).bank).toBe('kuveyt')
  })

  it('eksik satır toplamı bozar', () => {
    const st = parseKuveytCard([page(rows.filter(i => i.y !== 473))])!
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(-250)
  })

  it('başka bankayı tanımaz', () => {
    expect(parseKuveytCard([{ lines: groupLines([left(30, 'Garanti Hesap Kesim Tarihi', 700)]) }])).toBeNull()
  })

  it('tablo başlıksız bir sonraki sayfaya taşsa da aynı okunur', () => {
    expectSameAcrossPageBreak(parseKuveytCard, [page(rows)], 'MİGROS ERENKÖY')
  })
})
