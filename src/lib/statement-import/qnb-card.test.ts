import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseQnbPeriod, parseQnbStatement } from './qnb-card'
import { parseStatement } from './statement'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

describe('QNB ekstre', () => {
  // Gerçek ekstredeki konumlar: tarih 59, açıklama 124, Tutar sağ kenarı 449, ParaPuan 555.
  // Bazı Türkçe harfler ayrı yazı tipinde denetim kodu olarak gelir ("\u0004DEME").
  const page = {
    lines: groupLines([
      left(47, 'QNB Fix', 749),
      left(47, 'Kredi Kartı Numarası', 736), left(227, '5311 57** **** 1234', 736), left(381, 'deme Tarihi: 13 Ekim 2026, Salı', 736),
      left(47, 'Hesap Kesim Tarihi', 720), left(159, ':', 720), left(253, '03/10/2026', 720),
      left(56, 'İşlem Tarihi', 507), left(124, 'İşlem Açıklaması', 507), left(431, 'Tutar', 507), left(477, 'Taksit', 507), left(522, 'ParaPuan', 507),
      left(123, '\u0003nceki D\u0002nem Bakiyeniz', 490), right(449, '24.21', 490),
      left(59, 'ASIL KART: 5311 57** **** 1234 - AYŞE YILMAZ', 482),
      left(59, '14/09/2026', 474), left(124, 'deme - Tesekk', 474), left(176, '\u0000', 474), left(179, 'r Ederiz -', 474), right(449, '-24.21', 474),
      left(59, '19/09/2026', 465), left(124, 'TAM', 465), left(141, '-', 465), left(143, '\u0004', 465), left(148, 'DEME /STARBUCKS', 465), right(449, '1,350.00', 465),
      left(59, '24/09/2026', 456), left(124, 'YEMEKPAY', 456), left(170, '/YEMEKSEPE 337.05 al', 456), left(246, '\u0001', 456), left(250, 'v ind', 456), right(449, '-37.45', 456),
      left(124, 'Bu alışverişinizin sipariş kodu: 10000000001', 447),
      left(59, '28/09/2026', 272), left(124, 'ParaPuan Kullanımı -LCW.COM', 272), right(555, '-249,460', 272),
      left(59, 'Genel Toplam - TL Hesap Ekstresi', 212), right(449, '1,312.55', 212),
      left(80, '24.21', 169), left(161, '1,350.00', 169), left(238, '0.00', 169), left(303, '0.00', 169), left(378, '0.00', 169), left(448, '-61.66', 169), left(516, '1,312.55 TL', 169),
      left(47, '* Bir sonraki hesap kesim tarihiniz', 112), left(154, '03/11/2026', 112), left(189, ', bir sonraki son', 112), left(244, 'deme tarihiniz', 112), left(290, '13/11/2026', 112),
    ]),
  }

  it('satırlar, tarihler ve dönem borcu kontrolü', () => {
    const st = parseQnbStatement([page])!
    expect(st).toMatchObject({ bank: 'qnb', statementDate: '2026-10-03', dueDate: '2026-10-13', nextStatementDate: '2026-11-03', nextDueDate: '2026-11-13', cards: ['1234'] })
    expect(st.summary).toMatchObject({ previous: 24.21, spending: 1350, payments: 61.66, debt: 1312.55 })
    expect(st.check.ok).toBe(true)
    expect(st.lines.map(l => [l.kind, l.amount, l.description])).toEqual([
      ['carry', 24.21, 'Önceki dönem bakiyesi'],
      ['payment', -24.21, 'Ödeme - Tesekkür Ederiz -'],
      ['purchase', 1350, 'TAM - ÖDEME /STARBUCKS'],
      ['refund', -37.45, 'YEMEKPAY /YEMEKSEPE 337.05 alşv ind'],
    ])
    expect(parseStatement([page]).bank).toBe('qnb')
  })
})

describe('QNB dönem içi işlemler', () => {
  const page = {
    lines: groupLines([
      left(20, '03/11/2026 tarihli son 4 hanesi 1234 olan kartınıza ait Dönem İçi Hareketler', 733),
      left(21, 'İşlem Tarihi', 706), left(96, 'Açıklama', 706), right(422, 'Tutar', 706), left(538, 'ParaPuan', 706),
      left(20, '13/10/2026', 686), left(95, 'Ödeme - Tesekkür Ederiz -', 686), right(421, '-3278,05 TRY', 686), left(485, '0/0,0', 686),
      left(20, '24/10/2026', 666), left(95, 'BITAKSI 34 TR', 666), right(421, '467,0 TRY', 666), left(485, '1/1,0', 666),
      left(20, '05/10/2026', 646), left(95, 'YEMEKPAY /YEMEKSEPE 414.00 alşv ind', 646), right(421, '-46,0 TRY', 646),
      left(20, '01/11/2026', 626), left(95, 'İlk Alışverişine 500 TL PP Geri Alım', 626), right(421, '-0,0 TRY', 626), right(574, '-540,0', 626),
    ]),
  }
  it('tarihe göre sıralı satırlar; toplam kontrolü yok', () => {
    const st = parseQnbPeriod([page])!
    expect(st).toMatchObject({ provisional: true, statementDate: '2026-11-03', dueDate: null, cards: ['1234'] })
    expect(st.lines.map(l => [l.date, l.kind, l.amount])).toEqual([
      ['2026-10-05', 'refund', -46],
      ['2026-10-13', 'payment', -3278.05],
      ['2026-10-24', 'purchase', 467],
    ])
  })
})
