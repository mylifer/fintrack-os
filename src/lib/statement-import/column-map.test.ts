import { describe, it, expect } from 'vitest'
import { groupLines, type PdfItem, type PdfPage } from './pdf-text'
import {
  applyMapping, buildMappedStatement, gridToTable, guessDateFormat, guessDecimal, guessMapping, mappingProblem,
  parseMappedAmount, parseMappedDate, pdfToTable, tableSignature, type ColumnMapping, type StatementTable,
} from './column-map'

describe('parseMappedAmount', () => {
  it('virgüllü ondalık (TR): binlik nokta, TL soneki, ₺ öneki', () => {
    expect(parseMappedAmount('1.234,56', 'comma')).toBe(1234.56)
    expect(parseMappedAmount('1.234.567,8', 'comma')).toBe(1234567.8)
    expect(parseMappedAmount('12,5', 'comma')).toBe(12.5)
    expect(parseMappedAmount('1.234,56 TL', 'comma')).toBe(1234.56)
    expect(parseMappedAmount('1.234,56TL', 'comma')).toBe(1234.56)
    expect(parseMappedAmount('₺ 45,90', 'comma')).toBe(45.9)
    expect(parseMappedAmount('250', 'comma')).toBe(250)
  })
  it('noktalı ondalık (EN): binlik virgül', () => {
    expect(parseMappedAmount('1,234.56', 'dot')).toBe(1234.56)
    expect(parseMappedAmount('1234.56', 'dot')).toBe(1234.56)
    expect(parseMappedAmount('-1,234.56 TRY', 'dot')).toBe(-1234.56)
  })
  it('işaretler: önde/sonda eksi, parantez, sonda artı', () => {
    expect(parseMappedAmount('-45,90', 'comma')).toBe(-45.9)
    expect(parseMappedAmount('45,90-', 'comma')).toBe(-45.9)
    expect(parseMappedAmount('(1.234,56)', 'comma')).toBe(-1234.56)
    expect(parseMappedAmount('(1.234,56) TL', 'comma')).toBe(-1234.56)
    expect(parseMappedAmount('(1,234.56)', 'dot')).toBe(-1234.56)
    expect(parseMappedAmount('250,00+', 'comma')).toBe(250)
    expect(parseMappedAmount('+250,00', 'comma')).toBe(250)
  })
  it('ayraç seçimiyle uyuşmayan gruplama okunmaz (yanlış ayraç hemen görünür)', () => {
    expect(parseMappedAmount('1234.56', 'comma')).toBeNull()
    expect(parseMappedAmount('1.234,56', 'dot')).toBeNull()
    expect(parseMappedAmount('1.23,4', 'comma')).toBeNull()
  })
  it('boş, metin ve sıfır', () => {
    expect(parseMappedAmount('', 'comma')).toBeNull()
    expect(parseMappedAmount('  ', 'comma')).toBeNull()
    expect(parseMappedAmount('MIGROS', 'comma')).toBeNull()
    expect(parseMappedAmount('0,00', 'comma')).toBe(0)
  })
  it('xlsx sayı hücresi (okuyucu virgüllü ondalığa çevirir)', () => {
    expect(parseMappedAmount('-1234,5', 'comma')).toBe(-1234.5)
  })
})

