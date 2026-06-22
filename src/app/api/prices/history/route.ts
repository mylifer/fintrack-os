import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export type AssetGroup = 'GOLD' | 'USD' | 'EUR' | 'GBP'
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

async function fetchUsd(date: string): Promise<Record<string, number> | null> {
  for (const tag of [date, 'latest']) {
    try {
      const res = await fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/usd.min.json`,
        { cache: 'no-store' },
      )
      if (!res.ok) continue
      const d = await res.json()
      if (d?.usd?.try) return d.usd as Record<string, number>
    } catch {}
  }
  return null
}

function computePrice(asset: AssetGroup, usd: Record<string, number>): number | null {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const asset        = searchParams.get('asset') as AssetGroup | null
  const from         = searchParams.get('from')
  const buyDatesRaw  = searchParams.get('buyDates')

  if (!asset || !from || !['GOLD', 'USD', 'EUR', 'GBP'].includes(asset)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  const mustInclude = buyDatesRaw
    ? buyDatesRaw.split(',').filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
    : []

  const dates = sampleDates(from, mustInclude)

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
