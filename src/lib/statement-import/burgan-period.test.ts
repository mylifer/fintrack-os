import { describe, it, expect } from 'vitest'
import type { OcrLine, OcrPage } from './ocr'
import { parseBurganScreenshots } from './burgan-period'
import { parseScreenshot, parseScreenshots } from './statement'

// Gerçek ekran görüntülerinin (Burgan ON → Kart Hareketleri / Ekstre → Dönem İçi)
// tesseract (tur) çıktısı, olduğu gibi: "+" → "*" / "4" ("+30,00" → "430,00"),
// tarihte "11" → "N" / "1" ve kayıp noktalar ("10112026"), puanda "0" → "D"/"O",
// iki satırlı açıklamanın ortasındaki tutar satırında kırıntılar ("ş", "ri"),
// ilk ekranın altında kesik satır.
const line = (y: number, ...words: [string, number, number][]): OcrLine =>
  ({ y, text: words.map(w => w[0]).join(' '), words: words.map(([text, x0, x1]) => ({ text, x0, x1 })) })

const first = (): OcrPage => ({
  width: 738,
  lines: [
    line(37, ["08:49",96,181], ["ÜL",523,561], ["73",619,656]),
    line(126, ["<",49,62], ["Kart",202,258], ["Hareketleri",269,422], ["/",431,443], ["Ekstre",452,538]),
    line(265, ["Dönem",61,150], ["İçi",160,186], ["Gelecek",272,368], ["Dönem",378,465], ["Ekstre",579,652]),
    line(375, ["Toplam",69,146], ["Dönem",155,231], ["İçi",240,261], ["Harcama",270,363]),
    line(385, ["592,63",69,134], ["TL",140,164], ["/",170,178], ["0,00",184,228], ["USD",237,280], ["0)",506,539], ["v",625,658]),
    line(511, ["Bekleyen",43,128], ["İşlemler",137,211]),
    line(577, ["IYZICO/TESLA.COM",44,277], ["ISTANBUL",341,464], ["TR",497,528], ["-354,72",577,661], ["TL",669,696]),
    line(634, ["17.11.2026",42,132]),
    line(682, ["MaxiPuan",44,142], ["—",160,170], ["*",180,192], ["0,04",201,244]),
    line(765, ["IYZICO/TESLA.COM",44,277], ["ISTANBUL",341,464], ["TR",497,528], ["-329,04",574,662], ["TL",669,696]),
    line(821, ["16.N.2026",42,134]),
    line(869, ["MaxiPuan",44,143], ["—",161,170], ["*",180,192], ["0,03",201,241]),
    line(943, ["Diğer",43,94], ["Tüm",100,141], ["İşlemler",150,224]),
    line(1012, ["ON",42,79], ["Kredi",90,151], ["Kartı",162,217], ["Elektrikli",228,333], ["Araç",342,396], ["Şarj",405,449]),
    line(1032, ["ş",314,317], ["ş",379,382], ["*56,39",587,661], ["TL",669,696]),
    line(1047, ["Kampanyası",44,191], ["kazanım",201,303], ["iadesi",314,382]),
    line(1097, ["13.11.2026",42,133]),
    line(1186, ["ON",42,79], ["Kredi",90,151], ["Kartı",162,217], ["Elektrikli",228,333], ["Araç",342,396], ["Şarj",405,449]),
    line(1203, ["ri",310,317], ["ç",379,382], ["*19,60",589,661], ["TL",669,696]),
    line(1221, ["Kampanyası",44,191], ["kazanım",201,303], ["iadesi",314,382]),
    line(1271, ["12.1.2026",42,133]),
    line(1359, ["ON",42,79], ["Kredi",90,151], ["Kartı",162,217], ["Elektrikli",228,333], ["Araç",342,396], ["Şarj",405,449]),
    line(1377, ["yi",310,317], [".",379,382], ["*36,54",586,662], ["TL",670,696]),
    line(1394, ["Kampanyası",44,191], ["kazanım",201,303], ["iadesi",314,382]),
    line(1444, ["12.1.2026",42,133]),
    line(1526, ["NEFS",44,105], ["DİTECL",110,186], ["A",200,209], ["SORA",220,277], ["İCTARIDI",328,422], ["MN",429,442], ["TN",484,515], ["aarvar",590,661], ["TI",669,687]),
  ],
})

// Aşağı kaydırılmış ikinci ekran (kırpılmış, 1290 px)
const second = (): OcrPage => ({
  width: 1290,
  lines: [
    line(71, ["IYZICO/TESLA.COM",76,484], ["ISTANBUL",574,788], ["TR",847,900], ["-281,95",1017,1156], ["TL",1169,1218]),
    line(162, ["1111.2026",72,224]),
    line(245, ["MaxiPuan",76,249], ["*",315,335], ["D03",352,422]),
    line(398, ["IYZICO/TESLA.COM",76,484], ["ISTANBUL",573,788], ["TR",847,900], ["-30,00",1027,1156], ["TL",1170,1217]),
    line(489, ["10112026",72,235]),
    line(641, ["IYZICO/TESLA.COM",76,484], ["ISTANBUL",574,788], ["TR",847,900], ["-98,00",1026,1156], ["TL",1170,1218]),
    line(732, ["10.11.2026",72,235]),
    line(815, ["MaxiPuan",76,249], ["*",315,335], ["0,01",352,412]),
    line(968, ["IYZICO/TESLA.COM",76,484], ["ISTANBUL",574,788], ["TR",847,900], ["-182,68",1014,1156], ["TL",1170,1217]),
    line(1059, ["10.11.2026",72,235]),
    line(1142, ["MaxiPuan",76,249], ["*",315,335], ["O02",352,423]),
    line(1295, ["IYZICO/TESLA.COM",76,484], ["ISTANBUL",574,788], ["TR",847,900], ["430,00",1018,1156], ["TL",1170,1217]),
    line(1386, ["10112026",72,235]),
  ],
})

