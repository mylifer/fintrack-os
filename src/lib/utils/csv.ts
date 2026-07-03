import type { Transaction, Category, CurrencyCode, TransactionType } from '@/types'

// ─── Export ────────────────────────────────────────────────────────────────

const CSV_HEADERS = ['Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Tür', 'Para Birimi']

const TYPE_LABELS: Record<TransactionType, string> = {
  expense:  'Gider',
  income:   'Gelir',
  transfer: 'Transfer',
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function transactionsToCsvString(
  transactions: Transaction[],
  categories: Category[],
): string {
  const catMap = new Map(categories.map(c => [c.id, c.name]))
  const rows = transactions.map(tx =>
    [
      tx.date,
      tx.description,
      tx.categoryId ? (catMap.get(tx.categoryId) ?? '') : '',
      tx.amount.toFixed(2),
      TYPE_LABELS[tx.type],
      tx.currency,
    ]
      .map(v => escapeCsvCell(String(v)))
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...rows].join('\n')
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
  headers: string[]
  rows:    Record<string, string>[]
}

export function parseCsvText(text: string): ParsedCsv {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines      = normalized.split('\n').filter(l => l.trim())

  if (lines.length < 2) {
    throw new Error('CSV dosyası boş veya yalnızca başlık satırı içeriyor.')
  }

  function parseLine(line: string): string[] {
    const cells: string[] = []
    let current  = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim()); current = ''
      } else {
        current += ch
      }
    }
    cells.push(current.trim())
    return cells
  }

  const headers = parseLine(lines[0])
  const rows    = lines.slice(1).map(line => {
    const cells: Record<string, string> = {}
    parseLine(line).forEach((v, i) => { cells[headers[i] ?? `col${i}`] = v })
    return cells
  })

  return { headers, rows }
}

// ─── Import — column mapping ───────────────────────────────────────────────

export type AppField = 'date' | 'description' | 'amount' | 'type' | 'category' | 'currency'

export const APP_FIELD_LABELS: Record<AppField, string> = {
  date:        'Tarih',
  description: 'Açıklama',
  amount:      'Tutar',
  type:        'Tür',
  category:    'Kategori (opsiyonel)',
  currency:    'Para Birimi (opsiyonel)',
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
}

export function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const h of headers) {
    const field = HEADER_ALIASES[h.toLowerCase()]
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

function parseDate(raw: string): string | null {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : s
  }
  // DD/MM/YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : iso
  }
  return null
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[₺$€£\s]/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  if (isNaN(n) || n < 0) return null
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
): ValidationResult {
  const catByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))
  const valid:  ImportedTransaction[] = []
  const errors: RowError[]           = []

  rows.forEach((row, idx) => {
    const rowNum = idx + 2
    const errs:  string[] = []

    const rawDate    = (mapping.date        ? row[mapping.date]        : '') ?? ''
    const rawDesc    = (mapping.description ? row[mapping.description] : '') ?? ''
    const rawAmount  = (mapping.amount      ? row[mapping.amount]      : '') ?? ''
    const rawType    = (mapping.type        ? row[mapping.type]        : '') ?? ''
    const rawCat     = (mapping.category    ? row[mapping.category]    : '') ?? ''
    const rawCur     = (mapping.currency    ? row[mapping.currency]    : '') ?? ''

    const date   = rawDate.trim()   ? parseDate(rawDate)   : null
    const amount = rawAmount.trim() ? parseAmount(rawAmount) : null
    const type   = TYPE_MAP[rawType.trim().toLowerCase()] ?? null

    if (!date)                         errs.push(`Geçersiz tarih: "${rawDate.trim()}"`)
    if (!rawDesc.trim())               errs.push('Açıklama boş olamaz')
    if (amount === null)               errs.push(`Geçersiz tutar: "${rawAmount.trim()}"`)
    if (!type)                         errs.push(`Geçersiz tür: "${rawType.trim()}" (gider/gelir/transfer bekleniyor)`)

    const categoryId = rawCat.trim() ? catByName.get(rawCat.trim().toLowerCase()) : undefined
    const curRaw     = rawCur.trim().toUpperCase()
    const currency   = (VALID_CURRENCIES.has(curRaw) ? curRaw : 'TRY') as CurrencyCode

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
      })
    }
  })

  return { valid, errors }
}
