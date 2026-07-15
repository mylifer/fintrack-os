import { NextResponse, type NextRequest } from 'next/server'
import { fetchTefasSeries, type TefasSeries } from '@/lib/server/tefas-api'
import type { TefasFundPrice } from '@/types'

export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Z0-9]{2,6}$/
const MAX_CODES = 30

// Fon fiyatı günlük veri — 60 sn'lik istemci polling'i TEFAS'a birebir yansımasın
// diye kod başına kısa süreli bellek içi cache (instance ömrüyle sınırlı, yeterli).
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; series: TefasSeries | null }>()

async function getSeries(code: string): Promise<TefasSeries | null> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.series
  const series = await fetchTefasSeries(code, 1)
  // Bulunamayan kodu da (kısa süreli) cache'le — modal doğrulaması tekrarlı sorar
  cache.set(code, { at: Date.now(), series })
  return series
}

function toFundPrice(series: TefasSeries): TefasFundPrice {
  const pts  = series.points
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  return {
    code:      series.code,
    name:      series.name,
    price:     last.price,
    prevPrice: prev?.price,
    date:      last.date,
  }
}

// GET /api/prices/tefas?codes=AFA,YAC
// → { funds: { AFA: TefasFundPrice, YAC: null }, updatedAt }
// Bilinmeyen/bulunamayan kod null döner — modal "fon bulunamadı" gösterir.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('codes') ?? ''
  const codes = [...new Set(raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean))]

  if (!codes.length || codes.length > MAX_CODES || codes.some(c => !CODE_RE.test(c))) {
    return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 })
  }

  const results = await Promise.all(codes.map(getSeries))

  const funds: Record<string, TefasFundPrice | null> = {}
  codes.forEach((code, i) => {
    const series = results[i]
    funds[code] = series ? toFundPrice(series) : null
  })

  return NextResponse.json(
    { funds, updatedAt: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
