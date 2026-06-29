import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// fawazahmed0 currency API — free, no key, daily updates
// Primary:  jsDelivr CDN
// Fallback: Cloudflare Pages (currency-api.pages.dev)

function isoDate(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return d.toISOString().split('T')[0]
}

async function fetchUsdRates(dateTag: string): Promise<Record<string, number> | null> {
  const urls =
    dateTag === 'latest'
      ? [
          'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
          'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
        ]
      : [
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateTag}/v1/currencies/usd.min.json`,
          `https://${dateTag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
        ]

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue
      const data = await res.json()
      const usd = data?.usd
      if (usd?.try && usd?.eur && usd?.gbp) return usd
    } catch {}
  }
  return null
}

// Try today first, then fall back one day at a time (handles weekends / CDN lag)
async function currentRates(): Promise<Record<string, number> | null> {
  for (const tag of ['latest', isoDate(0), isoDate(1)]) {
    const r = await fetchUsdRates(tag)
    if (r) return r
  }
  return null
}

async function prevRates(): Promise<Record<string, number> | null> {
  for (const tag of [isoDate(1), isoDate(2), isoDate(3)]) {
    const r = await fetchUsdRates(tag)
    if (r) return r
  }
  return null
}

// Yahoo Finance GC=F (gold futures) — free, no key, real-time
// Returns { current, prev } in USD per troy ounce
async function fetchGoldUsd(): Promise<{ current: number; prev: number } | null> {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2d'
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    const current = meta?.regularMarketPrice
    const prev = meta?.chartPreviousClose
    if (typeof current === 'number' && current > 0) {
      return { current, prev: typeof prev === 'number' && prev > 0 ? prev : current }
    }
  } catch {}
  return null
}

// usd.* fields: value = units of that currency per 1 USD
// e.g. usd.try = 34.5  →  1 USD = 34.5 TRY
// goldUsd = USD per troy ounce  →  gram = troy oz / 31.1035
// goldGramTry = (goldUsd / 31.1035) * usdTry
function goldGram(goldUsdPerOz: number, usdTry: number): number {
  return (goldUsdPerOz / 31.1035) * usdTry
}

export async function GET() {
  const [cur, prev, gold] = await Promise.all([currentRates(), prevRates(), fetchGoldUsd()])

  if (!cur) {
    return NextResponse.json({ error: 'Fiyatlar alınamadı' }, { status: 502 })
  }

  const usdTry     = cur.try
  const eurTry     = cur.try / cur.eur
  const gbpTry     = cur.try / cur.gbp
  const prevUsdTry = prev?.try
  const prevEurTry = prev ? prev.try / prev.eur : undefined
  const prevGbpTry = prev ? prev.try / prev.gbp : undefined

  // Gold: use Yahoo Finance live price; fall back to fawazahmed0 xau if unavailable
  const goldGramTry = gold
    ? goldGram(gold.current, usdTry)
    : cur.xau
      ? cur.try / (cur.xau * 31.1035)
      : 0

  const prevGoldGramTry = gold && prevUsdTry
    ? goldGram(gold.prev, prevUsdTry)
    : prev?.xau
      ? prev.try / (prev.xau * 31.1035)
      : undefined

  return NextResponse.json(
    {
      usdTry,
      eurTry,
      gbpTry,
      goldGramTry,
      prevUsdTry,
      prevEurTry,
      prevGbpTry,
      prevGoldGramTry,
      updatedAt: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
