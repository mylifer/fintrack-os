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

// İşaretli tutar: negatifte U+2212 (−), pozitif/sıfırda +. Tüm uygulamada
// tutarlı işaret gösterimi için tek kaynak.
export function formatSigned(v: number, currency: CurrencyCode = 'TRY'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrency(Math.abs(v), currency)}`
}

export function formatAmount(amount: number, currency: CurrencyCode = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount)
}

// Tutar inputları için canlı maske: yazarken TR biçimi uygular
// (binlik = nokta, ondalık = virgül). Kural: virgül ondalık ayracıdır
// (ilk virgül geçerli, en fazla 2 hane); kullanıcının yazdığı noktalar
// binlik ayracı sayılır ve gruplar yeniden hesaplanır.
export function formatCurrencyInputLive(raw: string): string {
  const negative = raw.trimStart().startsWith('-')
  const cleaned  = raw.replace(/[^0-9,]/g, '')
  if (!cleaned) return negative ? '-' : ''
  const commaIdx = cleaned.indexOf(',')
  const hasComma = commaIdx !== -1
  const intRaw   = (hasComma ? cleaned.slice(0, commaIdx) : cleaned).replace(/^0+(?=\d)/, '')
  const decRaw   = hasComma ? cleaned.slice(commaIdx + 1).replace(/,/g, '').slice(0, 2) : ''
  const grouped  = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (negative ? '-' : '') + grouped + (hasComma ? ',' + decRaw : '')
}

// Kayıtlı bir sayıyı düzenleme inputuna TR biçiminde seed etmek için
// ("1.234,56"). String(n) kullanmayın: JS'in nokta ondalığı ("1234.5")
// maske tarafından binlik sanılır.
export function formatNumberForInput(n: number): string {
  if (!Number.isFinite(n)) return ''
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(n)
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

// Grafik eksenleri için gerçek "compact" gösterim: dar eksen sütununa sığar.
// ör. 125.000 → "₺125B", 1.200.000 → "₺1,2Mn". (formatCompact <1M'de tam
// biçime düştüğü ve eksende kırpıldığı için ayrı bir fonksiyon.)
export function formatAxisCompact(v: number, currency: CurrencyCode = 'TRY'): string {
  const sym = getCurrencySymbol(currency)
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) {
    const n = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(abs / 1_000_000)
    return `${sign}${sym}${n}Mn`
  }
  if (abs >= 1_000) {
    const n = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(abs / 1_000)
    return `${sign}${sym}${n}B`
  }
  return `${sign}${sym}${abs}`
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  const map: Record<CurrencyCode, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }
  return map[currency]
}
