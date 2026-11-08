import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseOdeabankCard } from './odeabank-card'
import { parseStatement } from './statement'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

// Gerçek ekstredeki konumlar: tarih 67, açıklama 129, Borç Tutarı sağ kenarı 425,
// Kalan Taksit 465, Chip Para sağ kenarı 571.
const header = (y: number) => [left(70, 'İşlem Tarihi', y), left(128, 'Dönem İçi İşlemler', y), right(420, 'Borç Tutarı (TL)', y), left(439, 'Kalan Taksit', y), right(563, 'Chip Para (TL)', y)]

const page1 = {
  lines: groupLines([
    left(48, 'Dönem Borcu', 738), left(184, ': 1,642.72 TL', 738),
    left(48, 'Dönem Başlangıç Tarihi', 725), left(184, ': 25/08/2026', 725),
    left(48, 'Son Ödeme Tarihi', 711), left(184, ': 05/10/2026', 711),
    left(48, 'Asgari Ödeme Tutarı', 697), left(184, ': 328.54 TL', 697),
    left(48, 'Hesap Kesim Tarihi', 683.5), left(184, ': 24/09/2026', 682.6), left(369, '34400 KAĞITHANE / İSTANBUL', 682.3),
    left(48, 'Bir Sonraki Hesap Kesim Tarihi', 670), left(184, ': 24/10/2026', 670),
    left(48, 'Bir Sonraki Son Ödeme Tarihi', 656), left(184, ': 03/11/2026', 656),
    left(48, 'Kart Numarası', 615), left(184, ': 5273 83** **** 1234 / MasterCard', 615),
    left(67, '(+) Önceki Hesap Bakiyeniz', 352), left(168, '(+) Dönem İçi Harcamalarınız', 352), left(289, '(+) Toplam Faiz ve', 352), left(396, '(-) Ödemeleriniz', 352), left(491, '(=) Dönem Borcunuz', 352),
    left(92, '500.00 TL', 328), left(197, '1,642.72 TL', 328), left(307, '0.00 TL', 328), left(401, '500.00 TL', 328), left(506, '1,642.72 TL', 328),
    ...header(251),
    left(128, 'Önceki Dönem Hesap Özeti Bakiyesi', 233), right(425, '500.00', 233),
    left(67, '04/09/2026', 216), left(129, 'Ödemeniz için tesekkür ederiz.', 216), right(425, '(-) 500.00', 216),
    left(67, '26/08/2026', 163), left(129, 'NAZLIM ECZANESI', 163), left(218, 'ISTANBUL', 163), left(273, 'TU 2/1. taksit', 163), right(425, '162.72', 163), left(463, '1', 163),
    left(129, '27/08/2026 vadeli', 154),
    left(67, '27/08/2026', 139), left(129, 'SHELL ACIBADEM', 139), left(218, 'ISTANBUL', 139), left(273, 'TR', 139), right(425, '130.00', 139), right(571, '0.03', 139),
    left(67, 'Ara Toplam', 95), right(425, '292.72', 95),
    left(35, 'Odea Bank A.Ş', 74),
  ]),
}
const page2 = {
  lines: groupLines([
    ...header(710),
    left(65, '02/09/2026', 692), left(127, 'NOMUPA /S SPORT PLUS', 692), left(231, 'ISTANBUL', 692), left(286, 'TR', 692), right(421, '1,350.00', 692),
    left(65, 'Toplam Borç', 678), right(421, '1,642.72', 678), right(567, '0.03', 678),
  ]),
}

describe('Odeabank kredi kartı ekstresi', () => {
  it('tarihler, özet, satırlar ve dönem borcu kontrolü', () => {
    const st = parseOdeabankCard([page1, page2])!
    expect(st).toMatchObject({
      bank: 'odeabank', type: 'credit_card', cards: ['1234'], statementDate: '2026-09-24', dueDate: '2026-10-05',
      prevStatementDate: '2026-08-24', nextStatementDate: '2026-10-24', nextDueDate: '2026-11-03',
    })
    expect(st.summary).toEqual({ previous: 500, spending: 1642.72, fees: 0, payments: 500, debt: 1642.72, minPayment: 328.54 })
    expect(st.check).toMatchObject({ ok: true, computed: 1642.72, expected: 1642.72 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.bonus, l.description])).toEqual([
      [null, 'carry', 500, null, 'Önceki dönem bakiyesi'],
      ['2026-09-04', 'payment', -500, null, 'Ödemeniz için tesekkür ederiz.'],
      ['2026-08-27', 'purchase', 162.72, null, 'NAZLIM ECZANESI'],
      ['2026-08-27', 'purchase', 130, 0.03, 'SHELL ACIBADEM'],
      ['2026-09-02', 'purchase', 1350, null, 'NOMUPA /S SPORT PLUS'],
    ])
    // "2/1. taksit": 2 taksitin 1.'si; satır tarihi "vadeli" tarihinden
    expect(st.lines[2].installment).toEqual({ index: 1, count: 2, total: 325.44 })
    expect(parseStatement([page1, page2]).bank).toBe('odeabank')
  })

  it('eksik satır toplamı bozar', () => {
    const broken = { lines: page2.lines.filter(l => !l.text.includes('NOMUPA')) }
    const st = parseOdeabankCard([page1, broken])!
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(-1350)
  })

  it('vadesiz hesap dökümünü ya da başka bankayı tanımaz', () => {
    expect(parseOdeabankCard([{ lines: groupLines([left(20, 'Garanti Hesap Kesim Tarihi', 700)]) }])).toBeNull()
  })
})
