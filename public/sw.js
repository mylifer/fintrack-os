/*
 * FinTrack OS service worker — çevrimdışı uygulama kabuğu.
 *
 * TASARIM SINIRLARI (veri güvenliği için bilinçli):
 *  - Yalnızca SAME-ORIGIN GET istekleri ele alınır. Supabase (cross-origin) ve
 *    /api/* istekleri ASLA yakalanmaz/önbelleklenmez — sync motoru ve canlı
 *    fiyat uçları her zaman doğrudan ağa gider.
 *  - Kullanıcı verisi IndexedDB'de yaşar; bu SW sadece HTML/JS/CSS kabuğunu
 *    önbellekler. Veriye dokunmaz.
 *  - Redirect'ler ve hatalı yanıtlar önbelleğe alınmaz (login yönlendirmesi
 *    kabuk olarak saklanmasın diye).
 */

const VERSION = 'v1'
const SHELL_CACHE = `ft-shell-${VERSION}`
const STATIC_CACHE = `ft-static-${VERSION}`
const STATIC_LIMIT = 80 // basit büyüme sınırı (LRU yaklaşığı: en eskiler silinir)

const OFFLINE_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Çevrimdışı — FinTrack OS</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;text-align:center;padding:24px}
p{color:#a1a1aa;max-width:36ch;line-height:1.6}</style></head><body><div>
<h1>Çevrimdışısınız</h1><p>İnternet bağlantısı yok ve bu sayfa daha önce önbelleğe alınmamış.
Bağlantı gelince sayfayı yenileyin — verileriniz cihazınızda güvende.</p>
</div></body></html>`

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Eski sürüm cache'lerini temizle
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('ft-') && k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

function isCacheable(response) {
  // Sadece temiz, aynı-origin, yönlendirmesiz 200 yanıtları sakla
  return response && response.ok && response.type === 'basic' && !response.redirected
}

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= limit) return
  // Cache API ekleme sıralı döner; baştakiler en eski
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)))
}

// Gezinmeler: önce ağ, düşerse aynı URL'nin son iyi kopyası, o da yoksa offline sayfası
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (isCacheable(response)) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true })
    if (cached) return cached
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

// Hash'li Next chunk'ları değişmez → önce cache
async function handleImmutable(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (isCacheable(response)) {
    cache.put(request, response.clone())
    trimCache(STATIC_CACHE, STATIC_LIMIT)
  }
  return response
}

// Diğer statikler (ikon, font, resim): cache'den ver, arkada tazele
async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(request, response.clone())
        trimCache(STATIC_CACHE, STATIC_LIMIT)
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // Supabase, vitals vb. — dokunma
  if (url.pathname.startsWith('/api/')) return // canlı fiyat/geçmiş uçları — dokunma
  if (url.pathname === '/sw.js') return // SW kendini önbelleklemesin

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(handleImmutable(request))
    return
  }

  if (/\.(?:png|svg|jpg|jpeg|gif|webp|ico|woff2?)$/.test(url.pathname) || request.destination === 'font' || request.destination === 'image') {
    event.respondWith(handleStatic(request))
    return
  }
  // Geri kalan her şey (JS chunk dışı, webmanifest, vs.) doğrudan ağa
})
