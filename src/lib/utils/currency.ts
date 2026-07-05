import type { CurrencyCode } from '@/types'

const FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  TRY: new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }),
}

const COMPACT_FORMATTERS: Record<CurrencyCode, Intl.NumberFormat> = {
  TRY: new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }),
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
  EUR: new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
  GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }),
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'TRY'): string {
  // NaN/Infinity guard: bozuk bir hesaplama UI'da "₺NaN" olarak görünmesin
  return FORMATTERS[currency].format(Number.isFinite(amount) ? amount : 0)
}

export function formatAmount(amount: number, currency: CurrencyCode = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount)
}

export function parseCurrencyInput(raw: string): number {
  const negative = raw.trimStart().startsWith('-')
  const abs = raw.trimStart().replace(/^-/, '').trim()
  // "1.234,56" (TR): dots are thousands separators → remove them, comma is decimal
  // "1.234" / "1.234.567" (TR): dot-grouped thousands with no comma → strip dots
  // "1234.56" (EN): dot is decimal → keep as-is
  const normalized = abs.includes(',')
    ? abs.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(abs)
      ? abs.replace(/\./g, '')
      : abs
  const n = parseFloat(normalized)
  if (isNaN(n)) return 0
  const rounded = Math.round(n * 100) / 100
  return negative ? -rounded : rounded
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
