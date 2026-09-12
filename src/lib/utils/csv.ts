import type { Account, Transaction, Category, CurrencyCode, TransactionType } from '@/types'
import { serializeTagsCell, parseTagsCell } from '@/lib/utils/tags'

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

export function parseCsvText(text: string): ParsedCsv {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Quote-aware tokenizer over the WHOLE text: a quoted cell may contain
  // commas and newlines (our own export produces these), so rows cannot be
  // derived from a plain split('\n').
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
    } else if (ch === ',' && !inQuotes) {
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

  if (records.length < 2) {
    throw new Error('CSV dosyası boş veya yalnızca başlık satırı içeriyor.')
  }

  const headers = records[0]
  const rows    = records.slice(1).map(cells => {
    const rec: Record<string, string> = {}
    cells.forEach((v, i) => { rec[headers[i] ?? `col${i}`] = v })
    return rec
  })

  return { headers, rows, rowLines: recordLines.slice(1) }
}

// ─── Import — column mapping ───────────────────────────────────────────────

export type AppField = 'date' | 'description' | 'amount' | 'type' | 'category' | 'currency' | 'tags'

export const APP_FIELD_LABELS: Record<AppField, string> = {
  date:        'Tarih',
  description: 'Açıklama',
  amount:      'Tutar',
  type:        'Tür',
  category:    'Kategori (opsiyonel)',
  currency:    'Para Birimi (opsiyonel)',
  tags:        'Etiketler (opsiyonel)',
}

export const REQUIRED_FIELDS: AppField[] = ['date', 'description', 'amount', 'type']

export type ColumnMapping = Partial<Record<AppField, string>>

// Auto-detect mapping based on header names
const HEADER_ALIASES: Record<string, AppField> = {
  tarih:       'date',
  date:        'date',
  açıklama:    'description',
  aciklama:    'description',
  description: 'description',
  kategori:    'category',
  category:    'category',
  tutar:       'amount',
  miktar:      'amount',
  amount:      'amount',
  tür:         'type',
  tur:         'type',
  type:        'type',
  'para birimi': 'currency',
  currency:    'currency',
  para:        'currency',
  etiket:      'tags',
  etiketler:   'tags',
  tag:         'tags',
  tags:        'tags',
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const h of headers) {
    const key = h.toLowerCase()
    // hasOwnProperty guard: "constructor" gibi başlıklar prototip zincirinden değer döndürmesin
    const field = Object.prototype.hasOwnProperty.call(HEADER_ALIASES, key) ? HEADER_ALIASES[key] : undefined
    if (field && !mapping[field]) mapping[field] = h
  }
  return mapping
}

// ─── Import — validation ───────────────────────────────────────────────────

const TYPE_MAP: Record<string, TransactionType> = {
  gider:    'expense',
  expense:  'expense',
  gelir:    'income',
  income:   'income',
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

function parseDate(raw: string): string | null {
  const s = raw.trim()
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) return calendarIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
  // DD/MM/YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (dmy) return calendarIso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  return null
}

function parseAmount(raw: string): number | null {
  let cleaned = raw.trim().replace(/[₺$€£\s]/g, '')
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
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  // Negatif tutar geçerlidir: uygulama iadeyi NEGATİF gider olarak yazar ve
  // dışa aktarır. Hangi türde kabul edildiği validateImportRows'ta denetlenir.
  if (isNaN(n) || n === 0) return null
  return Math.round(n * 100) / 100
}

const VALID_CURRENCIES = new Set<string>(['TRY', 'USD', 'EUR', 'GBP'])

export interface ImportedTransaction {
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
): ValidationResult {
  const catByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))
  const valid:  ImportedTransaction[] = []
  const errors: RowError[]           = []

  rows.forEach((row, idx) => {
    const rowNum = rowLines?.[idx] ?? idx + 2
    const errs:  string[] = []

    const rawDate    = (mapping.date        ? row[mapping.date]        : '') ?? ''
    const rawDesc    = (mapping.description ? row[mapping.description] : '') ?? ''
    const rawAmount  = (mapping.amount      ? row[mapping.amount]      : '') ?? ''
    const rawType    = (mapping.type        ? row[mapping.type]        : '') ?? ''
    const rawCat     = (mapping.category    ? row[mapping.category]    : '') ?? ''
    const rawCur     = (mapping.currency    ? row[mapping.currency]    : '') ?? ''
    const rawTags    = (mapping.tags        ? row[mapping.tags]        : '') ?? ''

    const date    = rawDate.trim()   ? parseDate(rawDate)   : null
    const amount  = rawAmount.trim() ? parseAmount(rawAmount) : null
    const typeKey = rawType.trim().toLowerCase()
    const type    = Object.prototype.hasOwnProperty.call(TYPE_MAP, typeKey) ? TYPE_MAP[typeKey] : null

    if (!date)                         errs.push(`Geçersiz tarih: "${rawDate.trim()}"`)
    if (!rawDesc.trim())               errs.push('Açıklama boş olamaz')
    if (amount === null)               errs.push(`Geçersiz tutar: "${rawAmount.trim()}"`)
    if (!type)                         errs.push(`Geçersiz tür: "${rawType.trim()}" (gider/gelir bekleniyor)`)
    // İçe aktarma tek hesaba yapılır; hedef hesabı olmayan transfer yalnızca
    // para çıkışı yaratır — kabul etme
    if (type === 'transfer')           errs.push('Transfer satırları içe aktarılamaz (hedef hesap bilgisi CSV\'de yok)')
    // Negatif gider = iade (RefundModal ile aynı model). Negatif gelirin
    // uygulamada karşılığı yok — sessizce gideri artırmasın diye reddedilir.
    if (amount !== null && amount < 0 && type === 'income') {
      errs.push('Negatif tutar yalnızca gider (iade) satırlarında kabul edilir')
    }

    const categoryId = rawCat.trim() ? catByName.get(rawCat.trim().toLowerCase()) : undefined
    const curRaw     = rawCur.trim().toUpperCase()
    const currency   = (VALID_CURRENCIES.has(curRaw) ? curRaw : 'TRY') as CurrencyCode
    const tags       = parseTagsCell(rawTags)

    if (errs.length > 0) {
      errors.push({ row: rowNum, message: errs.join('; ') })
    } else {
      valid.push({
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
