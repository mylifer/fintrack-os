import type { Account, Transaction, Category, CurrencyCode, TransactionType } from '@/types'
import { serializeTagsCell, parseTagsCell } from '@/lib/utils/tags'
import { keywordCategory, foldText } from '@/lib/auto-category'

// ─── Export ────────────────────────────────────────────────────────────────

// Hesap sütunları SONA eklenir: mevcut sütun sırasına göre yazılmış dış
// betikler/şablonlar bozulmasın.
const CSV_HEADERS = ['Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Tür', 'Para Birimi', 'Etiketler', 'Hesap', 'Karşı Hesap']

const TYPE_LABELS: Record<TransactionType, string> = {
  expense:  'Gider',
  income:   'Gelir',
  transfer: 'Transfer',
}

// Düz bir sayı ("-250.00", "1234.50"): Excel/Sheets bunu formül olarak
// DEĞERLENDİRMEZ, sıradan bir negatif/pozitif sayıdır.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function escapeCsvCell(value: string): string {
  // Formula-injection guard: a cell starting with = + - @ (or tab/CR) is
  // executed as a formula when the CSV is opened in Excel/Sheets. Prefix a
  // single quote to neutralise it.
  //
  // İstisna: düz sayılar. İade satırları bilerek NEGATİF tutarlı yazılıyor
  // (bkz. supabase_schema.sql — transactions_amount_check kaldırıldı), bu
  // yüzden "-250.00" hücresi "'-250.00" olarak dışa aktarılıyor ve
  // uygulamanın KENDİ çıktısı geri içe aktarılamıyordu. "-1+1" gibi gerçekten
  // formül olabilecek girdiler desene uymadığı için hâlâ kaçırılır.
  let v = value
  if (/^[=+\-@\t\r]/.test(v) && !PLAIN_NUMBER.test(v)) v = `'${v}`
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

export function transactionsToCsvString(
  transactions: Transaction[],
  categories: Category[],
  accounts: Account[] = [],
): string {
  const catMap = new Map(categories.map(c => [c.id, c.name]))
  const accMap = new Map(accounts.map(a => [a.id, a.name]))
  const rows = transactions.map(tx =>
    [
      tx.date,
      tx.description,
      tx.categoryId ? (catMap.get(tx.categoryId) ?? '') : '',
      tx.amount.toFixed(2),
      TYPE_LABELS[tx.type],
      tx.currency,
      serializeTagsCell(tx.tags),
      accMap.get(tx.accountId) ?? '',
      // Transferin karşı bacağı: hesap bazlı dışa aktarmada satırın hangi yöne
      // ait olduğu ancak bu sütunla anlaşılır.
      tx.toAccountId ? (accMap.get(tx.toAccountId) ?? '') : '',
    ]
      .map(v => escapeCsvCell(String(v)))
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...rows].join('\n')
}

const TR_CHARS: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u',
}

/** Hesap adını dosya adında güvenle kullanılabilir bir parçaya indirger. */
export function csvFilenameSlug(name: string): string {
  const slug = name
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıİöşü]/g, ch => TR_CHARS[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'hesap'
}

