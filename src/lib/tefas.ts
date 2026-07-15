// TEFAS fonu yardımcıları — fon varlıkları asset alanında 'TEFAS:KOD' olarak gömülü
import type { InvestmentAsset, TefasAsset } from '@/types'

export const TEFAS_PREFIX = 'TEFAS:'

// TEFAS fon kodları 2-6 harf/rakam (örn. AFA, YAC, TI2)
export const TEFAS_CODE_RE = /^[A-Z0-9]{2,6}$/

export function isTefasAsset(asset: string): asset is TefasAsset {
  return asset.startsWith(TEFAS_PREFIX)
}

export function tefasCode(asset: InvestmentAsset): string {
  return isTefasAsset(asset) ? asset.slice(TEFAS_PREFIX.length) : ''
}

export function tefasAsset(code: string): TefasAsset {
  return `${TEFAS_PREFIX}${code.trim().toUpperCase()}`
}

// Bir işlem listesindeki farklı TEFAS fon kodları
export function tefasCodesIn(assets: Iterable<InvestmentAsset>): string[] {
  const codes = new Set<string>()
  for (const a of assets) if (isTefasAsset(a)) codes.add(tefasCode(a))
  return [...codes]
}
