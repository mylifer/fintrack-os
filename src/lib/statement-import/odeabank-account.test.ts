import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem, type PdfPage } from './pdf-text'
import { parseOdeabankAccount } from './odeabank-account'
import { parseStatement } from './statement'

// Gerçek dökümdeki konumlar (pt): tarih 15, işlem 138, Tutar sağ kenarı 702, Bakiye sağ kenarı 825
const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })
const row = (y: number, dt: string, desc: string, amount: string, balance: string) =>
  [left(15, dt, y), left(138, desc, y), right(702, amount, y), right(825, balance, y)]

function page(rows: PdfItem[][]): PdfPage {
  return {
    lines: groupLines([
      left(10, 'Hesap', 938), left(142, 'Hareketleri', 938),
      left(10, 'Ad Soyad/Ünvan', 897), left(200, ': AYŞE YILMAZ', 897),
      left(10, 'IBAN', 863), left(200, ': TR120014600000000000000001', 863),
      left(10, 'Tarih Aralığı', 846), left(200, ': 03.08.2026 Pzt - 03.11.2026 Sal', 846),
      left(15, 'Tarih', 812), left(138, 'İşlem', 812), { x: 642, right: 702, y: 812, str: 'Tutar(TRY)' }, { x: 757, right: 825, y: 812, str: 'Bakiye(TRY)' },
      ...rows.flat(),
    ]),
  }
}

// Yeniden eskiye: her satırın bakiyesi = alttakinin bakiyesi + tutarı
const sample = () => page([
  row(795, '03.11.2026 02:43', 'Oksijen Devam Faizi - Gelir Vergisi Stopaj Kesintisi', '-32,46', '208.207,32'),
  row(778, '03.11.2026 02:43', '%36,00 Oksijen Devam Faizi - Faizi %', '+185,48', '208.239,78'),
  row(761, '02.11.2026 10:46', 'Banka: 0062 SN: 600000000000000001 Ayşe yılmaz Açk: 3612.76 TRY', '-3.612,76', '208.054,30'),
  [left(138, 'Gönd.', 744)],
  row(727, '01.11.2026 19:00', 'Banka: 0046 SN: 8361718 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk:', '+211.667,06', '211.667,06'),
  [left(141, 'Midas', 710)],
])

describe('parseOdeabankAccount', () => {
  it('başlık, sıralama, yön ve bakiye zinciri', () => {
    const st = parseOdeabankAccount([sample()])!
    expect(st).not.toBeNull()
    expect(st.type).toBe('checking')
    expect(st.account).toMatchObject({ owner: 'AYŞE YILMAZ', iban: 'TR120014600000000000000001', periodStart: '2026-08-03', periodEnd: '2026-11-03', openingBalance: 0, closingBalance: 208207.32 })
    expect(st.check.ok).toBe(true)
    // Eskiden yeniye; + çıkış, − giriş
    expect(st.lines.map(l => [l.date, l.time, l.amount, l.kind])).toEqual([
      ['2026-11-01', '19:00', -211667.06, 'credit'],
      ['2026-11-02', '10:46', 3612.76, 'debit'],
      ['2026-11-03', '02:43', -185.48, 'credit'],
      ['2026-11-03', '02:43', 32.46, 'debit'],
    ])
    // Alt satıra taşan açıklama birleşir
    expect(st.lines[0].description).toBe('Banka: 0046 SN: 8361718 MİDAS MENKUL DEĞERLER ANONİM ŞTİ. Açk: Midas')
    expect(st.lines[1].description.endsWith('Gönd.')).toBe(true)
    expect(parseStatement([sample()]).bank).toBe('odeabank')
  })

  it('bakiye zinciri koparsa kontrol başarısız olur', () => {
    const p = page([
      row(795, '03.11.2026 02:43', 'Stopaj Kesintisi', '-32,46', '208.207,32'),
      row(778, '02.11.2026 02:43', 'Faizi %', '+185,48', '208.000,00'),
    ])
    const st = parseOdeabankAccount([p])!
    expect(st.check.ok).toBe(false)
    expect(st.check.issues[0]).toContain('bakiye zinciri')
  })

  it('başka bankanın dökümünü tanımaz', () => {
    const p: PdfPage = { lines: groupLines([left(10, 'Hesap Hareketleri', 900), left(10, 'IBAN : TR120006200000000000000000', 880)]) }
    expect(parseOdeabankAccount([p])).toBeNull()
  })
})
