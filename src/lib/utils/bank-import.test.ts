import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import type { Category } from '@/types'
import {
  parseCsvText, autoDetectMapping, validateImportRows, mappingError, findDuplicateRows,
  parseDate, parseAmount, recordsToParsed, detectDelimiter,
} from './csv'
import { readXlsxRows, isZip, isLegacyXls } from './xlsx'

/* ────────────────────────────────────────────────────────────────────────
   Banka ekstresi içe aktarma — "Tür" sütunu olmayan gerçek banka dökümleri:
   üstte hesap bilgisi satırları, işaretli tek tutar ya da ayrı Borç/Alacak
   sütunları, Türkçe sayı/tarih biçimleri ve .xlsx dosyaları.
──────────────────────────────────────────────────────────────────────── */

const cat = (o: Partial<Category>): Category => ({
  id: '', name: '', icon: '', color: '', scope: 'expense', isSystem: false, sortOrder: 0, ...o,
})

describe('banka dökümü — başlık satırı ve eşleştirme', () => {
  const text = [
    'HESAP HAREKETLERİ',
    'Müşteri: Kaan B.;;;',
    'Dönem: 01.09.2026 - 25.09.2026;;;',
    '',
    'İŞLEM TARİHİ;AÇIKLAMA;TUTAR (TL);BAKİYE',
    '25.09.2026 14:32;MIGROS KADIKOY;-1.234,56;10.000,00',
    '24.09.2026;MAAS ODEMESI;45.000,00;11.234,56',
  ].join('\n')

  it('tablodan önceki bilgi satırları atlanır; Türkçe büyük harfli başlıklar tanınır', () => {
    expect(detectDelimiter(text)).toBe(';')
    const { headers, rows, rowLines } = parseCsvText(text)
    expect(headers).toEqual(['İŞLEM TARİHİ', 'AÇIKLAMA', 'TUTAR (TL)', 'BAKİYE'])
    expect(rows).toHaveLength(2)
    expect(rowLines).toEqual([6, 7])
    const mapping = autoDetectMapping(headers)
    expect(mapping).toEqual({ date: 'İŞLEM TARİHİ', description: 'AÇIKLAMA', amount: 'TUTAR (TL)' })
    expect(mappingError(mapping)).toBeNull()
  })

  it('Tür sütunu yokken banka hesabında eksi = gider, artı = gelir', () => {
    const { headers, rows, rowLines } = parseCsvText(text)
    const { valid, errors } = validateImportRows(rows, autoDetectMapping(headers), [], rowLines, { signMode: 'negative-expense' })
    expect(errors).toEqual([])
    expect(valid.map(v => [v.row, v.date, v.type, v.amount])).toEqual([
      [6, '2026-09-25', 'expense', 1234.56],
      [7, '2026-09-24', 'income', 45000],
    ])
  })

  it('kredi kartı ekstresinde artı = harcama, eksi = ödeme/iade', () => {
    const csv = 'Tarih,Açıklama,Tutar\n01.09.2026,NETFLIX,149.99\n05.09.2026,KART ODEMESI,-5000'
    const { headers, rows } = parseCsvText(csv)
    const { valid } = validateImportRows(rows, autoDetectMapping(headers), [], undefined, { signMode: 'positive-expense' })
    expect(valid.map(v => [v.type, v.amount])).toEqual([['expense', 149.99], ['income', 5000]])
  })

  it('ayrı Borç/Alacak sütunları: dolu taraf türü belirler, "0,00" boş sayılır', () => {
    const csv = [
      'Tarih;Açıklama;Borç;Alacak;Bakiye',
      '01.09.2026;ELEKTRIK FATURASI;850,40;0,00;1.000,00',
      '02.09.2026;EFT GELEN;;2.500,00;3.500,00',
      '03.09.2026;HATALI;10,00;20,00;0',
      '04.09.2026;BOS;;;0',
    ].join('\n')
    const { headers, rows, rowLines } = parseCsvText(csv)
    const mapping = autoDetectMapping(headers)
    expect(mapping.debit).toBe('Borç')
    expect(mapping.credit).toBe('Alacak')
    const { valid, errors } = validateImportRows(rows, mapping, [], rowLines)
    expect(valid.map(v => [v.description, v.type, v.amount])).toEqual([
      ['ELEKTRIK FATURASI', 'expense', 850.4],
      ['EFT GELEN', 'income', 2500],
    ])
    expect(errors.map(e => e.row)).toEqual([4, 5])
  })

  it('tutar ya da borç/alacak seçilmemişse eşleştirme hatası', () => {
    expect(mappingError({ date: 'a', description: 'b' })).toMatch(/Tutar/)
    expect(mappingError({ date: 'a', description: 'b', debit: 'c' })).toBeNull()
  })
})

