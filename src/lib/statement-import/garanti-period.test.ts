import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem } from './pdf-text'
import { parseGarantiPeriod } from './garanti-period'
import { parseStatement } from './statement'

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

// Gerçek listedeki konumlar: tarih 34, işlem 85, şehir 265, etiket 354,
// Bonus sağ kenarı 482, Tutar sağ kenarı 561.
const header = (y: number) => [left(34, 'Tarih', y), left(85, 'İşlem', y), left(354, 'Etiket', y), left(451, 'Bonus', y), right(561, 'Tutar (TL)', y)]
const row = (y: number, date: string, desc: string, tutar: string | null, bonus: string | null = null, city = 'İSTANBUL') => [
  left(34, date, y), left(85, desc, y), ...(city ? [left(265, city, y)] : []), left(354, 'Market', y),
  ...(bonus ? [right(482, bonus, y)] : []), ...(tutar ? [right(561, tutar, y)] : []),
]

const pages = [
  {
    lines: groupLines([
      left(450, 'T. Garanti Bankası A.Ş.', 800),
      left(30, 'Kredi kartınıza ait açık provizyon ve dönem içi işlem bilgileriniz aşağıda listelenmektedir.', 673),
      left(75, 'KART TİPİ', 628), left(207, 'KART NO', 628), left(295, 'Dönemiçi İşlemler - TL', 628),
      left(37, 'BONUS PLATINUM', 603), left(188, '5407 **** **** 1234', 603), left(319, '1.851,10 TL', 603), left(423, '30.10.2026', 603), left(502, '09.11.2026', 603),
      left(34, 'Açık Provizyon İşlemler - TL', 572),
      ...header(550),
      ...row(530, '07/11/2026', 'HGS YÜKLEME', '-500,00'),
      left(339, 'Toplam Açık Provizyon Tutarı :', 428), right(561, '500,00 TL', 428),
      left(34, 'Dönemiçi İşlemler - TL', 385),
      ...header(363),
      ...row(342, '28/11/2026', 'BEYMEN PERAKENDE VE TEKST (3/6)', '1.649,00'),
      ...row(321, '28/11/2026', 'BEYMEN PERAKENDE VE TEKST (3/6)', '-1.649,00'),
      ...row(300, '06/11/2026', 'MİGROS- ETHEMEFENDİ MİGRO', '-22,25', '0,01'),
    ]),
  },
  {
    lines: groupLines([
      ...header(799),
      ...row(780, '05/11/2026', 'HEPSİPAY-HEP*HEPSİBURADA', null, '-285,45'),
      ...row(760, '03/11/2026', 'TRENDYOLGO YEMEK', null, '+285,00', ''),
      ...row(740, '02/11/2026', 'IYZICO *AMAZON.COM.T (1/3)', '-1.328,85', '6,22'),
      left(354, 'Toplam TL Harcama Tutarı :', 105), right(561, '1.351,10 TL', 105),
    ]),
  },
]

describe('Garanti dönem içi işlemler', () => {
  it('provizyon + dönem içi satırları; bonus borcu etkilemez; toplam tutar', () => {
    const st = parseGarantiPeriod(pages)!
    expect(st).toMatchObject({
      bank: 'garanti', provisional: true, cards: ['1234'], statementDate: '2026-11-07',
      prevStatementDate: '2026-10-30', dueDate: null, summary: null,
    })
    expect(st.check).toMatchObject({ ok: true, computed: 1851.1, expected: 1851.1, diff: 0 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.bonus, l.description])).toEqual([
      ['2026-11-02', 'purchase', 1328.85, 6.22, 'IYZICO *AMAZON.COM.T'],
      ['2026-11-03', 'bonus', null, 285, 'TRENDYOLGO YEMEK'],
      ['2026-11-05', 'bonus', null, -285.45, 'HEPSİPAY-HEP*HEPSİBURADA'],
      ['2026-11-06', 'purchase', 22.25, 0.01, 'MİGROS- ETHEMEFENDİ MİGRO'],
      ['2026-11-07', 'purchase', 500, null, 'HGS YÜKLEME'],
      ['2026-11-28', 'purchase', 1649, null, 'BEYMEN PERAKENDE VE TEKST'],
      ['2026-11-28', 'refund', -1649, null, 'BEYMEN PERAKENDE VE TEKST'],
    ])
    expect(st.lines[0].installment).toEqual({ index: 1, count: 3, total: 3986.55 })
    expect(st.lines[5].installment).toEqual({ index: 3, count: 6, total: 9894 })
    expect(parseStatement(pages).provisional).toBe(true)
  })

  it('toplam tutmazsa uyarır', () => {
    const broken = [pages[0], { lines: pages[1].lines.filter(l => !l.text.includes('AMAZON')) }]
    const st = parseGarantiPeriod(broken)!
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(-1328.85)
  })

  it('başka bankanın listesini tanımaz', () => {
    expect(parseGarantiPeriod([{ lines: groupLines([left(20, 'QNB Dönem İçi Hareketler', 700)]) }])).toBeNull()
  })
})