describe('Burgan (ON) dönem içi ekran görüntüleri', () => {
  it('iki ekran birlikte: satırlar, puanlar ve ekrandaki toplam', () => {
    const st = parseBurganScreenshots([first(), second()])!
    expect(st).toMatchObject({ bank: 'burgan', provisional: true, statementDate: '2026-11-17', dueDate: null })
    expect(st.check).toMatchObject({ ok: true, computed: 592.63, expected: 592.63, diff: 0 })
    expect(st.lines.map(l => [l.date, l.kind, l.amount, l.bonus, l.description])).toEqual([
      ['2026-11-10', 'refund', -30, null, 'IYZICO/TESLA.COM'],
      ['2026-11-10', 'purchase', 182.68, 0.02, 'IYZICO/TESLA.COM'],
      ['2026-11-10', 'purchase', 98, 0.01, 'IYZICO/TESLA.COM'],
      ['2026-11-10', 'purchase', 30, null, 'IYZICO/TESLA.COM'],
      ['2026-11-11', 'purchase', 281.95, 0.03, 'IYZICO/TESLA.COM'],
      ['2026-11-12', 'refund', -36.54, null, 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kazanım iadesi'],
      ['2026-11-12', 'refund', -19.6, null, 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kazanım iadesi'],
      ['2026-11-13', 'refund', -56.39, null, 'ON Kredi Kartı Elektrikli Araç Şarj Kampanyası kazanım iadesi'],
      ['2026-11-16', 'purchase', 329.04, 0.03, 'IYZICO/TESLA.COM'],
      ['2026-11-17', 'purchase', 354.72, 0.04, 'IYZICO/TESLA.COM'],
    ])
  })

  it('seçim sırası önemsiz; ekran görüntüleri sırayla da gelse tersten de', () => {
    expect(parseScreenshots([second(), first()])).toEqual(parseScreenshots([first(), second()]))
  })

  it('üst üste binen ekranlarda ortak satırlar bir kez sayılır', () => {
    const p2 = second()
    // İkinci ekranın üstünde, ilk ekranın son tam satırı (12.11 +36,54) da görünüyor
    const overlap = first().lines.slice(21, 25).map(l => ({ ...l, y: l.y - 1500, words: l.words.map(w => ({ ...w, x0: w.x0 * 1290 / 738, x1: w.x1 * 1290 / 738 })) }))
    const shifted = { ...p2, lines: [...overlap, ...p2.lines] }
    expect(parseScreenshot(shifted).lines).toHaveLength(6)
    const st = parseScreenshots([first(), shifted])
    expect(st.lines).toHaveLength(10)
    expect(st.check.ok).toBe(true)
  })

  it('yalnız ilk ekran: eksik satırlar toplamı tutturmaz', () => {
    const st = parseScreenshot(first())
    expect(st.bank).toBe('burgan')
    expect(st.lines).toHaveLength(5)
    expect(st.check.ok).toBe(false)
    expect(st.check.diff).toBe(-592.63)
    expect(st.check.issues[0]).toMatch(/kalan ekran görüntülerini/)
  })

  it('toplamı olmayan devam ekranı tek başına: satırlar okunur, kontrol yapılamaz', () => {
    const st = parseScreenshot(second())
    expect(st.lines).toHaveLength(5)
    expect(st.check.ok).toBe(false)
    expect(st.check.issues.join(' ')).toMatch(/Toplam Dönem İçi Harcama/)
  })

  it('işareti hiç okunmayan tutar borç sayılır ve uyarılır', () => {
    const p = first()
    p.lines = p.lines.map(l => l.y === 765 ? line(765, ['IYZICO/TESLA.COM', 44, 277], ['ISTANBUL', 341, 464], ['TR', 497, 528], ['329,04', 574, 662], ['TL', 669, 696]) : l)
    const st = parseScreenshots([p, second()])
    expect(st.lines.find(l => l.date === '2026-11-16')?.amount).toBe(329.04)
    expect(st.check.issues.join(' ')).toMatch(/işareti \(\+\/−\) okunamadı/)
  })

  it('başka ekranı tanımaz', () => {
    expect(parseBurganScreenshots([{ width: 738, lines: [line(10, ['Hesap', 0, 50], ['Özeti', 60, 100])] }])).toBeNull()
    expect(() => parseScreenshots([{ width: 738, lines: [] }, { width: 738, lines: [] }])).toThrow(/tanınmıyor/)
  })
})