export function downloadCsv(csvString: string, filename: string): void {
  const BOM  = '﻿'
  const blob = new Blob([BOM + csvString], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Import — parsing ──────────────────────────────────────────────────────

export interface ParsedCsv {
  headers:  string[]
  rows:     Record<string, string>[]
  /** 1-based source line number each data row starts on (for error reporting) */
  rowLines: number[]
}

// Türkçe bölge ayarlı Excel "CSV" kaydederken ondalık virgülle çakışmasın diye
// NOKTALI VİRGÜL kullanır; bazı banka dökümleri sekme kullanır. Banka
// dökümlerinde tablodan önce hesap bilgisi satırları olabildiği için yalnız ilk
// satıra değil ilk 20 satıra bakılır: aday, geçtiği SATIR sayısıyla, eşitlikte
// toplam sayısıyla yarışır (tırnak içindekiler sayılmaz). Ondalık virgüller de
// veri satırlarında geçer ama başlıkta geçmez, bu yüzden noktalı virgül önde kalır.
const DELIMITER_CANDIDATES = [',', ';', '\t'] as const
export type CsvDelimiter = typeof DELIMITER_CANDIDATES[number]

export function detectDelimiter(text: string): CsvDelimiter {
  const lineHits = new Map<string, number>()
  const totals   = new Map<string, number>()
  let seen = new Set<string>()
  let inQuotes = false
  let lines = 0
  const endLine = () => {
    for (const d of seen) lineHits.set(d, (lineHits.get(d) ?? 0) + 1)
    seen = new Set()
    lines++
  }
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch === '\n') { endLine(); if (lines >= 20) break }
    else if (!inQuotes && (DELIMITER_CANDIDATES as readonly string[]).includes(ch)) {
      seen.add(ch)
      totals.set(ch, (totals.get(ch) ?? 0) + 1)
    }
  }
  if (lines < 20) endLine()
  let best: CsvDelimiter = ','
  const score = (d: string) => [lineHits.get(d) ?? 0, totals.get(d) ?? 0] as const
  for (const d of DELIMITER_CANDIDATES) {
    const [l, t] = score(d)
    const [bl, bt] = score(best)
    if (l > bl || (l === bl && t > bt)) best = d
  }
  return best
}

/** Dosya baytlarını metne çevirir. Önce UTF-8 denenir; geçersiz bayt dizisi
 *  varsa Windows-1254 (Türkçe ANSI) okunur — Türkçe Windows'ta Excel'in
 *  "CSV (noktalı virgülle ayrılmış)" çıktısı bu kodlamadadır ve UTF-8 olarak
 *  okununca ş/ğ/ı/İ harfleri "�" olur. */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1254').decode(bytes)
  }
}

/** Quote-aware tokenizer over the WHOLE text: a quoted cell may contain
 *  delimiters and newlines (our own export produces these), so rows cannot be
 *  derived from a plain split('\n'). */
function tokenizeCsv(text: string, delimiter: CsvDelimiter): { records: string[][]; recordLines: number[] } {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const records: string[][] = []
  const recordLines: number[] = []
  let row: string[] = []
  let current   = ''
  let inQuotes  = false
  let line      = 1
  let rowLine   = 1
  let rowEmpty  = true

  const endCell = () => { row.push(current.trim()); current = '' }
  const endRow  = () => {
    endCell()
    if (!rowEmpty || row.length > 1) { records.push(row); recordLines.push(rowLine) }
    row = []; rowEmpty = true; rowLine = line
  }

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
      rowEmpty = false
    } else if (ch === delimiter && !inQuotes) {
      endCell()
    } else if (ch === '\n' && !inQuotes) {
      line++
      endRow()
      rowLine = line
    } else {
      if (ch === '\n') line++
      if (ch.trim()) rowEmpty = false
      current += ch
    }
  }
  endRow()
  return { records, recordLines }
}

export function parseCsvText(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): ParsedCsv {
  const { records, recordLines } = tokenizeCsv(text, delimiter)
  return recordsToParsed(records, recordLines)
}

/** Başlıkları tekilleştirir: boş başlık "Sütun N", tekrar eden "Ad (2)" olur —
 *  aynı adlı iki sütun satır nesnesinde birbirini ezmesin. */
