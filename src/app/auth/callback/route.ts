import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

/* ── E-posta bağlantılarının dönüş noktası ────────────────────────────────────
   Supabase'in gönderdiği kayıt doğrulama, şifre sıfırlama ve e-posta değişikliği
   bağlantıları buraya döner. İki biçim desteklenir:

     ?code=…                   PKCE (varsayılan e-posta şablonları). Kod ancak
                               isteğin yapıldığı tarayıcıda çözülebilir: kod
                               doğrulayıcısı o tarayıcının çerezinde durur.
     ?token_hash=…&type=…      Şablonda {{ .TokenHash }} kullanılırsa — cihazdan
                               bağımsız çalışır.

   Oturum çerezleri yönlendirme yanıtına yazılır. Şifre sıfırlama akışı
   `next` verilmese bile /reset-password'e gider (redirectType === 'recovery'):
   Supabase izinli listede olmayan bir yönlendirmeyi Site URL'e düşürdüğünde
   `next` kaybolur, proxy kodu buraya taşır ve akış yine doğru sayfada biter. */

/** Açık yönlendirmeyi engeller: yalnızca aynı origin'de, / ile başlayan yol. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard'
  return raw
}

export async function GET(request: NextRequest) {
  const params    = request.nextUrl.searchParams
  const code      = params.get('code')
  const tokenHash = params.get('token_hash')
  const type      = params.get('type') as EmailOtpType | null
  let next        = safeNext(params.get('next'))

  const pending: { name: string; value: string; options: CookieOptions }[] = []
  const pendingHeaders: Record<string, string> = {}

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          pending.push(...cookiesToSet)
          Object.assign(pendingHeaders, headers)
        },
      },
    },
  )

  let ok = false
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    ok = !error
    // auth-js yanıta redirectType'ı ekliyor (resetPasswordForEmail'in çerezdeki
    // kod doğrulayıcısına yazdığı 'recovery') ama tip tanımında yok.
    const redirectType = (data as { redirectType?: string | null }).redirectType
    if (ok && redirectType === 'recovery') next = '/reset-password'
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    ok = !error
    if (ok && type === 'recovery') next = '/reset-password'
  }

  const res = NextResponse.redirect(new URL(ok ? next : '/login?error=link', request.url))
  for (const { name, value, options } of pending) res.cookies.set(name, value, options)
  for (const [key, value] of Object.entries(pendingHeaders)) res.headers.set(key, value)
  return res
}