describe('tarih ve tutar biçimleri', () => {
  it('tarih: saat ekli, iki haneli yıl, tireli, ISO ve Excel seri günü', () => {
    expect(parseDate('25.09.2026 14:32')).toBe('2026-09-25')
    expect(parseDate('25/09/26')).toBe('2026-09-25')
    expect(parseDate('25-09-2026')).toBe('2026-09-25')
    expect(parseDate('2026-09-25T14:32:00')).toBe('2026-09-25')
    expect(parseDate('46290')).toBe('2026-09-25')
    expect(parseDate('46290.6')).toBe('2026-09-25')
    expect(parseDate('31.02.2026')).toBeNull()
    expect(parseDate('12345')).toBeNull()
  })

  it('tutar: TL eki, sonda eksi, parantezli negatif, artı işareti', () => {
    expect(parseAmount('1.234,56 TL')).toBe(1234.56)
    expect(parseAmount('45,90-')).toBe(-45.9)
    expect(parseAmount('(1.000,00)')).toBe(-1000)
    expect(parseAmount('+250')).toBe(250)
    expect(parseAmount('-1.234,56')).toBe(-1234.56)
    expect(parseAmount('0,00')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('kategori — aynı açıklamalı eski işlem', () => {
  it('kural yoksa en yeni eski işlemin kategorisi; arşivli kategori önerilmez', () => {
    const categories = [cat({ id: 'fatura' }), cat({ id: 'eski', isArchived: true })]
    const history = [
      { type: 'expense' as const, description: 'Elektrik Faturası', categoryId: 'eski', date: '2026-09-01' },
      { type: 'expense' as const, description: 'ELEKTRIK FATURASI', categoryId: 'fatura', date: '2026-08-01' },
    ]
    const { valid } = validateImportRows(
      [{ d: '01.09.2026', a: 'Elektrik Faturası', t: '-100' }],
      { date: 'd', description: 'a', amount: 't' },
      categories, undefined, { history },
    )
    expect(valid[0].categoryId).toBe('fatura')
  })
})

describe('tekrar eden satırlar', () => {
  it('hesapta zaten olan ve dosyada ikinci kez geçen satır işaretlenir', () => {
    const rows = [
      { date: '2026-09-01', amount: 100, description: 'Market' },
      { date: '2026-09-02', amount: 50, description: 'Kahve' },
      { date: '2026-09-02', amount: 50, description: 'kahve ' },
    ]
    const existing = [{ date: '2026-09-01', amount: 100, description: 'MARKET' }]
    expect([...findDuplicateRows(rows, existing)]).toEqual([0, 2])
  })
})

describe('xlsx okuyucu', () => {
  // Excel'in ürettiği yapının küçük bir kopyası: workbook → rels → sheet,
  // paylaşılan metinler, sayı hücresi, seri tarih ve atlanan (boş) hücre.
  const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c></row>
    <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c></row>
    <row r="4"><c r="A4"><v>46290</v></c><c r="B4" t="s"><v>4</v></c><c r="D4"><v>-1234.56</v></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>24.09.2026</t></is></c><c r="B5" t="str"><v>Maaş &amp; Prim</v></c><c r="C5"><v>45000</v></c></row>
  </sheetData></worksheet>`
  const shared = `<sst><si><t>Hesap Hareketleri</t></si><si><t>Tarih</t></si><si><t>Açıklama</t></si><si><t>Tutar</t></si><si><r><t>MIGROS </t></r><r><t>KADIKOY</t></r></si></sst>`
  const bytes = zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Sayfa1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    'xl/sharedStrings.xml': strToU8(shared),
  })
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  it('hücreleri sütun konumuna göre ızgaraya yerleştirir; biçimleri tanır', () => {
    expect(isZip(buf)).toBe(true)
    expect(isLegacyXls(buf)).toBe(false)
    expect(readXlsxRows(buf)).toEqual([
      ['Hesap Hareketleri'],
      ['Tarih', 'Açıklama', 'Tutar'],
      ['46290', 'MIGROS KADIKOY', '', '-1234.56'],
      ['24.09.2026', 'Maaş & Prim', '45000'],
    ])
  })

  it('CSV ile aynı yoldan doğrulanır (başlık 2. satırda, seri tarih)', () => {
    const { headers, rows, rowLines } = recordsToParsed(readXlsxRows(buf))
    expect(headers).toEqual(['Tarih', 'Açıklama', 'Tutar'])
    const { valid } = validateImportRows(rows, autoDetectMapping(headers), [], rowLines, { signMode: 'negative-expense' })
    // 1. veri satırında tutar D sütununda ("Sütun 4") — Tutar sütunu boş → hata; 2. satır geçerli
    expect(valid.map(v => [v.date, v.description, v.type, v.amount])).toEqual([['2026-09-24', 'Maaş & Prim', 'income', 45000]])
  })

  it('eski .xls imzası tanınır', () => {
    expect(isLegacyXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]).buffer)).toBe(true)
  })
})
