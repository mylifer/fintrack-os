import { NextResponse } from 'next/server'
import { fetchTefasSeries, snapPeriod } from '@/lib/server/tefas-api'

export const dynamic = 'force-dynamic'

export type AssetGroup = 'GOLD' | 'USD' | 'EUR' | 'GBP' | 'TEFAS'
export interface PricePoint { date: string; price: number }

// ── Date sampling ─────────────────────────────────────────────────────────────

function sampleDates(from: string, mustInclude: string[] = []): string[] {
  const start = new Date(from + 'T00:00:00Z')
  const end   = new Date(); end.setUTCHours(0, 0, 0, 0)
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000)

  const step = diffDays <= 30 ? 1 : diffDays <= 90 ? 3 : diffDays <= 365 ? 7 : 14

  const dates: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setUTCDate(cur.getUTCDate() + step)
  }
  const endStr = end.toISOString().split('T')[0]
  if (dates[dates.length - 1] !== endStr) dates.push(endStr)

  // Always include purchase dates (e.g. from buyDates param) so markers land on real data points
  const fromStr = start.toISOString().split('T')[0]
  const dateSet = new Set(dates)
  for (const d of mustInclude) {
    if (d >= fromStr && d <= endStr && !dateSet.has(d)) {
      dates.push(d)
      dateSet.add(d)
    }
  }

  return dates.sort()
}

// ── fawazahmed0 fetch ──────────────────────────────────────────────────────────

// Aynı gün için iki kaynak denenir (jsDelivr → Cloudflare Pages); /api/prices
// canlı rotasıyla aynı yedekleme — tek CDN'e bağımlılık geçmiş tarihli alımlarda
// fiyatın hiç dolmamasına yol açıyordu.
function usdUrls(tag: string): string[] {
  return tag === 'latest'
    ? [
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
        'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
      ]
    : [
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
        `https://${tag}.currency-api.pages.dev/v1/currencies/usd.min.json`,
      ]
}

async function fetchUsd(date: string): Promise<Record<string, number> | null> {
  for (const tag of [date, 'latest']) {
    for (const url of usdUrls(tag)) {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6_000) })
        if (!res.ok) continue
        const d = await res.json()
        if (d?.usd?.try) return d.usd as Record<string, number>
      } catch {}
    }
  }
  return null
}

function computePrice(asset: Exclude<AssetGroup, 'TEFAS'>, usd: Record<string, number>): number | null {
  const t = usd.try
  if (!t) return null
  switch (asset) {
    case 'USD':  return t
    case 'EUR':  return usd.eur ? t / usd.eur  : null
    case 'GBP':  return usd.gbp ? t / usd.gbp  : null
    case 'GOLD': return usd.xau ? t / (usd.xau * 31.1035) : null
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

// TEFAS fon serisi: API zaten günlük noktaları topluca döner; `from`'a göre
// kırpıp grafiğin taşımayacağı kadar seyrekleştirmek yeterli.
// mustInclude (alım tarihleri) seyrekleştirmede korunur — yoksa işaretçiler kayar.
async function tefasHistory(code: string, from: string, mustInclude: string[] = []): Promise<PricePoint[] | null> {
  const daysBack = Math.ceil((Date.now() - new Date(from + 'T00:00:00Z').getTime()) / 86_400_000)
  const series = await fetchTefasSeries(code, snapPeriod(daysBack))
  if (!series) return null

  const points = series.points.filter(p => p.date >= from)
  if (points.length <= 400) return points

  const keep = new Set(mustInclude)
  const step = Math.ceil(points.length / 400)
  const thinned = points.filter((p, i) => i % step === 0 || keep.has(p.date))
  if (thinned[thinned.length - 1]?.date !== points[points.length - 1].date) {
    thinned.push(points[points.length - 1])
  }
  return thinned
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const asset        = searchParams.get('asset') as AssetGroup | null
  const from         = searchParams.get('from')
  const buyDatesRaw  = searchParams.get('buyDates')
  const code         = searchParams.get('code')

  // `from` feeds new Date(from) → start.toISOString(); a non-date value makes
  // that throw RangeError and surface as an unhandled 500. Validate the shape
  // up front (same YYYY-MM-DD regex used for buyDates below).
  if (!asset || !from || !['GOLD', 'USD', 'EUR', 'GBP', 'TEFAS'].includes(asset) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  const mustInclude = buyDatesRaw
    ? buyDatesRaw.split(',').filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
    : []

  if (asset === 'TEFAS') {
    if (!code || !/^[A-Z0-9]{2,6}$/.test(code.toUpperCase())) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
    }
    const points = await tefasHistory(code.toUpperCase(), from, mustInclude)
    if (!points) {
      return NextResponse.json({ error: 'Fon verisi alınamadı' }, { status: 502 })
    }
    return NextResponse.json(points, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Üst sınır: "from=1900-01-01" gibi bir istek binlerce paralel CDN fetch'i
  // tetiklemesin — örnekleme adımı zaten seyrekleştiriyor, 400 nokta ≈ 15+ yıl
  const dates = sampleDates(from, mustInclude).slice(-400)

  const points = await Promise.all(
    dates.map(async (date): Promise<PricePoint | null> => {
      const usd = await fetchUsd(date)
      if (!usd) return null
      const price = computePrice(asset, usd)
      return price !== null ? { date, price } : null
    }),
  )

  const data = points.filter((p): p is PricePoint => p !== null)

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