describe('parseMappedDate', () => {
  it('gg.aa.yyyy, gg/aa/yy, gg-aa-yyyy ve saat eki', () => {
    expect(parseMappedDate('14.11.2026', 'dmy')).toBe('2026-11-14')
    expect(parseMappedDate('14/11/26', 'dmy')).toBe('2026-11-14')
    expect(parseMappedDate('4-1-2026', 'dmy')).toBe('2026-01-04')
    expect(parseMappedDate('14.11.2026 14:32', 'dmy')).toBe('2026-11-14')
  })
  it('aa/gg/yyyy ve yyyy-aa-gg', () => {
    expect(parseMappedDate('11/14/2026', 'mdy')).toBe('2026-11-14')
    expect(parseMappedDate('2026-11-14', 'ymd')).toBe('2026-11-14')
    expect(parseMappedDate('2026.11.14', 'ymd')).toBe('2026-11-14')
    expect(parseMappedDate('2026-11-14T10:00:00', 'ymd')).toBe('2026-11-14')
  })
  it('ay adıyla: tam ad, kısaltma, Türkçe harfler', () => {
    expect(parseMappedDate('14 Kasım 2026', 'text')).toBe('2026-11-14')
    expect(parseMappedDate('02 Ağustos 2026', 'text')).toBe('2026-08-02')
    expect(parseMappedDate('1 Şub 2026', 'text')).toBe('2026-02-01')
    expect(parseMappedDate('14 KASIM 2026', 'text')).toBe('2026-11-14')
    expect(parseMappedDate('14 Kas 26', 'text')).toBe('2026-11-14')
    expect(parseMappedDate('31 Ara 2026 Perşembe', 'text')).toBe('2026-12-31')
    expect(parseMappedDate('14 Nov 2026', 'text')).toBe('2026-11-14')
  })
  it('takvimde olmayan gün, yanlış biçim ve metin', () => {
    expect(parseMappedDate('31.04.2026', 'dmy')).toBeNull()
    expect(parseMappedDate('29 Şubat 2026', 'text')).toBeNull()
    expect(parseMappedDate('14.11.2026', 'mdy')).toBeNull()
    expect(parseMappedDate('14.11.2026', 'ymd')).toBeNull()
    expect(parseMappedDate('Toplam', 'dmy')).toBeNull()
    expect(parseMappedDate('14 Foo 2026', 'text')).toBeNull()
    expect(parseMappedDate('', 'dmy')).toBeNull()
  })
  it('Excel seri günü her biçimde', () => {
    expect(parseMappedDate('46290', 'dmy')).toBe('2026-09-25')
    expect(parseMappedDate('46290,5', 'text')).toBe('2026-09-25')
  })
})

describe('biçim tahmini', () => {
  it('tarih: gün > 12 ise ay/gün sırası anlaşılır; eşitlikte gg.aa', () => {
    expect(guessDateFormat(['01.02.2026', '14.02.2026'])).toBe('dmy')
    expect(guessDateFormat(['02/01/2026', '02/14/2026'])).toBe('mdy')
    expect(guessDateFormat(['01/02/2026'])).toBe('dmy')
    expect(guessDateFormat(['2026-02-14'])).toBe('ymd')
    expect(guessDateFormat(['14 Kasım 2026', '3 Ekim 2026'])).toBe('text')
  })
  it('ondalık: çoğunluk', () => {
    expect(guessDecimal(['1.234,56', '-45,90', '12'])).toBe('comma')
    expect(guessDecimal(['1,234.56', '-45.90', '12'])).toBe('dot')
    expect(guessDecimal(['12', '30'])).toBe('comma')
  })
})

const csvGrid = (text: string) => text.trim().split('\n').map(l => l.split(';'))

