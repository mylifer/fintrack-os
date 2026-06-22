import type { CurrencyCode } from '@/types'

const FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  TRY: new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }),
}

const COMPACT_FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  TRY: new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }),
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'TRY'): string {
  return FORMATTERS[currency].format(amount)
}

export function formatAmount(amount: number, currency: CurrencyCode = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount)
}

export function parseCurrencyInput(raw: string): number {
  const negative = raw.trimStart().startsWith('-')
  const abs = raw.trimStart().replace(/^-/, '').trim()
  // "1.234,56" (TR): dots are thousands separators → remove them, comma is decimal
  // "1234.56" (EN): dot is decimal → keep as-is
  const normalized = abs.includes(',')
    ? abs.replace(/\./g, '').replace(',', '.')
    : abs
  const n = parseFloat(normalized)
  return isNaN(n) ? 0 : (negative ? -n : n)
}

export function formatCompact(amount: number, currency: CurrencyCode = 'TRY'): string {
  if (Math.abs(amount) >= 1_000_000) {
    const numStr = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(amount / 1_000_000)
    return `${getCurrencySymbol(currency)}${numStr} Mn`
  }
  return COMPACT_FORMATTERS[currency].format(amount)
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  const map: Record<CurrencyCode, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }
  return map[currency]
}
