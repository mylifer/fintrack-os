import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseBurganCard } from './burgan-card'
import { parseStatement } from './statement'
import { expectSameAcrossPageBreak } from './test-helpers'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })
const row = (y: number, date: string | null, desc: string, amount: string) =>
  [...(date ? [left(41, date, y)] : []), left(109, desc, y), right(560, amount, y)]

// Gerçek ekstredeki konumlar: tarih 41, açıklama 109, Tutar sağ kenarı 560
const page = {
  lines: groupLines([
    left(401, 'Kredi Kartı Hesap Özeti', 775),
    left(39, 'Hesap Kesim Tarihi', 686), left(167, ':', 686), right(288, '07/10/2026', 686),
    left(39, 'Dönem Borcu (TL)', 674), left(167, ':', 674), right(288, '1,747.90', 674),
    left(39, 'Son Ödeme Tarihi', 650), left(167, ':', 650), right(288, '19/10/2026', 650),
    left(39, 'Bir Sonraki Hesap Kesim Tarihi', 639), left(167, ':', 639), right(288, '07/11/2026', 639),
    left(39, 'Bir Sonraki Son Ödeme Tarihi', 627), left(167, ':', 627), right(288, '17/11/2026', 627),
    left(41, '5418 75** **** 1234 NOLU KARTIN HARCAMALARI', 484),
    left(41, 'İşlem Tarihi', 462), left(109, 'İşlem Açıklama', 462), left(324, 'Kalan Tutar/Taksit:', 462), left(434, 'MaxiPuan', 462), left(536, 'Tutar:', 462),
    ...row(437, null, 'Önceki Dönem Ekstre Borcu', '10,000.00'),
    ...row(426, '07/09/2026', 'ORNEK BAKKAL ISTANBUL TR', '310.00'),
    ...row(415, '08/09/2026', 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kaz', '+62.10'),
    [left(41, '09/09/2026', 403), left(109, 'ORNEK KUAFOR ISTANBUL TR', 403), left(460, '0.07', 403), right(560, '1,500.00', 403)],
    ...row(392, '17/09/2026', 'KREDI KARTI BORC ODEME', '+10,000.00'),
    [left(41, 'BU KARTINIZLA YAPILAN İŞLEM TOPLAMI :', 380), right(560, '-8,252.10', 380)],
    left(365, 'Toplam Tutar:', 300), left(448, '1,747.90', 300),
    left(32, 'Burgan Bank A.Ş. Maslak Mah.', 30),
  ].flat()),
}

describe('Burgan (ON) ekstresi', () => {
  it('başlık, satırlar, "+" alacak ve toplam kontrolü', () => {
    const st = parseBurganCard([page])!
    expect(st).toMatchObject({ bank: 'burgan', statementDate: '2026-10-07', dueDate: '2026-10-19', nextStatementDate: '2026-11-07', nextDueDate: '2026-11-17', cards: ['1234'] })
    expect(st.check).toMatchObject({ ok: true, computed: 1747.9 })
    expect(st.lines.map(l => [l.kind, l.amount, l.description])).toEqual([
      ['carry', 10000, 'Önceki dönem bakiyesi'],
      ['purchase', 310, 'ORNEK BAKKAL ISTANBUL TR'],
      ['refund', -62.1, 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kaz'],
      ['purchase', 1500, 'ORNEK KUAFOR ISTANBUL TR'],
      ['payment', -10000, 'KREDI KARTI BORC ODEME'],
    ])
    expect(parseStatement([page]).bank).toBe('burgan')
  })

  it('tablo başlıksız bir sonraki sayfaya taşsa da aynı okunur', () => {
    expectSameAcrossPageBreak(parseBurganCard, [page], 'ORNEK KUAFOR')
  })
})
