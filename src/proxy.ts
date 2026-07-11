import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/register']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.includes(pathname)) {
    if (user) return NextResponse.redirect(new URL('/dashboard', request.url))
    return response
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
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
