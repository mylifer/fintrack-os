import { NextResponse } from 'next/server'
import { BoundedCache } from './bounded-cache'

/* ── /api/* istek sınırı (bağımlılıksız, süreç içi) ──────────────────────────

   Fiyat rotaları ve /api/brand-logo her istekte dış servislere (jsDelivr,
   Yahoo, TEFAS, truncgil, Clearbit, Wikidata) gidiyor. Oturum açmış tek bir
   kullanıcı döngüyle istek atarak hem bu servislerin bizi engellemesine hem
   de fonksiyon süresinin tükenmesine yol açabiliyordu (güvenlik denetimi
   2026-08-29, F4/F5 "basit rate limit").

   Algoritma: kayan pencere SAYACI (sliding window counter). Anahtar başına
   yalnız iki sayı tutulur — içinde bulunulan sabit pencere ve bir öncekinin
   sayısı; önceki pencerenin sayısı, kayan pencerede kalan payıyla ağırlıklanır:
       tahmin = önceki × (1 − geçen/pencere) + şimdiki
   Zaman damgası günlüğüne göre bellek O(1)/anahtar; sabit pencerenin sınırda
   2× patlamasına da izin vermez.

   Anahtar uzayı BoundedCache ile tavanlı: IP başına anahtar istek sahibinin
   kontrolünde (sahte X-Forwarded-For ile sınırsız anahtar üretilebilir).
   Tavan dolunca en eski anahtar atılır — en kötü durumda o anahtar sınırını
   "unutur", bellek asla büyümez.

   ÖNEMLİ — EN İYİ ÇABA: Sayaçlar yalnız BU SÜREÇTE yaşar. Sunucusuz ortamda
   (Vercel) her fonksiyon örneğinin kendi sayacı vardır, soğuk başlangıçta
   sıfırlanır ve istekler örnekler arasında dağılır; gerçek üst sınır
   "sınır × eşzamanlı örnek sayısı"dır. Bu katman kazara döngüleri ve tek
   istemcinin kaba kötüye kullanımını keser; kesin, dağıtık bir kota gerekirse
   paylaşılan bir depo (Redis/Upstash, Postgres) şarttır. */

export interface RateLimitRule {
  /** Pencere başına izin verilen istek */
  limit: number
  /** Pencere uzunluğu (ms) */
  windowMs: number
}

export interface RateLimitResult {
  ok: boolean
  /** ok=false iken: yeniden denemeden önce beklenecek saniye (≥1) */
  retryAfterSec: number
  remaining: number
}

interface Counter {
  /** İçinde bulunulan pencerenin başlangıcı (ms, windowMs'nin katı) */
  start: number
  curr: number
  prev: number
}

export class SlidingWindowLimiter {
  private readonly counters: BoundedCache<Counter>

  constructor(private readonly rule: RateLimitRule, maxKeys = 10_000) {
    if (rule.limit < 1 || rule.windowMs < 1) throw new Error('SlidingWindowLimiter: geçersiz kural')
    this.counters = new BoundedCache<Counter>(maxKeys)
  }

  get size(): number {
    return this.counters.size
  }

  /** İsteği sayar ve izin verilip verilmediğini döner. Reddedilen istek
   *  SAYILMAZ — aşan istemci beklediği sürece kendini kilitli tutmaz. */
  hit(key: string, now = Date.now()): RateLimitResult {
    const { limit, windowMs } = this.rule
    const start = Math.floor(now / windowMs) * windowMs
    let c = this.counters.get(key)
    if (!c || start - c.start >= 2 * windowMs) {
      c = { start, curr: 0, prev: 0 }
    } else if (start !== c.start) {
      // Bir sonraki pencereye geçildi: şimdiki → önceki
      c = { start, curr: 0, prev: c.curr }
    }

    const elapsed = now - start
    const estimate = c.prev * (1 - elapsed / windowMs) + c.curr

    if (estimate + 1 > limit) {
      // Hâlâ yeniden yazıyoruz: pencere kaydırması kaybolmasın, anahtar sıcak kalsın
      this.counters.set(key, c)
      return { ok: false, retryAfterSec: retryAfter(c, elapsed, this.rule), remaining: 0 }
    }

    c.curr += 1
    this.counters.set(key, c)
    return { ok: true, retryAfterSec: 0, remaining: Math.max(0, Math.floor(limit - estimate - 1)) }
  }
}

