import { NextResponse, type NextRequest } from 'next/server'
import { BoundedCache } from '@/lib/server/bounded-cache'
import { fetchMarketQuote, fetchUsdTry, type YahooChart } from '@/lib/server/yahoo'
import { parseMarketAsset } from '@/lib/market'
import type { TefasFundPrice } from '@/types'

export const dynamic = 'force-dynamic'

const MAX_ASSETS = 30

// İstemci 60 sn'de bir sorar; Yahoo'ya varlık başına en çok dakikada bir gidilir.
// Bulunamayan sembol de kısa süre tutulur (modal doğrulamasının tekrarlı
// sorgusu Yahoo'ya birebir yansımasın). Tavan: sembol uzayı istek sahibinin
// kontrolünde (bkz. bounded-cache.ts, F5).
const TTL_MS = 60 * 1000
const cache = new BoundedCache<{ at: number; quote: TefasFundPrice | null }>(500)
let fxCache: { at: number; promise: Promise<YahooChart | null> } | null = null

function usdTry(): Promise<YahooChart | null> {
  if (!fxCache || Date.now() - fxCache.at > TTL_MS) {
    fxCache = { at: Date.now(), promise: fetchUsdTry({ range: '5d' }) }
  }
  return fxCache.promise
}

// GET /api/prices/market?assets=BIST:THYAO,CRYPTO:BTC
// → { quotes: { 'BIST:THYAO': TefasFundPrice, 'CRYPTO:XYZ': null } }
// Geçersiz ya da bulunamayan varlık null döner; geçerli olanlar etkilenmez.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('assets') ?? ''
  const requested = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))]
  if (!requested.length) return NextResponse.json({ error: 'Geçersiz varlık' }, { status: 400 })

  const quotes: Record<string, TefasFundPrice | null> = {}
  await Promise.all(requested.slice(0, MAX_ASSETS).map(async key => {
    const asset = parseMarketAsset(key)
    if (!asset) { quotes[key] = null; return }
    const hit = cache.get(asset)
    if (hit && Date.now() - hit.at < TTL_MS) { quotes[asset] = hit.quote; return }
    const quote = await fetchMarketQuote(asset, usdTry)
    cache.set(asset, { at: Date.now(), quote })
    quotes[asset] = quote
  }))
  for (const key of requested.slice(MAX_ASSETS)) quotes[key] = null

  return NextResponse.json({ quotes }, { headers: { 'Cache-Control': 'no-store' } })
}