function uniqueHeaders(raw: string[]): string[] {
  const used = new Map<string, number>()
  return raw.map((h, i) => {
    const base = h.trim() || `Sütun ${i + 1}`
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** Ham satırlardan (CSV ya da xlsx) başlık + veri satırları üretir. Başlık
 *  satırı ilk satır olmak zorunda değildir: banka dökümlerinde tablodan önce
 *  hesap/dönem bilgisi satırları olur (bkz. findHeaderRow). */
export function recordsToParsed(records: string[][], recordLines?: number[]): ParsedCsv {
  const lines = recordLines ?? records.map((_, i) => i + 1)
  const h = findHeaderRow(records)
  if (records.length - h < 2) {
    throw new Error('Dosya boş veya yalnızca başlık satırı içeriyor.')
  }
  const headers = uniqueHeaders(records[h])
  const rows = records.slice(h + 1).map(cells => {
    const rec: Record<string, string> = {}
    cells.forEach((v, i) => { rec[headers[i] ?? `Sütun ${i + 1}`] = v })
    return rec
  })
  return { headers, rows, rowLines: lines.slice(h + 1) }
}

// ─── Import — column mapping ───────────────────────────────────────────────

export type AppField =
  | 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'type' | 'category' | 'currency' | 'tags'

export const APP_FIELD_LABELS: Record<AppField, string> = {
  date:        'Tarih',
  description: 'Açıklama',
  amount:      'Tutar',
  debit:       'Borç / Çıkan',
  credit:      'Alacak / Giren',
  type:        'Tür (opsiyonel)',
  category:    'Kategori (opsiyonel)',
  currency:    'Para Birimi (opsiyonel)',
  tags:        'Etiketler (opsiyonel)',
}

export const REQUIRED_FIELDS: AppField[] = ['date', 'description']

export type ColumnMapping = Partial<Record<AppField, string>>

/** Eşleştirme eksikse kullanıcıya gösterilecek hata, tamamsa null. Tutar ya
 *  tek bir (işaretli ya da Tür sütunlu) sütundan ya da ayrı Borç/Alacak
 *  sütunlarından gelir. */
export function mappingError(mapping: ColumnMapping): string | null {
  for (const field of REQUIRED_FIELDS) {
    if (!mapping[field]) return `"${APP_FIELD_LABELS[field]}" alanı için bir sütun seçmelisiniz.`
  }
  if (!mapping.amount && !mapping.debit && !mapping.credit) {
    return 'Tutar için bir sütun ya da Borç/Alacak sütunlarını seçmelisiniz.'
  }
  return null
}

/** Başlık karşılaştırma biçimi: parantez içi ("(TL)"), iki nokta ve yıldız
 *  atılır, Türkçe harfler ASCII'ye katlanır ("İŞLEM TARİHİ" = "islem tarihi"). */
function normalizeHeader(h: string): string {
  return foldText(h.replace(/\(.*?\)/g, ' ').replace(/[:*.]/g, ' '))
}

// Anahtarlar normalizeHeader biçiminde. Banka dökümlerinin yaygın başlıkları
// dahil; "Bakiye", "Valör", "İşlem Türü" (EFT/POS gibi, gider/gelir değil)
// bilerek eşlenmez.
const HEADER_ALIASES: Record<string, AppField> = {
  'tarih': 'date', 'date': 'date', 'islem tarihi': 'date', 'islem zamani': 'date', 'tarih/saat': 'date',
  'aciklama': 'description', 'description': 'description', 'islem aciklamasi': 'description',
  'aciklamalar': 'description', 'islem': 'description', 'detay': 'description', 'islem detayi': 'description',
  'kategori': 'category', 'category': 'category',
  'tutar': 'amount', 'miktar': 'amount', 'amount': 'amount', 'islem tutari': 'amount',
  'borc': 'debit', 'cikan': 'debit', 'harcama': 'debit', 'borc tutari': 'debit', 'giden': 'debit',
  'alacak': 'credit', 'giren': 'credit', 'yatan': 'credit', 'alacak tutari': 'credit', 'gelen': 'credit',
  'tur': 'type', 'type': 'type',
  'para birimi': 'currency', 'currency': 'currency', 'para': 'currency', 'doviz': 'currency', 'doviz cinsi': 'currency',
  'etiket': 'tags', 'etiketler': 'tags', 'tag': 'tags', 'tags': 'tags',
}

function fieldForHeader(h: string): AppField | undefined {
  const key = normalizeHeader(h)
  // hasOwnProperty guard: "constructor" gibi başlıklar prototip zincirinden değer döndürmesin
  return Object.prototype.hasOwnProperty.call(HEADER_ALIASES, key) ? HEADER_ALIASES[key] : undefined
}

/** İlk 25 satırdan, hem tarih hem tutar (ya da borç/alacak) başlığı taşıyan
 *  ilki. Bulunamazsa 0 — ilk satır başlık kabul edilir. */
export function findHeaderRow(records: string[][]): number {
  for (let i = 0; i < Math.min(records.length, 25); i++) {
    const fields = new Set(records[i].map(fieldForHeader))
    if (fields.has('date') && (fields.has('amount') || fields.has('debit') || fields.has('credit'))) return i
  }
  return 0
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const h of headers) {
    const field = fieldForHeader(h)
    if (field && !mapping[field]) mapping[field] = h
  }
  return mapping
}

// ─── Import — validation ───────────────────────────────────────────────────

const TYPE_MAP: Record<string, TransactionType> = {
  gider:    'expense',
  expense:  'expense',
  borc:     'expense',
  gelir:    'income',
  income:   'income',
  alacak:   'income',
  transfer: 'transfer',
}

// Takvimde gerçekten var olan bir gün mü? `new Date('2026-04-31')` hata vermez,
// 1 Mayıs'a TAŞAR — eskiden yalnız isNaN'a bakıldığı için "31.04.2026" geçerli
// sayılıp kaydediliyordu. Tarih sütunu text olduğundan satır buluta da gidiyor,
// parseISO onu geçersiz sayıyor ve listelerde `format` RangeError ile sayfayı
// çökertiyordu. Bileşenler Date'ten geri okunup girilenle kıyaslanır.
function calendarIso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2026-09-25", "25.09.2026", "25/09/26", saat ekli biçimler ("25.09.2026
 *  14:32", ISO "…T14:32:00") ve Excel seri tarihi (xlsx hücresi: 46290). */
export function parseDate(raw: string): string | null {
  const s = raw.trim()
  // Excel seri günü: 25569 = 1970-01-01 … 73050 = 2099-12-31. Kesir = saat.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    if (serial < 25569 || serial > 73050) return null
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
    return calendarIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const datePart = s.split(/[T\s]/)[0]
  const ymd = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) return calendarIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY; iki haneli yıl 20xx sayılır
  const dmy = datePart.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    return calendarIso(year, Number(dmy[2]), Number(dmy[1]))
  }
  return null
}

