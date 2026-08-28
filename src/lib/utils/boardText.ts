import { today } from '@/lib/utils/date'

/* ── Liste/tahta sayfalarının ortak metin yardımcıları ───────────────────────
 * Alıcılar, Aile Üyeleri ve Kategoriler aynı arama davranışını paylaşır:
 * Türkçe İ/ı duyarlı, boşlukla ayrılan parçalar VE'lenir, eşleşen harfler
 * vurgulanır. Kural tek yerde dursun diye burada.
 * ------------------------------------------------------------------------- */

// Türkçe İ/ı için locale-duyarlı küçük harf ("İkea" ↔ "ikea").
export const lcTr = (s: string) => s.toLocaleLowerCase('tr-TR')

export function tokenize(query: string): string[] {
  return lcTr(query).trim().split(/\s+/).filter(Boolean)
}

/** Boşlukla ayrılan parçalar VE'lenir: "mig ist" → "Migros İstanbul" bulur. */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return true
  const hay = lcTr(haystack)
  return tokens.every(t => hay.includes(t))
}

/** Vurgulama için: metnin içinde eşleşen ilk parçanın [başlangıç, bitiş] aralığı. */
export function matchRange(text: string, query: string): [number, number] | null {
  const tokens = tokenize(query)
  if (!tokens.length) return null
  const hay = lcTr(text)
  for (const t of tokens) {
    const i = hay.indexOf(t)
    if (i >= 0) return [i, i + t.length]
  }
  return null
}

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** '2026-08-14' → '14 Ağu'; aynı yıl değilse '14 Ağu 25'. */
export function shortDate(iso: string | null, asOf: string = today()): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const label = `${Number(d)} ${MONTHS_TR[Number(m) - 1]}`
  return y === asOf.slice(0, 4) ? label : `${label} ${y.slice(2)}`
}
