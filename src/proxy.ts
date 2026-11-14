import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { USER_ID_HEADER } from '@/lib/server/rate-limit'

// Oturumsuz erişilir; oturumu tam (gerekiyorsa aal2) olan kullanıcı buradan
// /dashboard'a yönlendirilir.
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password']
// E-posta bağlantısı akışları: oturumlu da oturumsuz da DOKUNULMADAN geçer.
// /reset-password kurtarma oturumunu ve iki adımlı doğrulamayı kendisi yönetir.
const AUTH_FLOW_PATHS = ['/auth/callback', '/reset-password']

/** Erişim token'ındaki doğrulama seviyesi ('aal1' | 'aal2'). Token'ın kendisi
 *  aynı istekte getUser() ile sunucuda doğrulandığı için yalnızca decode
 *  edilir. Okunamazsa undefined — çağıran bunu aal2 DEĞİL sayar (fail-closed). */
function tokenAal(accessToken: string | undefined): string | undefined {
  try {
    const payload = accessToken?.split('.')[1]
    if (!payload) return undefined
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { aal?: string }).aal
  } catch {
    return undefined
  }
}

// Origin of the Supabase project the browser talks to directly
// (createBrowserClient). Derived at request time from the public env var so we
// never hardcode the project ref. Falls back to just 'self' if unset/invalid.
function supabaseOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin
  } catch {
    return ''
  }
}

// İhlal raporlarının düştüğü aynı-origin uç (src/app/api/csp-report). Oturum
// GEREKTİRMEZ: /login gibi oturumsuz sayfalardaki ihlaller de raporlanmalı,
// Reporting API ise raporu çerezsiz gönderebilir.
const CSP_REPORT_PATH = '/api/csp-report'