/** Bir isteğe yer açılana (tahmin + 1 ≤ limit) kadar geçecek süre, saniye. */
function retryAfter(c: Counter, elapsed: number, { limit, windowMs }: RateLimitRule): number {
  const room = limit - 1 // tahminin inmesi gereken değer
  let waitMs: number
  if (c.curr <= room && c.prev > 0) {
    // Bu pencere içinde, öncekinin payı eridikçe yer açılır:
    // prev × (1 − (elapsed+t)/W) + curr ≤ room
    waitMs = windowMs * (1 - (room - c.curr) / c.prev) - elapsed
  } else {
    // Bu pencerenin kendisi dolu: sonraki pencerede curr önceki olur
    // curr × (1 − t'/W) ≤ room
    waitMs = (windowMs - elapsed) + Math.max(0, windowMs * (1 - room / c.curr))
  }
  return Math.max(1, Math.ceil(waitMs / 1000))
}

/* ── Rota kuralları ──────────────────────────────────────────────────────────
   Cömert seçildi: normal kullanım ASLA takılmamalı. Koddan sayım (kullanıcı
   başına, tek sekme):
   - /api/prices: investment.store fetchPrices — açılışta 1, sonra 60 sn'de 1.
   - /api/prices/tefas, /market: her fetchPrices ardından 25'lik parçalar
     (30 fon → 2 istek) + BuySellModal'da kod doğrulaması (tuş başına değil,
     onay başına).
   - /api/prices/history: yatırımlar sayfası açılışında varlık grubu ve fon
     başına bir seri (useAssetHistory; 40 fon + 20 hisse ≈ 60+ istek), panoda
     ve raporlarda fon başına bir istek, NetWorthChart, PriceHistoryChart.
     En yoğun rota: sekmeler arası gezinti ve yeniden açılışlar üst üste biner.
   - /api/brand-logo: people.store backfill'i alıcıları SIRAYLA sorar; sonuçlar
     istemcide (localStorage / person.url) kalıcı, tekrar sormaz. İlk açılışta
     yüzlerce yeni alıcısı olan bir kullanıcı birkaç dakikaya yayılır — 429
     alan isim önbelleğe yazılmaz, sonraki oturumda yeniden denenir.
   Birden çok sekme aynı kullanıcı anahtarını paylaşır; sınırlar bunu da
   karşılayacak kadar yüksek. */
const MINUTE = 60_000

export const RATE_LIMITS = {
  prices:     { limit: 30,  windowMs: MINUTE },
  tefas:      { limit: 60,  windowMs: MINUTE },
  market:     { limit: 60,  windowMs: MINUTE },
  history:    { limit: 240, windowMs: MINUTE },
  brandLogo:  { limit: 60,  windowMs: MINUTE },
  cspReport:  { limit: 30,  windowMs: MINUTE },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitBucket = keyof typeof RATE_LIMITS

const limiters = new Map<RateLimitBucket, SlidingWindowLimiter>()

function limiterFor(bucket: RateLimitBucket): SlidingWindowLimiter {
  let l = limiters.get(bucket)
  if (!l) {
    l = new SlidingWindowLimiter(RATE_LIMITS[bucket])
    limiters.set(bucket, l)
  }
  return l
}

/** proxy.ts'in getUser() sonrası iletim isteğine yazdığı kullanıcı kimliği
 *  başlığı. proxy, istemciden gelen aynı adlı başlığı HER ZAMAN siler — yani
 *  rotada görülen değer yalnız proxy'den gelebilir. */
export const USER_ID_HEADER = 'x-ft-uid'

/** Sınır anahtarı: oturum varsa kullanıcı, yoksa (AUTH_BYPASS, oturumsuz CSP
 *  raporu) istemci IP'si. X-Forwarded-For'un İLK değeri Vercel'de platform
 *  tarafından yazılır; başka bir barındırmada sahte olabilir — o durumda
 *  anahtar uzayı BoundedCache ile yine tavanlıdır. */
export function clientKey(headers: Headers): string {
  const uid = headers.get(USER_ID_HEADER)
  if (uid) return `u:${uid}`
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = fwd || headers.get('x-real-ip')?.trim() || 'unknown'
  return `ip:${ip.slice(0, 64)}`
}

/** Rotanın başında çağrılır: sınır aşıldıysa hazır 429 yanıtı, değilse null.
 *  `if (limited) return limited` */
export function rateLimit(request: Request, bucket: RateLimitBucket): NextResponse | null {
  const res = limiterFor(bucket).hit(clientKey(request.headers))
  if (res.ok) return null
  return NextResponse.json(
    { error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(res.retryAfterSec),
        'Cache-Control': 'no-store',
      },
    },
  )
}
