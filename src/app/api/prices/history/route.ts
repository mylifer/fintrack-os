import { NextResponse } from 'next/server'
import { fetchTefasSeries, snapPeriod } from '@/lib/server/tefas-api'
import { BoundedCache } from '@/lib/server/bounded-cache'

export const dynamic = 'force-dynamic'

export type AssetGroup = 'GOLD' | 'USD' | 'EUR' | 'GBP' | 'TEFAS'
export interface PricePoint { date: string; price: number }

// ── Date sampling ─────────────────────────────────────────────────────────────

// Her dönem GÜN GÜN örneklenir — dönem seçimi yalnızca gösterilen aralığı
// belirler. (Eski 3/7/14 günlük seyrekleştirme, tooltip'te günlük değişim
// gösterilebilsin diye kaldırıldı; maliyeti aşağıdaki kalıcı kur önbelleği öder.)
function sampleDates(from: string): string[] {
  const start = new Date(from + 'T00:00:00Z')
  const end   = new Date(); end.setUTCHours(0, 0, 0, 0)

  const dates: string[] = []
  const cur = new Date(start)
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
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
  // 'latest' yedeği YALNIZ son 1-2 gün için: eski bir tarihe bugünün kuru
  // yazılırsa grafiğin geçmiş ucu bugünkü değerde düzleşir / seri ortasında
  // sivri uç oluşur ve bu yanlış değer süreç önbelleğine kalıcı mühürlenir.
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 1)
  const tags = date >= cutoff.toISOString().split('T')[0] ? [date, 'latest'] : [date]
  for (const tag of tags) {
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

// Tarihi kurlar değişmez → süreç ömrü boyunca kalıcı önbellek. Promise saklamak
// eşzamanlı istekleri de birleştirir (4 varlık grubu aynı günleri ister).
// Başarısız ya da henüz kesinleşmemiş (dünden yeni, 'latest' fallback riski
// taşıyan) günler kalıcı tutulmaz.
//
// Tavan: tek istek en çok 4000 gün örnekler (aşağıdaki slice), 8000 iki tam
// aralığa yer bırakır ve sınırsız büyümeyi keser.
const MAX_USD_ENTRIES = 8000
const usdCache = new BoundedCache<Promise<Record<string, number> | null>>(MAX_USD_ENTRIES)

// Başarısız günün KISA ÖMÜRLÜ notu.
//
// Neden: başarısız gün kalıcı önbelleğe alınmıyor (geçici bir CDN hatası o günü
// sonsuza dek "veri yok" damgalamasın) — ama hiç not edilmediğinde aynı istek
// her tekrarında aynı yüzlerce boş günü (hafta sonları, CDN'de olmayan tarihler)
// baştan çekiyordu. `from` geçmişe alındıkça istek başına binlerce dış çağrı
// çıkıyor ve tekrar hiç ucuzlamıyordu. 60 sn'lik not bu tekrarı keser; süre
// /api/prices/tefas'taki MISS_CACHE_TTL_MS ile aynı, yani geçici bir hata en
// fazla bir dakika iz bırakır ve grafik kendiliğinden dolar.
// (Güvenlik denetimi 2026-08-29, bulgu F4.)
const MISS_TTL_MS = 60_000
const usdMiss = new BoundedCache<number>(MAX_USD_ENTRIES)

function cachedUsd(date: string): Promise<Record<string, number> | null> {
  const hit = usdCache.get(date)
  if (hit) return hit

  const missAt = usdMiss.get(date)
  if (missAt !== undefined && Date.now() - missAt < MISS_TTL_MS) return Promise.resolve(null)

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 1)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const p = fetchUsd(date).then(res => {
    if (!res) {
      usdCache.delete(date)
      usdMiss.set(date, Date.now())
    } else if (date >= cutoffStr) {
      // Kesinleşmemiş gün: 'latest' fallback'inin bugünkü kuru eski bir tarihe
      // kalıcı mühürlemesini engelle (bkz. fetchUsd).
      usdCache.delete(date)
    }
    return res
  })
  usdCache.set(date, p)
  return p
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

// TEFAS fon serisi: API günlük noktaları topluca döner; `from`'a göre kırpılır
// ve TAMAMI döner — grafik her dönemde gün gün değişim gösterir (60 aylık MAX
// dahi ~1250 iş günü noktası; recharts için sorun değil).
async function tefasHistory(code: string, from: string): Promise<PricePoint[] | null> {
  const daysBack = Math.ceil((Date.now() - new Date(from + 'T00:00:00Z').getTime()) / 86_400_000)
  const series = await fetchTefasSeries(code, snapPeriod(daysBack))
  if (!series) return null
  return series.points.filter(p => p.date >= from)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const asset        = searchParams.get('asset') as AssetGroup | null
  const from         = searchParams.get('from')
  const code         = searchParams.get('code')

  // `from` feeds new Date(from) → start.toISOString(); a non-date value makes
  // that throw RangeError and surface as an unhandled 500. Validate the shape
  // up front.
  if (!asset || !from || !['GOLD', 'USD', 'EUR', 'GBP', 'TEFAS'].includes(asset) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
  }

  if (asset === 'TEFAS') {
    if (!code || !/^[A-Z0-9]{2,6}$/.test(code.toUpperCase())) {
      return NextResponse.json({ error: 'Invalid params' }, { status: 400 })
    }
    const points = await tefasHistory(code.toUpperCase(), from)
    if (!points) {
      return NextResponse.json({ error: 'Fon verisi alınamadı' }, { status: 502 })
    }
    return NextResponse.json(points, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Üst sınır: "from=1900-01-01" gibi bir istek binlerce CDN fetch'i
  // tetiklemesin. MAX dönemi artık ilk alım tarihinden başlıyor; ~11 yıllık
  // (4000 gün) tavan gerçekçi bir geçmişi kırpmadan kötüye kullanımı sınırlar.
  const dates = sampleDates(from).slice(-4000)

  // CDN'e nazik: aynı anda en çok 50 tarih; önbellek dolu olduğunda anlık
  // (25 idi — soğuk başlangıçta ~170 günlük tarama dalga sayısını yarıya indirir)
  const points: (PricePoint | null)[] = []
  const CHUNK = 50
  for (let i = 0; i < dates.length; i += CHUNK) {
    points.push(...await Promise.all(
      dates.slice(i, i + CHUNK).map(async (date): Promise<PricePoint | null> => {
        const usd = await cachedUsd(date)
        if (!usd) return null
        const price = computePrice(asset, usd)
        return price !== null ? { date, price } : null
      }),
    ))
  }

  const data = points.filter((p): p is PricePoint => p !== null)

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
