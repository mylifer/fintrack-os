import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem, type PdfPage } from './pdf-text'
import { parseGarantiCard, parseTrDate, parseTrAmount } from './garanti-card'
import { parseStatement } from './statement'

// Gerçek ekstredeki sütun konumları (pt): tarih 105, açıklama 170, taksit 303,
// Bonus sağ kenarı 445, Tutar sağ kenarı 553. Tutarlar sağa yaslıdır.
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })
const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })

function row(y: number, date: string | null, desc: string, opts: { inst?: string; bonus?: string; tutar?: string } = {}): PdfItem[] {
  const out: PdfItem[] = []
  if (date) out.push(left(105, date, y))
  out.push(left(170, desc, y))
  if (opts.inst) out.push(left(303, opts.inst, y))
  if (opts.bonus) out.push(right(445, opts.bonus, y))
  if (opts.tutar) out.push(right(553, opts.tutar, y))
  return out
}

function samplePage(extra: PdfItem[] = [], debt = '1.867,85'): PdfPage {
  const items: PdfItem[] = [
    left(36, 'Hesap Kesim Tarihi', 700), left(205, '30 Ekim 2026', 700),
    left(36, 'Son Ödeme Tarihi', 690), left(199, '09 Kasım 2026', 690),
    left(36, 'Dönem Borcunuz', 680), left(207, `${debt} TL`, 680),
    left(36, 'Kart Numarası', 670), left(184, '5407 09** **** 9010', 670),
    left(105, 'İşlem Tarihi', 600), left(170, 'Dönem İçi İşlemler', 600), left(303, 'Kalan Borç / Taksit', 600),
    { x: 405, right: 445, y: 600, str: 'Bonus (TL)' }, { x: 517, right: 553, y: 600, str: 'Tutar (TL)' },
    ...row(590, null, 'ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR', { tutar: '5.000,00' }),
    ...row(582, null, 'DÖNEM FAİZİ', { tutar: '100,00' }),
    ...row(574, '09 Ekim 2026', 'ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', { tutar: '5.000,00+' }),
    ...row(566, '22 Ekim 2026', 'BONUS BEDAVA ALIŞVERİŞ', { bonus: '615,00-' }),
    ...row(558, '02 Ekim 2026', 'GİYİM BONUS KAMPANYASI', { bonus: '350,00' }),
    ...row(550, '25 Ekim 2026', 'IYZICO  *AMAZON.COM.T', { bonus: '0,32', tutar: '644,00' }),
    ...row(542, '24 Ekim 2026', 'IYZICO  *AMAZON.COM.T', { bonus: '0,17-', tutar: '335,00+' }),
    ...row(534, '11 Eylül 2026', 'ÖZDİLEKTEYİM MAĞAZA', { inst: '366,63x3=1.099,91 2.Taksit', tutar: '366,63' }),
    ...row(526, '21 Ekim 2026', 'IYZICO/RUSTANDRICH.COM.TR', { inst: '535,50x3=1.606,50 1.Taksit', bonus: '1,45', tutar: '535,50' }),
    ...row(518, '04 Ekim 2026', 'STARTER (TIMELY)', { inst: '11,00 USD', tutar: '556,72' }),
    ...row(510, null, 'YURT DIŞI HARCAMALARINIZ'),
    ...extra,
    left(105, 'Toplam', 400), right(445, '-264,85', 400), right(553, debt, 400),
    left(36, 'Önceki Bakiye', 380), left(110, 'Dönem Harcamaları', 380), left(200, 'Faiz ve Ücretler', 380), left(300, 'Ödemeleriniz', 380), left(380, 'Dönem Borcunuz', 380),
    left(36, `5.000,00 TL + 1.767,85 TL + 100,00 TL - 5.000,00 TL = ${debt} TL 1.766,00 TL`, 370),
    left(36, 'Bir sonraki hesap kesiminiz 29 Kasım 2026 Pazar ve son ödemeniz 09 Aralık 2026 Çarşamba \'dir. Bir önceki hesap kesim tarihiniz 28 Eylül', 360),
    left(36, '2026 Pazartesi \'dir.', 352),
    left(37, 'T. Garanti Bankası A.Ş. Genel Müdürlük', 30),
  ]
  return { lines: groupLines(items) }
}