describe('gridToTable + guessMapping', () => {
  it('banka dökümü: üstteki hesap bilgisi atlanır, Borç/Alacak + Bakiye → vadesiz', () => {
    const t = gridToTable(csvGrid(`
Hesap No;TR12 0001
Dönem;01.11.2026 - 14.11.2026
İşlem Tarihi;Valör;Açıklama;Borç;Alacak;Bakiye
01.11.2026;01.11.2026;MIGROS ATASEHIR;1.000,00;;9.000,00
03.11.2026;03.11.2026;MAAS;;40.000,00;49.000,00
05.11.2026;05.11.2026;EV KIRASI;15.000,00;;34.000,00`))
    expect(t.hasHeader).toBe(true)
    expect(t.headers).toEqual(['İşlem Tarihi', 'Valör', 'Açıklama', 'Borç', 'Alacak', 'Bakiye'])
    expect(t.rows).toHaveLength(3)
    const m = guessMapping(t)
    expect(m).toMatchObject({ date: 0, description: 2, amountMode: 'split', debit: 3, credit: 4, balance: 5, dateFormat: 'dmy', decimal: 'comma', statementType: 'checking' })
    expect(mappingProblem(m, t.headers.length)).toBeNull()
  })
  it('kart dökümü: tek tutar, harcama artı → kredi kartı', () => {
    const t = gridToTable(csvGrid(`
Tarih;İşlem;Tutar (TL)
14 Kasım 2026;MIGROS;1.234,56 TL
12 Kasım 2026;ÖDEMENİZ İÇİN TEŞEKKÜRLER;(5.000,00) TL
10 Kasım 2026;SPOTIFY;59,99 TL`))
    const m = guessMapping(t)
    expect(m).toMatchObject({ date: 0, description: 1, amountMode: 'single', amount: 2, dateFormat: 'text', decimal: 'comma', sign: 'expense-positive', statementType: 'credit_card' })
  })
  it('başlıksız dosya: sütunlar içerikten bulunur; eksiler çoğunluktaysa harcama eksi', () => {
    const t = gridToTable(csvGrid(`
2026-11-01;A101 MARKET KADIKOY;-1,234.56
2026-11-02;SHELL;-850.00
2026-11-03;IADE;120.00`))
    expect(t.hasHeader).toBe(false)
    expect(t.headers).toEqual(['Sütun 1', 'Sütun 2', 'Sütun 3'])
    expect(guessMapping(t)).toMatchObject({ date: 0, description: 1, amount: 2, dateFormat: 'ymd', decimal: 'dot', sign: 'expense-negative' })
  })
  it('başlığı tanınmayan dosya: veriden önceki metin satırı başlık sayılır, rolleri içerik belirler', () => {
    const t = gridToTable(csvGrid(`
Kayıt;Ne;Kaç
14/11/26;MIGROS;45,90
15/11/26;BIM;12,00`))
    expect(t.hasHeader).toBe(true)
    expect(guessMapping(t)).toMatchObject({ date: 0, description: 1, amount: 2, dateFormat: 'dmy' })
  })
  it('başlıksız Borç/Alacak çifti satır satır birbirini dışlar', () => {
    const t = gridToTable(csvGrid(`
01.11.2026;MIGROS;100,00;
02.11.2026;MAAS;;5.000,00
03.11.2026;BIM;50,00;`))
    expect(guessMapping(t)).toMatchObject({ amountMode: 'split', debit: 2, credit: 3, statementType: 'checking' })
  })
  it('boş dosya hata verir', () => {
    expect(() => gridToTable([['', ''], []])).toThrow(/okunacak satır yok/)
  })
})

describe('applyMapping', () => {
  const table: StatementTable = {
    source: 'sheet', hasHeader: true, headers: ['Tarih', 'Açıklama', 'Tutar', 'Bakiye'],
    rows: [
      ['14.11.2026', 'MIGROS', '-1.000,00', '9.000,00'],
      ['Toplam', '', '-1.000,00', ''],
      ['15.11.2026', 'SIFIR', '0,00', ''],
      ['16.11.2026', 'MAAS', '40.000,00', '49.000,00'],
      ['', '', '', ''],
      ['17.11.2026', 'BOZUK', 'abc', ''],
    ],
  }
  const m: ColumnMapping = {
    date: 0, description: 1, amountMode: 'single', amount: 2, debit: -1, credit: -1, balance: 3,
    dateFormat: 'dmy', decimal: 'comma', sign: 'expense-negative', statementType: 'checking',
  }
  it('işaret yönü: harcama eksi yazılmışsa ekstre kuralına (+ çıkan) çevrilir', () => {
    const r = applyMapping(table, m)
    expect(r.rows.map(x => [x.date, x.description, x.amount, x.balance])).toEqual([
      ['2026-11-14', 'MIGROS', 1000, 9000],
      ['2026-11-16', 'MAAS', -40000, 49000],
    ])
    expect(r.skipped).toEqual([
      { row: 1, reason: 'tarih okunamadı' },
      { row: 2, reason: 'tutar sıfır' },
      { row: 5, reason: 'tutar okunamadı' },
    ])
  })
  it('harcama artı kipinde işaret korunur', () => {
    expect(applyMapping(table, { ...m, sign: 'expense-positive' }).rows.map(x => x.amount)).toEqual([-1000, 40000])
  })
  it('Borç/Alacak çifti: alacak eksi işaretli yazılsa da yön sütundan', () => {
    const t: StatementTable = { source: 'sheet', hasHeader: true, headers: ['T', 'A', 'B', 'C'], rows: [
      ['01.11.2026', 'X', '100,00', ''], ['02.11.2026', 'Y', '', '-50,00'], ['03.11.2026', 'Z', '', '50,00'],
    ] }
    const r = applyMapping(t, { ...m, amountMode: 'split', amount: -1, debit: 2, credit: 3, balance: -1 })
    expect(r.rows.map(x => x.amount)).toEqual([100, -50, -50])
  })
})