// Build the nonce-based CSP for this request. ENFORCED (Content-Security-Policy)
// since 2026-11 — güvenlik denetimi H1/F6. Her yönerge Playwright'ta üretim
// derlemesiyle sınandı (dashboard, transactions, investments, reports,
// settings, ekstre-yukle, categories + PDF/OCR worker'ları + service worker).
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const supa = supabaseOrigin()

  const directives = [
    `default-src 'self'`,
    // Nonce + 'strict-dynamic': Next.js framework/sayfa script'leri ve tema
    // script'i (layout.tsx) proxy'nin nonce'unu taşır; 'strict-dynamic' bu
    // güvenilir script'lerin DOM API'siyle eklediği script'lere güveni aktarır
    // — @vercel/speed-insights loader'ı (<script src> createElement ile, nonce'suz)
    // ve Turbopack'in dinamik chunk yüklemeleri bu yolla çalışır. CSP3
    // tarayıcıları 'strict-dynamic' varken 'self' ve host listesini YOK SAYAR;
    // onlar yalnız CSP2 tarayıcılar için geri dönüş. Parser'ın eklediği
    // (HTML'e enjekte edilmiş) nonce'suz script her durumda engellenir.
    // 'unsafe-eval' is only added in dev because React uses eval() for enhanced
    // error stacks; it is not needed (and not added) in production.
    // 'wasm-unsafe-eval': YALNIZ WebAssembly derlemesine izin verir (JS eval'e
    // değil). Tesseract OCR worker'ı (/ocr/worker.min.js) bu politikayı kendi
    // yanıt başlığından alır ve çekirdeği wasm olarak derler; yoksa ekran
    // görüntüsü okuma "WebAssembly.instantiate ... violates CSP" ile düşer
    // (Playwright'ta doğrulandı).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https://vitals.vercel-insights.com${isDev ? " 'unsafe-eval'" : ''}`,
    // 'unsafe-inline' is required for Tailwind / inline style attributes (React
    // style={{}} ve Radix'in konumlama stilleri). Bilinçli ödünç: stiller nonce
    // korumasında değil; script ve bağlantı yönergeleri sıkı kaldığı sürece
    // stil enjeksiyonu veri sızdıramaz (connect-src/img-src dar).
    `style-src 'self' 'unsafe-inline'`,
    // data:/blob: for generated images; api.iconify.design for online icons;
    // www.google.com/s2/favicons for brand logos — Google bu adresi
    // tN.gstatic.com/faviconV2'ye YÖNLENDİRİR ve CSP yönlendirme hedefini de
    // denetler, bu yüzden *.gstatic.com şart. Kullanıcının hesap ikonu olarak
    // yapıştırdığı başka bir alan adındaki URL bilinçli olarak ENGELLENİR
    // (denetim F6: yedek dosyasıyla dış beacon yükletme).
    `img-src 'self' data: blob: https://api.iconify.design https://www.google.com https://*.gstatic.com`,
    // Browser calls: same-origin API, Supabase (direct), speed-insights vitals,
    // and Iconify's icon API. The price CDNs are server-side only, so they are
    // intentionally NOT listed here — EXCEPT truncgil: the Kapalıçarşı gold quote
    // is fetched from the browser because the server reaches it only
    // intermittently (see lib/turkish-gold.ts).
    // wss: Supabase Realtime (canlı senkron, sync/realtime.ts) aynı host'a WebSocket açar.
    `connect-src 'self'${supa ? ` ${supa} ${supa.replace(/^https:/, 'wss:')}` : ''} https://vitals.vercel-insights.com https://api.iconify.design https://finans.truncgil.com`,
    // Worker'lar: pdf.js (/_next/static/... .mjs), tesseract (/ocr/worker.min.js,
    // workerBlobURL:false) ve service worker (/sw.js) hepsi aynı origin'den.
    // Açıkça yazılır: yoksa script-src'a düşer ve 'strict-dynamic' altında
    // 'self' yok sayıldığı için worker'lar engellenir.
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    // report-to (Reporting API) destekleyen tarayıcıda report-uri yok sayılır;
    // report-uri Firefox/Safari için.
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to csp-endpoint`,
  ]

  return directives.join('; ')
}

export async function proxy(request: NextRequest) {
  // Fresh, unpredictable per-request nonce (Web Crypto, available in both the
  // Node.js and Edge runtimes). base64 keeps it header-safe.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  // Propagate the nonce to the app on the REQUEST headers:
  //  - `x-nonce` is read by layout.tsx via next/headers headers().
  //  - the internal `Content-Security-Policy` request header lets Next.js parse
  //    the `'nonce-...'` value and auto-apply it to framework scripts / <Script
  //    nonce>. This request header is NOT sent to the browser; only the
  //    enforced response header (withCsp below) is. Cloning from `request` at call
  //    time preserves any cookies Supabase refreshes in setAll().
  //  - USER_ID_HEADER: getUser() ile doğrulanmış kullanıcı kimliği; /api/*
  //    istek sınırlayıcısı (lib/server/rate-limit) anahtar olarak kullanır.
  //    İstemciden gelen aynı adlı başlık HER ZAMAN silinir — rota yalnız
  //    proxy'nin yazdığı değeri görür.
  let uid: string | null = null
  const withNonceHeaders = (req: NextRequest) => {
    const h = new Headers(req.headers)
    h.set('x-nonce', nonce)
    h.set('Content-Security-Policy', csp)
    h.delete(USER_ID_HEADER)
    if (uid) h.set(USER_ID_HEADER, uid)
    return h
  }

  // CSP ihlal raporu: oturum ve Supabase çağrısı gerektirmez (oturumsuz
  // sayfaların raporları da gelmeli). Rota kendi boyut + istek sınırını uygular.
  if (request.nextUrl.pathname === CSP_REPORT_PATH) {
    return NextResponse.next({ request: { headers: withNonceHeaders(request) } })
  }

  let response = NextResponse.next({ request: { headers: withNonceHeaders(request) } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: withNonceHeaders(request) } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // Kimlik artık biliniyor: iletim isteğini kullanıcı başlığıyla yeniden kur,
    // setAll()'ın yanıta yazdığı yenilenmiş oturum çerezlerini taşı.
    uid = user.id
    const prev = response
    response = NextResponse.next({ request: { headers: withNonceHeaders(request) } })
    prev.cookies.getAll().forEach(c => response.cookies.set(c))
  }

  const { pathname } = request.nextUrl

  // Attach the ENFORCED CSP to any response leaving the proxy, plus the
  // Reporting API endpoint that the policy's `report-to csp-endpoint` names.
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy', csp)
    res.headers.set('Reporting-Endpoints', `csp-endpoint="${CSP_REPORT_PATH}"`)
    return res
  }

  // Supabase izinli listede olmayan bir e-posta yönlendirmesini Site URL'e
  // (kök) düşürür: kodu kaybetmeden dönüş noktasına taşı.
  if (pathname === '/' && (request.nextUrl.searchParams.has('code') || request.nextUrl.searchParams.has('token_hash'))) {
    const callback = new URL('/auth/callback', request.url)
    callback.search = request.nextUrl.search
    return withCsp(NextResponse.redirect(callback))
  }

  if (AUTH_FLOW_PATHS.includes(pathname)) return withCsp(response)

  // İki adımlı doğrulama açık ama oturum henüz aal1 (şifre girilmiş, kod
  // girilmemiş): uygulamaya ve API'ye giriş yok, yalnızca /login'deki kod
  // adımı. Asıl kilit RLS'te (0013) — bu, arayüzü o kilide çarptırmamak için.
  const hasVerifiedFactor = !!user?.factors?.some(f => f.status === 'verified')
  let mfaPending = false
  if (hasVerifiedFactor) {
    const { data: { session } } = await supabase.auth.getSession()
    mfaPending = tokenAal(session?.access_token) !== 'aal2'
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    if (user && !mfaPending) return withCsp(NextResponse.redirect(new URL('/dashboard', request.url)))
    return withCsp(response)
  }

  if (mfaPending) {
    if (pathname.startsWith('/api')) {
      return withCsp(NextResponse.json({ error: 'mfa_required' }, { status: 401 }))
    }
    return withCsp(NextResponse.redirect(new URL('/login', request.url)))
  }

  // Auth bypass yalnızca AÇIK opt-in ile ve asla production'da çalışmaz.
  // NODE_ENV'e bağlamıyoruz: NODE_ENV=development ile deploy edilen bir
  // preview/staging ortamı auth'u sessizce devre dışı bırakmasın diye,
  // ayrı bir AUTH_BYPASS=1 bayrağı şart (production'da yok sayılır).
  const authBypass =
    process.env.NODE_ENV !== 'production' && process.env.AUTH_BYPASS === '1'

  if (!user && !authBypass) {
    // API istekleri HTML login sayfasına yönlendirilmez; fetch çağrıları
    // 200+HTML yerine net bir 401 görmeli
    if (pathname.startsWith('/api')) {
      return withCsp(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
    }
    // Davet bağlantısı girişsiz açıldıysa giriş sonrası oraya dönülür
    // (login yalnız /davet/<token> biçimini kabul eder — açık yönlendirme yok)
    const login = new URL('/login', request.url)
    if (pathname.startsWith('/davet/')) login.searchParams.set('next', pathname)
    return withCsp(NextResponse.redirect(login))
  }

  return withCsp(response)
}

export const config = {
  matcher: [
    // sw.js ve manifest.webmanifest auth DIŞINDA: tarayıcı manifest'i cookie'siz
    // çeker, SW güncelleme kontrolü de oturum süresinden bağımsız çalışmalı.
    // İkisi de statik/duyarsız içerik — auth gerektirmez.
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
