import { NextResponse, type NextRequest } from 'next/server'
import { fetchTefasSeries, type TefasSeries } from '@/lib/server/tefas-api'
import { BoundedCache } from '@/lib/server/bounded-cache'
import type { TefasFundPrice } from '@/types'

export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Z0-9]{2,6}$/
const MAX_CODES = 30

// Fon fiyatı günlük veri — 60 sn'lik istemci polling'i TEFAS'a birebir yansımasın
// diye kod başına kısa süreli bellek içi cache (instance ömrüyle sınırlı, yeterli).
// Bulunamayan kod DAHA KISA cache'lenir: TEFAS'ın anlık bir hatası/zaman aşımı
// yüzünden fon 10 dk boyunca "fiyatsız" kalmasın (yalnızca modal doğrulamasının
// tekrarlı sorgusunu yumuşatacak kadar).
// Boyut tavanı: kod deseni `[A-Z0-9]{2,6}` olduğu için anahtar uzayı teoride
// milyarlarca — geçerli fon sayısı birkaç yüz, dolayısıyla 500'lük tavan gerçek
// kullanımı hiç ısırmaz ama enumerasyonla bellek şişirmeyi keser
// (bkz. src/lib/server/bounded-cache.ts, güvenlik denetimi 2026-08-29 / F5).
const CACHE_TTL_MS      = 10 * 60 * 1000
const MISS_CACHE_TTL_MS = 60 * 1000
const MAX_CACHE_ENTRIES = 500
const cache = new BoundedCache<{ at: number; series: TefasSeries | null }>(MAX_CACHE_ENTRIES)

async function getSeries(code: string): Promise<TefasSeries | null> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < (hit.series ? CACHE_TTL_MS : MISS_CACHE_TTL_MS)) return hit.series
  const series = await fetchTefasSeries(code, 1)
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
  const requested = [...new Set(raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean))]

  if (!requested.length) {
    return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 })
  }

  // Tek bozuk kod (ya da MAX_CODES'u aşan bir portföy) TÜM isteği düşürmemeli:
  // eskiden bu durumda 400 dönüyor ve o çalışma alanındaki HİÇBİR fonun fiyatı
  // akmıyordu (istemci hatayı sessizce yutuyor). Artık yalnızca ilgili kodlar
  // null döner, geçerli olanlar normal şekilde fiyatlanır.
  const valid = requested.filter(c => CODE_RE.test(c)).slice(0, MAX_CODES)

  const funds: Record<string, TefasFundPrice | null> = {}
  for (const code of requested) funds[code] = null

  const results = await Promise.all(valid.map(getSeries))
  valid.forEach((code, i) => {
    const series = results[i]
    if (series) funds[code] = toFundPrice(series)
  })

  return NextResponse.json(
    { funds, updatedAt: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
