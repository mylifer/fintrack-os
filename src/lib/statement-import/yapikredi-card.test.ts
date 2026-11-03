import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseYapiKrediCard } from './yapikredi-card'
import { parseStatement } from './statement'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

// Gerçek hesap özetindeki konumlar: tarih 40, açıklama 104, Tutar(TL) sağ kenarı 427
const page = {
  lines: groupLines([
    left(28, 'HESAP BİLGİLERİ', 749),
    left(28, 'Hesap Kesim Tarihi', 737), left(198, ':', 737), left(202, '18 Ekim 2026', 737),
    left(28, 'Son Ödeme Tarihi', 727), left(198, ': 28 Ekim 2026', 727),
    left(28, 'Dönem Borcu', 716), left(198, ': 2.000,00 TL', 716),
    left(28, 'Önceki Dönem Hesap Özeti Borcu', 685), left(198, ': 1.000,00 TL', 685), left(337, 'ÖRNEK MAH.', 685),
    left(28, 'Dönem İçi Harcamalar', 675), left(198, ': 2.000,00 TL', 675),
    left(28, 'Dönem İçi Ödemeler', 662), left(198, ': +1.000,00 TL', 662),
    left(28, 'Bir Sonraki Ay Hesap Kesim Tarihi', 629), left(198, ': 18 Kasım 2026', 629),
    left(28, 'Bir Sonraki Ay Son Ödeme Tarihi', 618), left(198, ': 30 Kasım 2026', 618),
    left(28, 'Kart Numarası', 575), left(198, ': 5258 64** **** 1234', 575),
    left(40, 'İşlem Tarihi', 424), left(104, 'İşlemler', 424), left(387, 'Tutar(TL)', 424), left(442, 'Kalan Tutar/Taksit', 424), left(545, 'Puan', 424),
    left(104, 'ÖNCEKİ DÖNEM HESAP ÖZETİ BORCU', 415), right(427, '1.000,00', 415),
    left(40, '28 Eylül 2026', 405), left(105, 'ÖDEME-İNTERNET BANKACILIĞI', 405), right(427, '+1.000,00', 405),
    left(40, '29 Nisan 2026', 392), left(105, 'ORNEK GIYIM', 392), left(194, 'ISTANBUL', 392), left(238, 'TR', 392), right(427, '1.200,00', 392),
    left(105, "7.200,00 TL'lik işlemin 6 / 6 taksidi", 382),
    left(40, '06 Eylül 2026', 372), left(105, 'ORNEK MAGAZA', 372), right(427, '800,00', 372), left(483, '2.400,00 / 3', 372),
    left(105, "4.000,00 TL'lik işlemin 2 / 5 taksidi", 363),
    left(40, 'TOPLAM', 351), right(427, '2.000,00', 351),
    left(12, 'YAPI ve KREDİ BANKASI A.Ş.', 133),
  ]),
}

describe('Yapı Kredi hesap özeti', () => {
  it('başlık, taksitler (alım tarihi → taksit dönemi) ve toplam kontrolü', () => {
    const st = parseYapiKrediCard([page])!
    expect(st).toMatchObject({ bank: 'yapikredi', statementDate: '2026-10-18', dueDate: '2026-10-28', nextStatementDate: '2026-11-18', nextDueDate: '2026-11-30', cards: ['1234'] })
    expect(st.summary).toMatchObject({ previous: 1000, spending: 2000, payments: 1000, debt: 2000 })
    expect(st.check.ok).toBe(true)
    expect(st.lines.map(l => [l.kind, l.date, l.amount, l.installment])).toEqual([
      ['carry', null, 1000, null],
      ['payment', '2026-09-28', -1000, null],
      ['purchase', '2026-09-29', 1200, { total: 7200, index: 6, count: 6 }],   // 29 Nis + 5 ay
      ['purchase', '2026-10-06', 800, { total: 4000, index: 2, count: 5 }],
    ])
    expect(parseStatement([page]).bank).toBe('yapikredi')
  })
})
