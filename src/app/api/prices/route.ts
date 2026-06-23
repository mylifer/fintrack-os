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
      if (usd?.try && usd?.eur && usd?.gbp && usd?.xau) return usd
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

// usd.* fields: value = units of that currency per 1 USD
// e.g. usd.try = 34.5  →  1 USD = 34.5 TRY
// e.g. usd.eur = 0.92  →  1 USD = 0.92 EUR  →  1 EUR = 34.5/0.92 TRY
// e.g. usd.xau = 0.00048  →  1 USD = 0.00048 oz gold  →  1 gram gold = usdTry/(xau*31.1035) TRY
function parse(r: Record<string, number>) {
  return {
    usdTry:      r.try,
    eurTry:      r.try / r.eur,
    gbpTry:      r.try / r.gbp,
    goldGramTry: r.try / (r.xau * 31.1035),
  }
}

export async function GET() {
  const [cur, prev] = await Promise.all([currentRates(), prevRates()])

  if (!cur) {
    return NextResponse.json({ error: 'Fiyatlar alınamadı' }, { status: 502 })
  }

  const c = parse(cur)
  const p = prev ? parse(prev) : null

  return NextResponse.json(
    {
      ...c,
      prevUsdTry:      p?.usdTry,
      prevEurTry:      p?.eurTry,
      prevGbpTry:      p?.gbpTry,
      prevGoldGramTry: p?.goldGramTry,
      updatedAt:       Date.now(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