describe('parseTrDate / parseTrAmount', () => {
  it('Türkçe ay adları ve geçersiz gün', () => {
    expect(parseTrDate('30 Ekim 2026')).toBe('2026-10-30')
    expect(parseTrDate('02 Ağustos 2026')).toBe('2026-08-02')
    expect(parseTrDate('31 Şubat 2026')).toBeNull()
    expect(parseTrDate('Toplam')).toBeNull()
  })
  it('binlik ayraç ve işaret ekleri', () => {
    expect(parseTrAmount('124.641,96')).toBe(124641.96)
    expect(parseTrAmount('452,77+')).toBe(452.77)
    expect(parseTrAmount('2.053,99-')).toBe(2053.99)
  })
})

describe('groupLines', () => {
  it('yakın y değerlerini bir satırda, soldan sağa birleştirir', () => {
    const lines = groupLines([left(300, 'b', 100.5), left(100, 'a', 100), left(100, 'c', 90)])
    expect(lines.map(l => l.text)).toEqual(['a b', 'c'])
  })
})

describe('parseGarantiCard', () => {
  it('sütunları konumdan ayırır ve dönem borcunu doğrular', () => {
    // 5000 devir + 100 faiz − 5000 ödeme + 644 − 335 + 366,63 + 535,50 + 556,72 = 1.867,85
    const st = parseGarantiCard([samplePage([], '1.867,85')])!
    expect(st).not.toBeNull()
    expect(st.statementDate).toBe('2026-10-30')
    expect(st.dueDate).toBe('2026-11-09')
    expect(st.prevStatementDate).toBe('2026-09-28')
    expect(st.nextStatementDate).toBe('2026-11-29')
    expect(st.nextDueDate).toBe('2026-12-09')
    expect(st.cards).toEqual(['9010'])
    expect(st.check.computed).toBe(1867.85)

    const kinds = st.lines.map(l => [l.description, l.kind, l.amount, l.bonus])
    expect(kinds).toContainEqual(['ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR', 'carry', 5000, null])
    expect(kinds).toContainEqual(['DÖNEM FAİZİ', 'fee', 100, null])
    expect(kinds).toContainEqual(['ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ', 'payment', -5000, null])
    // Bonus satırları borcu etkilemez
    expect(kinds).toContainEqual(['BONUS BEDAVA ALIŞVERİŞ', 'bonus', null, -615])
    expect(kinds).toContainEqual(['GİYİM BONUS KAMPANYASI', 'bonus', null, 350])
    expect(kinds).toContainEqual(['IYZICO *AMAZON.COM.T', 'refund', -335, -0.17])

    const inst = st.lines.find(l => l.description === 'ÖZDİLEKTEYİM MAĞAZA')!
    expect(inst.installment).toEqual({ index: 2, count: 3, total: 1099.91 })
    expect(inst.date).toBe('2026-09-11')
    expect(st.lines.find(l => l.description === 'STARTER (TIMELY)')!.foreign).toEqual({ amount: 11, currency: 'USD' })
    // Bölüm başlığı (tutarsız satır) işlem sayılmaz
    expect(st.lines.some(l => l.description.startsWith('YURT DIŞI'))).toBe(false)
  })

  it('toplam tutmazsa kontrol başarısız olur', () => {
    const st = parseGarantiCard([samplePage([], '9.999,99')])!
    expect(st.check.ok).toBe(false)
    expect(st.check.issues.join(' ')).toContain('tutmuyor')
  })

  it('başka bankanın PDF\'ini tanımaz', () => {
    const page: PdfPage = { lines: groupLines([left(36, 'Hesap Özeti', 700), left(36, 'Akbank T.A.Ş.', 30)]) }
    expect(parseGarantiCard([page])).toBeNull()
    expect(() => parseStatement([page])).toThrow(/tanınmıyor/)
  })
})
