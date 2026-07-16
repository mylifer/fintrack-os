// İstemci tarafı marka logosu çözümleyici. /api/brand-logo'ya sorar ve sonucu
// (bulunamayanlar dahil) localStorage'da saklar — böylece çözülemeyen isimler
// her oturumda dış servisleri tekrar yoklamaz. Başarılı sonuçlar zaten
// person.url'e kalıcı yazıldığı için buradaki cache esas olarak negatif
// sonuçları susturur.

const LS_KEY = 'fintrack.brandDomain.v1'
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000

type CacheEntry = { at: number; domain: string | null }

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeCache(entries: Record<string, CacheEntry>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries))
  } catch { /* dolu/kapalı storage — cache'siz devam */ }
}

/** İsim için internetten birebir marka eşleşmesi arar; domain veya null döner. */
export async function resolveBrandDomain(name: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const key = normalize(name)
  if (key.length < 2) return null

  const entries = readCache()
  const hit = entries[key]
  if (hit) {
    if (hit.domain) return hit.domain
    if (Date.now() - hit.at < NEGATIVE_TTL_MS) return null
  }

  try {
    const res = await fetch(`/api/brand-logo?name=${encodeURIComponent(name)}`)
    if (!res.ok) return null
    const { domain } = (await res.json()) as { domain: string | null }
    entries[key] = { at: Date.now(), domain }
    writeCache(entries)
    return domain
  } catch {
    return null
  }
}