/** "1.234,56", "1,234.56", "-45,90", "45,90-" (sonda eksi), "(45,90)"
 *  (muhasebe negatifi), "1.234,56 TL". Sıfır ya da okunamayan → null. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim()
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1) }
  s = s.replace(/(TRY|TL|USD|EUR|GBP)/gi, '').replace(/[₺$€£\s]/g, '')
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1) }
  if (s.startsWith('+')) s = s.slice(1)
  else if (s.startsWith('-')) { negative = !negative; s = s.slice(1) }

  let cleaned = s
  const hasComma = cleaned.includes(',')
  const hasDot   = cleaned.includes('.')

  if (hasComma && hasDot) {
    // Son gelen ayraç ondalıktır: "1.234,56" (TR) ve "1,234.56" (EN)
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (hasComma) {
    // Birden çok virgül binlik ayraçtır ("1,234,567"); tek virgül TR ondalığı ("12,5")
    const parts = cleaned.split(',')
    cleaned = parts.length > 2 ? parts.join('') : parts.join('.')
  } else if (hasDot) {
    // "1.234" / "1.234.567" desenleri TR binlik gruplarıdır; "1234.56" ondalıktır
    if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '')
  }

  // Ayraçlar temizlendikten sonra kalıntı ayraç/harf varsa sayı geçersizdir
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  // Negatif tutar geçerlidir: uygulama iadeyi NEGATİF gider olarak yazar ve
  // dışa aktarır. Hangi türde kabul edildiği validateImportRows'ta denetlenir.
  if (isNaN(n) || n === 0) return null
  const rounded = Math.round(n * 100) / 100
  return negative ? -rounded : rounded
}

const VALID_CURRENCIES = new Set<string>(['TRY', 'USD', 'EUR', 'GBP'])

/** Tür sütunu yokken TEK işaretli tutar sütununun yorumu:
 *  - 'negative-expense': banka hesabı dökümü — eksi = para çıktı (gider),
 *    artı = para girdi (gelir).
 *  - 'positive-expense': kredi kartı ekstresi — artı = harcama (gider),
 *    eksi = karta ödeme/iade (bakiye azalır, gelir olarak girer). */