describe('buildMappedStatement', () => {
  const t: StatementTable = {
    source: 'sheet', hasHeader: true, headers: ['Tarih', 'Açıklama', 'Tutar'],
    rows: [
      ['14.11.2026', 'MIGROS', '1.234,56'],
      ['12.11.2026', 'KART ODEMESI', '-5.000,00'],
      ['10.11.2026', 'GECIKME FAIZI', '10,00'],
      ['09.11.2026', 'ZARA IADE', '-100,00'],
    ],
  }
  const m: ColumnMapping = {
    date: 0, description: 1, amountMode: 'single', amount: 2, debit: -1, credit: -1, balance: -1,
    dateFormat: 'dmy', decimal: 'comma', sign: 'expense-positive', statementType: 'credit_card',
  }
  it('kart: yeniden eskiye sıralı dosya tarihe göre çevrilir; tür açıklamadan; dönem içi sayılır', () => {
    const st = buildMappedStatement(t, m, 'Örnek Banka')
    expect(st).toMatchObject({
      bank: 'custom', bankLabel: 'Örnek Banka', type: 'credit_card', provisional: true,
      statementDate: '2026-11-14', prevStatementDate: '2026-11-08', summary: null,
      check: { ok: true, computed: -3855.44, expected: -3855.44, diff: 0, issues: [] },
      mapped: { signature: tableSignature(t), hasBalance: false },
    })
    expect(st.lines.map(l => [l.index, l.date, l.kind, l.amount])).toEqual([
      [0, '2026-11-09', 'refund', -100],
      [1, '2026-11-10', 'fee', 10],
      [2, '2026-11-12', 'payment', -5000],
      [3, '2026-11-14', 'purchase', 1234.56],
    ])
    expect(st.account).toBeUndefined()
  })
  it('vadesiz: bakiye sütunundan dönem başı/sonu bakiye', () => {
    const tb: StatementTable = { source: 'sheet', hasHeader: true, headers: ['Tarih', 'Açıklama', 'Tutar', 'Bakiye'], rows: [
      ['01.11.2026', 'MIGROS', '-1.000,00', '9.000,00'],
      ['02.11.2026', 'MAAS', '40.000,00', '49.000,00'],
    ] }
    const st = buildMappedStatement(tb, { ...m, balance: 3, sign: 'expense-negative', statementType: 'checking' }, '')
    expect(st.bankLabel).toBe('Elle eşlenen ekstre')
    expect(st.lines.map(l => [l.kind, l.amount, l.balance])).toEqual([['debit', 1000, 9000], ['credit', -40000, 49000]])
    expect(st.account).toEqual({ iban: '', owner: '', periodStart: '2026-11-01', periodEnd: '2026-11-02', openingBalance: 10000, closingBalance: 49000 })
    expect(st.mapped?.hasBalance).toBe(true)
    expect(st.provisional).toBeUndefined()
  })
  it('eksik eşleme ya da hiç okunamayan satır açıklayıcı hata verir', () => {
    expect(() => buildMappedStatement(t, { ...m, amount: -1 }, '')).toThrow('Tutar sütununu seçin.')
    expect(() => buildMappedStatement(t, { ...m, description: 0 }, '')).toThrow('Aynı sütun')
    expect(() => buildMappedStatement(t, { ...m, dateFormat: 'text' }, '')).toThrow(/hiçbir satır okunamadı/)
  })
})

describe('tableSignature', () => {
  it('rakamlar ve harf büyüklüğü imzayı değiştirmez; başlık değişirse değişir', () => {
    const a: StatementTable = { source: 'sheet', hasHeader: true, headers: ['İŞLEM TARİHİ', 'Açıklama', 'Tutar'], rows: [] }
    const b: StatementTable = { ...a, headers: ['işlem tarihi', 'AÇIKLAMA', 'Tutar'] }
    const c: StatementTable = { ...a, headers: ['Tarih', 'Açıklama', 'Tutar'] }
    expect(tableSignature(a)).toBe(tableSignature(b))
    expect(tableSignature(a)).not.toBe(tableSignature(c))
    const p1: StatementTable = { source: 'pdf', hasHeader: false, headers: ['Sütun 1', 'Sütun 2'], rows: [], hint: 'ÖRNEK BANK Ekstre 11/2026' }
    const p2: StatementTable = { ...p1, hint: 'ÖRNEK BANK Ekstre 12/2026' }
    expect(tableSignature(p1)).toBe(tableSignature(p2))
  })
})

