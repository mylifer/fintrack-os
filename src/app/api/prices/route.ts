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

// Truncgil finans API — Türkiye kuyum piyasası (Kapalıçarşı) kotasyonları,
// ücretsiz, anahtarsız. Sistemdeki tüm altın fiyatları Türkiye ALIŞ (Buying)
// fiyatını izler; uluslararası spot hesabı yalnızca kaynak erişilemezse
// fallback olarak devreye girer. Change alanı % günlük değişim — bir önceki
// kapanış oradan geri hesaplanır.
interface TrQuote { current: number; prev: number }
interface TurkishGold {
  gram?: TrQuote      // GRA  — gram altın
  quarter?: TrQuote   // CEYREKALTIN
  half?: TrQuote      // YARIMALTIN
  full?: TrQuote      // TAMALTIN
  bracelet?: TrQuote  // YIA  — 22 ayar bilezik (gram)
}

async function fetchTurkishGold(): Promise<TurkishGold | null> {
  try {
    // Sunucu UA'sız istekleri kapatıyor (undici varsayılanı reddediliyor)
    const res = await fetch('https://finans.truncgil.com/v4/today.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const data = await res.json()

    const parse = (key: string): TrQuote | undefined => {
      const q = data?.[key]
      const current = q?.Buying
      const change = q?.Change
      if (typeof current !== 'number' || current <= 0) return undefined
      const prev = typeof change === 'number' && change > -100
        ? current / (1 + change / 100)
        : current
      return { current, prev }
    }

    const gold: TurkishGold = {
      gram:     parse('GRA'),
      quarter:  parse('CEYREKALTIN'),
      half:     parse('YARIMALTIN'),
      full:     parse('TAMALTIN'),
      bracelet: parse('YIA'),
    }
    if (gold.gram || gold.quarter || gold.half || gold.full || gold.bracelet) return gold
  } catch {}
  return null
}

// Türkiye kotasyonu alınamazsa gram altından türetme çarpanları.
// Ziynetler 22 ayar: has karşılığı = brüt gramaj × 0.916 milyem
// (çeyrek 1.754 g, yarım 3.508 g, tam 7.016 g)
const BRACELET_MILYEM = 0.916
const QUARTER_FINE    = 1.6067
const HALF_FINE       = 3.2133
const FULL_FINE       = 6.4267

// usd.* fields: value = units of that currency per 1 USD
// e.g. usd.try = 34.5  →  1 USD = 34.5 TRY
// goldUsd = USD per troy ounce  →  gram = troy oz / 31.1035
// goldGramTry = (goldUsd / 31.1035) * usdTry
function goldGram(goldUsdPerOz: number, usdTry: number): number {
  return (goldUsdPerOz / 31.1035) * usdTry
}

export async function GET() {
  const [cur, prev, gold, tr] = await Promise.all([
    currentRates(), prevRates(), fetchGoldUsd(), fetchTurkishGold(),
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

  // Gram altın: Türkiye piyasa alış kotasyonu; yoksa Yahoo spot, o da yoksa fawazahmed0 xau
  const goldGramTry = tr?.gram
    ? tr.gram.current
    : gold
      ? goldGram(gold.current, usdTry)
      : cur.xau
        ? cur.try / (cur.xau * 31.1035)
        : 0

  const prevGoldGramTry = tr?.gram
    ? tr.gram.prev
    : gold && prevUsdTry
      ? goldGram(gold.prev, prevUsdTry)
      : prev?.xau
        ? prev.try / (prev.xau * 31.1035)
        : undefined

  // Ziynet altınları: Türkiye kotasyonu; yoksa gram altından has karşılığıyla türet
  const fromGram = (mult: number) => (goldGramTry > 0 ? goldGramTry * mult : undefined)
  const prevFromGram = (mult: number) => (prevGoldGramTry ? prevGoldGramTry * mult : undefined)

  const goldQuarterTry     = tr?.quarter?.current  ?? fromGram(QUARTER_FINE)
  const prevGoldQuarterTry = tr?.quarter?.prev     ?? prevFromGram(QUARTER_FINE)
  const goldHalfTry        = tr?.half?.current     ?? fromGram(HALF_FINE)
  const prevGoldHalfTry    = tr?.half?.prev        ?? prevFromGram(HALF_FINE)
  const goldFullTry        = tr?.full?.current     ?? fromGram(FULL_FINE)
  const prevGoldFullTry    = tr?.full?.prev        ?? prevFromGram(FULL_FINE)
  const bilezikGramTry     = tr?.bracelet?.current ?? fromGram(BRACELET_MILYEM)
  const prevBilezikGramTry = tr?.bracelet?.prev    ?? prevFromGram(BRACELET_MILYEM)

  return NextResponse.json(
    {
      usdTry,
      eurTry,
      gbpTry,
      goldGramTry,
      goldQuarterTry,
      goldHalfTry,
      goldFullTry,
      bilezikGramTry,
      prevUsdTry,
      prevEurTry,
      prevGbpTry,
      prevGoldGramTry,
      prevGoldQuarterTry,
      prevGoldHalfTry,
      prevGoldFullTry,
      prevBilezikGramTry,
      updatedAt: Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