export type SignMode = 'negative-expense' | 'positive-expense'

export interface ImportOptions {
  signMode?: SignMode
  /** Kategori sütunu ve kurallar eşleşmezse, aynı açıklamalı en yeni eski
   *  işlemin kategorisi kullanılır (aynı ekstreyi tekrar yüklerken işe yarar). */
  history?: Pick<Transaction, 'type' | 'description' | 'categoryId' | 'date'>[]
}

export interface ImportedTransaction {
  /** Dosyadaki satır numarası (önizleme ve hata mesajları için) */
  row:         number
  date:        string
  description: string
  amount:      number
  type:        TransactionType
  categoryId?: string
  currency:    CurrencyCode
  tags?:       string[]
}

export interface RowError {
  row:     number
  message: string
}

export interface ValidationResult {
  valid:  ImportedTransaction[]
  errors: RowError[]
}

export function validateImportRows(
  rows:       Record<string, string>[],
  mapping:    ColumnMapping,
  categories: Category[],
  rowLines?:  number[],
  opts:       ImportOptions = {},
): ValidationResult {
  const catByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))
  const liveCatIds = new Set(categories.filter(c => !c.isArchived).map(c => c.id))
  // Eski işlemler: katlanmış açıklama + tür → en yeni işlemin kategorisi
  const byHistory = new Map<string, { categoryId: string; date: string }>()
  for (const t of opts.history ?? []) {
    if (!t.categoryId || !liveCatIds.has(t.categoryId) || !t.description?.trim()) continue
    const key = `${t.type}|${foldText(t.description)}`
    const cur = byHistory.get(key)
    if (!cur || t.date > cur.date) byHistory.set(key, { categoryId: t.categoryId, date: t.date })
  }

  const valid:  ImportedTransaction[] = []
  const errors: RowError[]           = []
  const cell = (row: Record<string, string>, field: AppField) =>
    (mapping[field] ? row[mapping[field]!] : '') ?? ''

  rows.forEach((row, idx) => {
    const rowNum = rowLines?.[idx] ?? idx + 2
    const errs:  string[] = []

    const rawDate = cell(row, 'date')
    const rawDesc = cell(row, 'description')
    const date    = rawDate.trim() ? parseDate(rawDate) : null
    if (!date)           errs.push(`Geçersiz tarih: "${rawDate.trim()}"`)
    if (!rawDesc.trim()) errs.push('Açıklama boş olamaz')

    let type: TransactionType | null = null
    let amount: number | null = null

    if (mapping.debit || mapping.credit) {
      // Ayrı Borç/Alacak sütunları: dolu olan taraf türü belirler. Bankalar
      // boş tarafa "0,00" yazar — parseAmount sıfırı null döndürür, boş sayılır.
      const d = cell(row, 'debit').trim() ? parseAmount(cell(row, 'debit')) : null
      const c = cell(row, 'credit').trim() ? parseAmount(cell(row, 'credit')) : null
      if (d !== null && c !== null) errs.push('Aynı satırda hem borç hem alacak tutarı var')
      else if (d !== null) { type = 'expense'; amount = Math.abs(d) }
      else if (c !== null) { type = 'income'; amount = Math.abs(c) }
      else errs.push('Borç ya da alacak tutarı yok')
    } else {
      const rawAmount = cell(row, 'amount')
      amount = rawAmount.trim() ? parseAmount(rawAmount) : null
      if (amount === null) errs.push(`Geçersiz tutar: "${rawAmount.trim()}"`)

      if (mapping.type) {
        const rawType = cell(row, 'type')
        const typeKey = foldText(rawType)
        type = Object.prototype.hasOwnProperty.call(TYPE_MAP, typeKey) ? TYPE_MAP[typeKey] : null
        if (!type) errs.push(`Geçersiz tür: "${rawType.trim()}" (gider/gelir bekleniyor)`)
        // İçe aktarma tek hesaba yapılır; hedef hesabı olmayan transfer yalnızca
        // para çıkışı yaratır — kabul etme
        if (type === 'transfer') errs.push('Transfer satırları içe aktarılamaz (hedef hesap bilgisi dosyada yok)')
        // Negatif gider = iade (RefundModal ile aynı model). Negatif gelirin
        // uygulamada karşılığı yok — sessizce gideri artırmasın diye reddedilir.
        if (amount !== null && amount < 0 && type === 'income') {
          errs.push('Negatif tutar yalnızca gider (iade) satırlarında kabul edilir')
        }
      } else if (amount !== null) {
        const outflow = opts.signMode === 'positive-expense' ? amount > 0 : amount < 0
        type = outflow ? 'expense' : 'income'
        amount = Math.abs(amount)
      }
    }

    const rawCat = cell(row, 'category')
    const categoryId =
      (rawCat.trim() ? catByName.get(rawCat.trim().toLowerCase()) : undefined)
      // Kategori sütunu yoksa ya da ad eşleşmezse (banka dökümleri genelde
      // kategori taşımaz) kategorideki anahtar kelime kuralları, o da yoksa
      // aynı açıklamalı eski işlem denenir.
      ?? (type && type !== 'transfer' ? keywordCategory(rawDesc, type, categories) : undefined)
      ?? (type ? byHistory.get(`${type}|${foldText(rawDesc)}`)?.categoryId : undefined)
    const curRaw   = cell(row, 'currency').trim().toUpperCase()
    const currency = (VALID_CURRENCIES.has(curRaw) ? curRaw : 'TRY') as CurrencyCode
    const tags     = parseTagsCell(cell(row, 'tags'))

    if (errs.length > 0) {
      errors.push({ row: rowNum, message: errs.join('; ') })
    } else {
      valid.push({
        row:         rowNum,
        date:        date!,
        description: rawDesc.trim(),
        amount:      amount!,
        type:        type!,
        categoryId,
        currency,
        tags:        tags.length ? tags : undefined,
      })
    }
  })

  return { valid, errors }
}

/** Hesapta zaten bulunan (ya da dosyada daha önce geçen) satırların
 *  indeksleri — tarih + tutar + açıklama aynıysa. Aynı ekstreyi ikinci kez
 *  yüklemek veriyi ikiye katlamasın; önizlemede işaretsiz gelirler. */
export function findDuplicateRows(
  rows: Pick<ImportedTransaction, 'date' | 'amount' | 'description'>[],
  existing: Pick<Transaction, 'date' | 'amount' | 'description'>[],
): Set<number> {
  const sig = (date: string, amount: number, desc: string) =>
    `${date.slice(0, 10)}|${Math.round(amount * 100)}|${(desc ?? '').trim().toLowerCase()}`
  const seen = new Set(existing.map(t => sig(t.date, t.amount, t.description)))
  const dup = new Set<number>()
  rows.forEach((t, i) => {
    const s = sig(t.date, t.amount, t.description)
    if (seen.has(s)) dup.add(i)
    else seen.add(s)
  })
  return dup
}