// ── PDF ─────────────────────────────────────────────────────────────────────

const left = (x: number, s: string, y: number): PdfItem => ({ x, right: x + s.length * 4, y, str: s })
const right = (r: number, s: string, y: number): PdfItem => ({ x: r - s.length * 4, right: r, y, str: s })

/** Tanınmayan bir bankanın ekstresi: tarih 40, açıklama 110, tutar sağ kenarı 520 */
function unknownBankPages(): PdfPage[] {
  const row = (y: number, d: string, desc: string, amt: string) => [left(40, d, y), left(110, desc, y), right(520, amt, y)]
  const p1: PdfItem[] = [
    left(40, 'ÖRNEK BANK A.Ş.', 780), left(40, 'Kredi Kartı Hesap Özeti 11/2026', 770),
    left(40, 'Tarih', 700), left(110, 'İşlem Açıklaması', 700), right(520, 'Tutar (TL)', 700),
    ...row(690, '01.11.2026', 'MIGROS ATASEHIR', '1.234,56'),
    ...row(680, '03.11.2026', 'SHELL PETROL', '850,00'),
    left(110, 'ISTANBUL TR', 672),
    ...row(660, '05.11.2026', 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', '-2.000,00'),
    left(40, 'Sayfa 1 / 2', 40),
  ]
  const p2: PdfItem[] = [
    left(40, 'Tarih', 700), left(110, 'İşlem Açıklaması', 700), right(520, 'Tutar (TL)', 700),
    ...row(690, '14 Kasım 2026', 'SPOTIFY', '59,99'),
    left(40, 'Dönem Borcu', 600), right(520, '144,55', 600),
  ]
  return [{ lines: groupLines(p1) }, { lines: groupLines(p2) }]
}

describe('pdfToTable', () => {
  it('sütunları konumdan çıkarır, tekrar eden başlığı atlar, devam satırını alır', () => {
    const t = pdfToTable(unknownBankPages())!
    expect(t.source).toBe('pdf')
    expect(t.headers).toEqual(['Tarih', 'İşlem Açıklaması', 'Tutar (TL)'])
    expect(t.rows).toEqual([
      ['01.11.2026', 'MIGROS ATASEHIR', '1.234,56'],
      ['03.11.2026', 'SHELL PETROL', '850,00'],
      ['', 'ISTANBUL TR', ''],
      ['05.11.2026', 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', '-2.000,00'],
      ['Sayfa 1 / 2', '', ''],
      ['14 Kasım 2026', 'SPOTIFY', '59,99'],
    ])
  })
  it('tahmin + uygulama: devam satırı açıklamaya eklenir, karışık tarih biçimi seçilen biçimle okunur', () => {
    const t = pdfToTable(unknownBankPages())!
    const m = guessMapping(t)
    expect(m).toMatchObject({ date: 0, description: 1, amount: 2, dateFormat: 'dmy', decimal: 'comma', sign: 'expense-positive', statementType: 'credit_card' })
    const r = applyMapping(t, m)
    expect(r.rows.map(x => [x.date, x.description, x.amount])).toEqual([
      ['2026-11-01', 'MIGROS ATASEHIR', 1234.56],
      ['2026-11-03', 'SHELL PETROL ISTANBUL TR', 850],
      ['2026-11-05', 'ÖDEMENİZ İÇİN TEŞEKKÜRLER', -2000],
    ])
    // "14 Kasım 2026" gg.aa.yyyy biçiminde okunmaz → kullanıcı atlanan satırı görür
    expect(r.skipped.map(s => s.reason)).toEqual(['tarih okunamadı', 'tarih okunamadı'])
  })
  it('işlem satırı yoksa null', () => {
    expect(pdfToTable([{ lines: groupLines([left(40, 'Merhaba', 700), left(40, 'Dünya', 690)]) }])).toBeNull()
  })
  it('imza sonraki ayın ekstresinde aynı kalır', () => {
    const a = pdfToTable(unknownBankPages())!
    const pages = unknownBankPages()
    pages[0].lines[2] = { ...pages[0].lines[2] }
    const b = pdfToTable(pages)!
    expect(tableSignature(a)).toBe(tableSignature(b))
    expect(tableSignature(a)).toMatch(/^pdf:3:tarih\|islem aciklamasi\|tutar/)
  })
})
