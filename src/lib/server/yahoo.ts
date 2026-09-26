// Yahoo Finance chart API — ücretsiz, anahtarsız (altın vadelisi GC=F zaten
// buradan çekiliyor, bkz. /api/prices). YALNIZ sunucu tarafı: CSP connect-src
// tarayıcıdan dış origin'e izin vermez.
//
// GET /v8/finance/chart/{sembol}?interval=1d&range=5d | period1&period2
//   → chart.result[0] = { meta: { regularMarketPrice, gmtoffset, shortName, … },
//                         timestamp: [...], indicators.quote[0].close: [...] }
// Kapanışlarda null olabilir (tatil / eksik mum) — atlanır.

import { isMarketAsset, marketKind, marketSymbol, yahooSymbol } from '@/lib/market'
import type { MarketAsset, TefasFundPrice } from '@/types'

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'

export interface YahooPoint { date: string; price: number }
export interface YahooChart {
  name: string
  price: number
  /** Son işlem gününden bir önceki günün kapanışı */
  prevPrice?: number
  /** Son fiyatın günü (borsa saat diliminde) */
  date: string
  points: YahooPoint[]
}

// Mum zaman damgası borsanın yerel gün başlangıcına/açılışına denk gelir
// (BIST 09:30 TSİ, TRY=X 00:00 Londra). UTC'ye göre kesmek Londra mumunu bir
// önceki güne kaydırırdı — gmtoffset ile yerel güne çevrilir.
function localDate(ts: number, gmtoffset: number): string {
  return new Date((ts + gmtoffset) * 1000).toISOString().slice(0, 10)
}

export async function fetchYahooChart(
  symbol: string,
  query: { range: string } | { from: string },
): Promise<YahooChart | null> {
  const params = new URLSearchParams({ interval: '1d' })
  if ('range' in query) params.set('range', query.range)
  else {
    params.set('period1', String(Math.floor(new Date(query.from + 'T00:00:00Z').getTime() / 1000)))
    params.set('period2', String(Math.floor(Date.now() / 1000)))
  }
  try {
    const res = await fetch(`${BASE}${encodeURIComponent(symbol)}?${params}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const r = data?.chart?.result?.[0]
    const meta = r?.meta
    const price = meta?.regularMarketPrice
    if (typeof price !== 'number' || !(price > 0)) return null

    const off: number = typeof meta.gmtoffset === 'number' ? meta.gmtoffset : 0
    const ts: unknown[] = Array.isArray(r.timestamp) ? r.timestamp : []
    const closes: unknown[] = r.indicators?.quote?.[0]?.close ?? []
    const byDate = new Map<string, number>()
    ts.forEach((t, i) => {
      const c = closes[i]
      if (typeof t === 'number' && typeof c === 'number' && c > 0) byDate.set(localDate(t, off), c)
    })
    const date = typeof meta.regularMarketTime === 'number'
      ? localDate(meta.regularMarketTime, off)
      : new Date().toISOString().slice(0, 10)
    // Tarih aralıklı sorguda son günün mumu çoğu zaman henüz yoktur (ya da
    // kapanışı null) — seri canlı fiyatla biter ki grafik bugüne uzansın.
    if (!byDate.has(date)) byDate.set(date, price)
    const points = [...byDate.entries()]
      .map(([d, p]) => ({ date: d, price: p }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Önceki kapanış: son fiyatın gününden ÖNCEKİ son mum
    const prevPoint = [...points].reverse().find(p => p.date < date)

    return {
      name: String(meta.shortName || meta.longName || symbol).trim(),
      price,
      prevPrice: prevPoint?.price,
      date,
      points,
    }
  } catch {
    return null
  }
}

/** Serinin gününe göre ileri doldurulmuş değeri (hafta sonu → Cuma). */
export function valueOn(points: YahooPoint[], date: string): number | undefined {
  let v: number | undefined
  for (const p of points) {
    if (p.date > date) break
    v = p.price
  }
  return v ?? points[0]?.price
}

/** Kripto USD fiyatını TL'ye çevirmek için USD/TRY (Yahoo TRY=X). */
export function fetchUsdTry(query: { range: string } | { from: string }) {
  return fetchYahooChart('TRY=X', query)
}

/** Hisse/kripto için canlı TL kotasyonu — fundPrices sözlüğüne yazılan biçimde. */
export async function fetchMarketQuote(
  asset: MarketAsset,
  usdTry: () => Promise<YahooChart | null>,
): Promise<TefasFundPrice | null> {
  if (!isMarketAsset(asset)) return null
  const chart = await fetchYahooChart(yahooSymbol(asset), { range: '5d' })
  if (!chart) return null
  const symbol = marketSymbol(asset)

  if (marketKind(asset) === 'BIST') {
    return { code: symbol, name: chart.name, price: chart.price, prevPrice: chart.prevPrice, date: chart.date }
  }

  const fx = await usdTry()
  if (!fx) return null
  const prevFx = fx.prevPrice ?? fx.price
  return {
    code: symbol,
    // "Bitcoin USD" → "Bitcoin": fiyat TL'ye çevrildiği için çift adı yanıltır
    name: chart.name.replace(/\s+USD$/i, ''),
    price: chart.price * fx.price,
    prevPrice: chart.prevPrice !== undefined ? chart.prevPrice * prevFx : undefined,
    date: chart.date,
  }
}

/** Geçmiş TL serisi (grafik, net değer, geçmiş tarihli alım fiyatı). */
export async function fetchMarketHistory(asset: MarketAsset, from: string): Promise<YahooPoint[] | null> {
  const chart = await fetchYahooChart(yahooSymbol(asset), { from })
  if (!chart || !chart.points.length) return null
  if (marketKind(asset) === 'BIST') return chart.points

  const fx = await fetchUsdTry({ from })
  if (!fx || !fx.points.length) return null
  return chart.points
    .map(p => {
      const rate = valueOn(fx.points, p.date)
      return rate ? { date: p.date, price: p.price * rate } : null
    })
    .filter((p): p is YahooPoint => p !== null)
}
