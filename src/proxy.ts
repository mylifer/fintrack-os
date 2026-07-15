import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register']

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

// Build the nonce-based CSP for this request. Shipped as
// Content-Security-Policy-Report-Only (see below) so it can never break the
// running app — flipping to enforce is a one-line header-name change.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const supa = supabaseOrigin()

  const directives = [
    `default-src 'self'`,
    // The inline theme script (layout.tsx) and Next.js framework scripts carry
    // this nonce. vitals.vercel-insights.com is the @vercel/speed-insights
    // loader. NOTE for flip-to-enforce: speed-insights also injects a small
    // INLINE bootstrap script that has no nonce; when enforcing, either add
    // 'strict-dynamic' (so nonce'd loaders can spawn it) or a hash for it.
    // 'unsafe-eval' is only added in dev because React uses eval() for enhanced
    // error stacks; it is not needed (and not added) in production.
    `script-src 'self' 'nonce-${nonce}' https://vitals.vercel-insights.com${isDev ? " 'unsafe-eval'" : ''}`,
    // 'unsafe-inline' is required for Tailwind / inline style attributes.
    // NOTE for flip-to-enforce: this is the weak point of the policy — styles
    // are not nonce-guarded. Kept as-is because a nonce'd style-src would break
    // Tailwind's inline styles.
    `style-src 'self' 'unsafe-inline'`,
    // data:/blob: for generated images; api.iconify.design for online icons.
    `img-src 'self' data: blob: https://api.iconify.design`,
    // Browser calls: same-origin API, Supabase (direct), speed-insights vitals,
    // and Iconify's icon API. The price CDNs are server-side only, so they are
    // intentionally NOT listed here.
    `connect-src 'self'${supa ? ` ${supa}` : ''} https://vitals.vercel-insights.com https://api.iconify.design`,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
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
  //    report-only response header below is. Cloning from `request` at call
  //    time preserves any cookies Supabase refreshes in setAll().
  const withNonceHeaders = (req: NextRequest) => {
    const h = new Headers(req.headers)
    h.set('x-nonce', nonce)
    h.set('Content-Security-Policy', csp)
    return h
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

  const { pathname } = request.nextUrl

  // Attach the report-only CSP to any response leaving the proxy. Report-only
  // (Content-Security-Policy-Report-Only) is a deliberate safe rollout: the
  // browser evaluates + reports violations but enforces nothing. To ENFORCE,
  // change the header name to 'Content-Security-Policy' (one line).
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set('Content-Security-Policy-Report-Only', csp)
    return res
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    if (user) return withCsp(NextResponse.redirect(new URL('/dashboard', request.url)))
    return withCsp(response)
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
    return withCsp(NextResponse.redirect(new URL('/login', request.url)))
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
