import { describe, it, expect } from 'vitest'
import type { OcrLine } from './ocr'
import { parseKuveytScreenshot } from './kuveyt-period'
import { parseScreenshot } from './statement'

// Gerçek ekran görüntüsünün OCR çıktısındaki gibi (738 px genişlik): "+" → "*",
// "TL" → "1L" yanılgıları, sağ kenarda fiş simgesi ("ıBİ", "YE"), baştaki saat
// simgesi ("©"), en altta menü.
const line = (y: number, ...words: [string, number, number][]): OcrLine =>
  ({ y, text: words.map(w => w[0]).join(' '), words: words.map(([text, x0, x1]) => ({ text, x0, x1 })) })

const shot = (amountFirst = '3.750,001L') => ({
  width: 738,
  lines: [
    line(37, ['00:04', 81, 166], ['56', 575, 607]),
    line(113, ['<', 42, 63], ['Dönem', 222, 315], ['İçi', 325, 353], ['Harcamalar', 364, 519]),
    line(241, ['Sağlam', 202, 303], ['Kart', 314, 370], ['Mastercard', 379, 536]),
    line(279, ['5188', 238, 304], ['...', 317, 362], ['«...', 376, 421], ['1234', 434, 502]),
    line(622, ['TL', 63, 91], ['Harcamalar', 101, 233], ['11.250,00', 541, 674]),
    line(661, ['Bu', 64, 91], ['Döneme', 102, 197], ['Ait', 206, 236], ['Taksitler', 244, 341], ['0,00', 624, 674]),
    line(749, ['Toplam', 63, 145], ['11.250,001L', 510, 675]),
    line(872, ['Tümü', 66, 128], ['Bekleyen', 181, 275], ['Ücretsiz', 354, 440], ['Taksitlendir', 448, 569]),
    line(948, ['08.11.2026', 110, 239], ['23:22', 249, 310], [amountFirst, 486, 634]),
    line(972, ['©', 61, 87], ['VET', 110, 152], ['HAST', 161, 221], ['UNIVERSAL', 232, 359], ['FATİH', 369, 430], ['ıBİ', 648, 680]),
    line(1012, ['ISTANBUL', 111, 221], ['TR', 230, 257]),
    line(1082, ['06.11.2026', 63, 193], ['7.500,00', 486, 602], ['1L', 609, 634]),
    line(1106, ['VET', 64, 105], ['HAST', 115, 175], ['UNİVERSAL', 185, 312], ['FATİH', 323, 384], ['YE', 648, 680]),
    line(1145, ['İSTANBUL', 64, 175], ['TR', 184, 211]),
    line(1216, ['02.11.2026', 63, 192], ['*249,071L', 544, 684]),
    line(1251, ['Kredi', 64, 118], ['Kartı', 128, 176], ['Borç', 186, 234], ['Ödeme', 243, 321]),
    line(1321, ['02.11.2026', 63, 192], ['*1.100,93', 516, 652], ['TL', 659, 683]),
    line(1352, ['Kredi', 64, 118], ['Kartı', 128, 176], ['Borç', 186, 234], ['Ödeme', 243, 320]),
    line(1467, ['NM', 64, 94], ['Mâ', 207, 243], ['*', 497, 529]),
    line(1512, ['Ana', 33, 69], ['Sayfa', 77, 128], ['Döviz/Yatırım', 163, 287], ['Menü', 632, 682]),
  ],
})

describe('Kuveyt Türk dönem içi ekran görüntüsü', () => {
  it('satırlar, ödemeler ve ekrandaki toplam', () => {
    const st = parseKuveytScreenshot(shot())!
    expect(st).toMatchObject({ bank: 'kuveyt', provisional: true, cards: ['1234'], statementDate: '2026-11-08' })
    expect(st.check).toMatchObject({ ok: true, computed: 11250, expected: 11250 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.description])).toEqual([
      ['2026-11-02', 'payment', -249.07, 'Kredi Kartı Borç Ödeme'],
      ['2026-11-02', 'payment', -1100.93, 'Kredi Kartı Borç Ödeme'],
      ['2026-11-06', 'purchase', 7500, 'VET HAST UNİVERSAL FATİH'],
      ['2026-11-08', 'purchase', 3750, 'VET HAST UNIVERSAL FATİH'],
    ])
    expect(parseScreenshot(shot()).bank).toBe('kuveyt')
  })

  it('yanlış okunan tutar toplamı bozar', () => {
    const st = parseKuveytScreenshot(shot('3.759,001L'))!
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(9)
  })

  it('başka ekranı tanımaz', () => {
    expect(parseKuveytScreenshot({ width: 738, lines: [line(10, ['Hesap', 0, 50], ['Özeti', 60, 100])] })).toBeNull()
    expect(() => parseScreenshot({ width: 738, lines: [] })).toThrow(/tanınmıyor/)
  })
})
