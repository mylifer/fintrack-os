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

// Truncgil finans API — Türkiye kuyum piyasası fiyatları, ücretsiz, anahtarsız
// YIA = 22 Ayar Bilezik gram fiyatı (TRY). Change alanı % olarak günlük değişim,
// bir önceki kapanış oradan geri hesaplanır.
async function fetchBilezikTry(): Promise<{ current: number; prev: number } | null> {
  try {
    // Sunucu UA'sız istekleri kapatıyor (undici varsayılanı reddediliyor)
    const res = await fetch('https://finans.truncgil.com/v4/today.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const data = await res.json()
    const yia = data?.YIA
    const current = yia?.Selling
    const change = yia?.Change
    if (typeof current === 'number' && current > 0) {
      const prev = typeof change === 'number' && change > -100
        ? current / (1 + change / 100)
        : current
      return { current, prev }
    }
  } catch {}
  return null
}

// 22 ayar milyem — bilezik kotasyonu alınamazsa gram altından türetme çarpanı
const BRACELET_MILYEM = 0.916

// usd.* fields: value = units of that currency per 1 USD
// e.g. usd.try = 34.5  →  1 USD = 34.5 TRY
// goldUsd = USD per troy ounce  →  gram = troy oz / 31.1035
// goldGramTry = (goldUsd / 31.1035) * usdTry
function goldGram(goldUsdPerOz: number, usdTry: number): number {
  return (goldUsdPerOz / 31.1035) * usdTry
}

export async function GET() {
  const [cur, prev, gold, bilezik] = await Promise.all([
    currentRates(), prevRates(), fetchGoldUsd(), fetchBilezikTry(),
  ])

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

  // Bilezik: truncgil canlı 22 ayar kotasyonu; alınamazsa gram altın × milyem
  const bilezikGramTry = bilezik
    ? bilezik.current
    : goldGramTry > 0
      ? goldGramTry * BRACELET_MILYEM
      : undefined

  const prevBilezikGramTry = bilezik
    ? bilezik.prev
    : prevGoldGramTry
      ? prevGoldGramTry * BRACELET_MILYEM
      : undefined

  return NextResponse.json(
    {
      usdTry,
      eurTry,
      gbpTry,
      goldGramTry,
      bilezikGramTry,
      prevUsdTry,
      prevEurTry,
      prevGbpTry,
      prevGoldGramTry,
      prevBilezikGramTry,
      updatedAt: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
