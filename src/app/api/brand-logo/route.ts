import { NextResponse, type NextRequest } from 'next/server'
import { BoundedCache } from '@/lib/server/bounded-cache'

export const dynamic = 'force-dynamic'

const MAX_NAME_LEN = 64
const FETCH_TIMEOUT_MS = 5000

// İsim → domain çözümü nadiren değişir; bulunamayan isimler de cache'lenir ki
// her sayfa yüklemesinde dış servislere tekrar sorulmasın (instance ömrü yeter).
//
// Boyut TAVANI şart: anahtar, istek sahibinin gönderdiği serbest metin
// (64 karaktere kadar). Sınırsız bir Map'te benzersiz isimler göndererek
// instance belleğini şişirmek mümkündü; TTL bunu çözmez çünkü süresi dolan
// girdi yalnızca okunurken göz ardı edilir, yerinde durur.
// (Güvenlik denetimi 2026-08-29, bulgu F5.)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 2000
const cache = new BoundedCache<{ at: number; domain: string | null }>(MAX_CACHE_ENTRIES)

// Birebir eşleşme karşılaştırması: Türkçe'ye duyarlı küçük harf + boşluk normalize.
function normalize(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        // Wikimedia API etiketi: tanımlayıcı bir UA ister
        'user-agent': 'fintrack-os/1.0 (personal finance app; brand logo lookup)',
      },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Clearbit autocomplete: isim → şirket önerileri. Anahtar gerektirmez.
// Yalnızca adı sorguyla BİREBİR eşleşen ilk önerinin domain'i kabul edilir.
async function fromClearbit(name: string): Promise<string | null> {
  const data = await fetchJson(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`,
  )
  if (!Array.isArray(data)) return null
  const target = normalize(name)
  for (const c of data as { name?: unknown; domain?: unknown }[]) {
    if (
      typeof c?.name === 'string' && normalize(c.name) === target &&
      typeof c?.domain === 'string' && c.domain
    ) return c.domain
  }
  return null
}

// Wikidata yedeği: etiketi birebir eşleşen varlıkların resmi web sitesi (P856).
// Türkçe markalar (ör. yerel zincirler) Clearbit'te olmayabilir; tr önce denenir.
async function fromWikidata(name: string): Promise<string | null> {
  const target = normalize(name)
  for (const lang of ['tr', 'en']) {
    const data = (await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json&type=item&limit=7`,
    )) as { search?: { id?: string; label?: string; match?: { text?: string } }[] } | null
    const exact = (data?.search ?? []).filter(e =>
      e.id && (normalize(e.label ?? '') === target || normalize(e.match?.text ?? '') === target),
    )
    for (const e of exact.slice(0, 3)) {
      const ent = (await fetchJson(
        `https://www.wikidata.org/wiki/Special:EntityData/${e.id}.json`,
      )) as {
        entities?: Record<string, { claims?: { P856?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }>
      } | null
      const site = ent?.entities?.[e.id!]?.claims?.P856?.[0]?.mainsnak?.datavalue?.value
      if (typeof site === 'string') {
        try { return new URL(site).hostname } catch { /* geçersiz P856 — sıradakine geç */ }
      }
    }
  }
  return null
}

async function resolveDomain(name: string): Promise<string | null> {
  const key = normalize(name)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.domain
  const domain = (await fromClearbit(name)) ?? (await fromWikidata(name))
  cache.set(key, { at: Date.now(), domain })
  return domain
}

// GET /api/brand-logo?name=Migros → { domain: "migros.ch" } | { domain: null }
// Yalnızca birebir isim eşleşmesi kabul edilir; benzer/kısmi eşleşme dönmez.
export async function GET(request: NextRequest) {
  const name = (request.nextUrl.searchParams.get('name') ?? '').trim()
  if (name.length < 2 || name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: 'Geçersiz isim' }, { status: 400 })
  }

  const domain = await resolveDomain(name)
  return NextResponse.json(
    { domain },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
