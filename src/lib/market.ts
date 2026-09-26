// Borsa İstanbul hissesi ve kripto varlıkları — TEFAS fonları gibi asset
// alanına ön ekle gömülür: 'BIST:THYAO', 'CRYPTO:BTC'. Fiyatlar Yahoo
// Finance'ten (ücretsiz, anahtarsız) sunucu tarafında çekilir ve store'daki
// fundPrices sözlüğüne TAM VARLIK ANAHTARIYLA ('BIST:THYAO') yazılır — TEFAS
// kodları ':' içermediği için çakışmaz ve fundPrices'ı zaten taşıyan tüm
// yüzeyler (dashboard, raporlar, net değer grafiği) ek kablolama olmadan
// bu varlıkları da değerler.
import type { InvestmentAsset, MarketAsset } from '@/types'

export type MarketKind = 'BIST' | 'CRYPTO'

export const MARKET_KIND_META: Record<MarketKind, { label: string; unit: string; icon: string; hint: string }> = {
  BIST:   { label: 'BIST Hissesi', unit: 'adet', icon: 'H', hint: 'Örn. THYAO, ASELS, BIMAS' },
  // Kripto küsuratlı alınır; birim olarak sembolün kendisi gösterilir (0,01 BTC)
  CRYPTO: { label: 'Kripto',       unit: 'birim', icon: '₿', hint: 'Örn. BTC, ETH, SOL' },
}

// Hisse kodu 3-6 harf/rakam; kripto sembolü 2-10 (1INCH, SHIB, USDT …)
const SYMBOL_RE: Record<MarketKind, RegExp> = {
  BIST:   /^[A-Z0-9]{3,6}$/,
  CRYPTO: /^[A-Z0-9]{2,10}$/,
}

export function isValidMarketSymbol(kind: MarketKind, symbol: string): boolean {
  return SYMBOL_RE[kind].test(symbol)
}

export function isMarketAsset(asset: string): asset is MarketAsset {
  return asset.startsWith('BIST:') || asset.startsWith('CRYPTO:')
}

export function marketKind(asset: MarketAsset): MarketKind {
  return asset.startsWith('BIST:') ? 'BIST' : 'CRYPTO'
}

export function marketSymbol(asset: InvestmentAsset): string {
  return isMarketAsset(asset) ? asset.slice(asset.indexOf(':') + 1) : ''
}

export function marketAsset(kind: MarketKind, symbol: string): MarketAsset {
  return `${kind}:${symbol.trim().toUpperCase()}`
}

/** Sunucuya gelen ham değeri doğrular; geçersizse null. */
export function parseMarketAsset(raw: string): MarketAsset | null {
  const [kind, symbol, ...rest] = raw.trim().toUpperCase().split(':')
  if (rest.length || (kind !== 'BIST' && kind !== 'CRYPTO') || !symbol) return null
  return isValidMarketSymbol(kind, symbol) ? marketAsset(kind, symbol) : null
}

/** Yahoo Finance sembolü: hisse '.IS' ekli (TRY), kripto '-USD' çifti. */
export function yahooSymbol(asset: MarketAsset): string {
  const sym = marketSymbol(asset)
  return marketKind(asset) === 'BIST' ? `${sym}.IS` : `${sym}-USD`
}

export function marketAssetsIn(assets: Iterable<InvestmentAsset>): MarketAsset[] {
  const out = new Set<MarketAsset>()
  for (const a of assets) if (isMarketAsset(a)) out.add(a)
  return [...out].sort()
}
