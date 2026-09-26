import { supabase } from '@/lib/supabase'

/* ── İstemci hata kaydı (migration 0020, ücretsiz Sentry yerine) ────────────
   Yakalanmamış hatalar (window 'error' / 'unhandledrejection') ve hata
   sınırına düşen render hataları public.error_logs'a yazılır; kayıtlar
   Supabase panelinden okunur.

   Sınırlar: yalnız üretimde, oturum varken ve çevrimiçiyken; sayfa oturumu
   başına en çok MAX_PER_SESSION kayıt ve aynı hata bir kez. Gönderilenler:
   mesaj, yığın, sayfa YOLU (sorgu dizesi ve hash yok — arama terimleri
   taşıyabilir), sürüm, tarayıcı. Raporlama kendisi asla hata fırlatmaz. */

type Kind = 'error' | 'unhandledrejection' | 'boundary'

const MAX_PER_SESSION = 10
const sent = new Set<string>()
let installed = false

export interface ErrorReport {
  kind: Kind
  message: string
  stack: string | null
  path: string
  user_agent: string
  release: string
}

/** Tarayıcı olayından kayıt satırı; gönderilmeyecekse null (saf, testli). */
export function buildReport(kind: Kind, reason: unknown, env: { path: string; userAgent: string; release: string }): ErrorReport | null {
  const err = reason instanceof Error ? reason : null
  const message = (err?.message ?? (typeof reason === 'string' ? reason : safeString(reason))).trim()
  if (!message) return null
  // Tarayıcı eklentileri ve kaynak yükleme gürültüsü: uygulamanın hatası değil
  if (/ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:/i.test(message)) return null
  return {
    kind,
    message: message.slice(0, 2000),
    stack: err?.stack ? err.stack.slice(0, 8000) : null,
    path: env.path.split(/[?#]/)[0].slice(0, 300),
    user_agent: env.userAgent.slice(0, 400),
    release: env.release.slice(0, 64),
  }
}

function safeString(v: unknown): string {
  try { return typeof v === 'object' ? JSON.stringify(v)?.slice(0, 500) ?? '' : String(v) } catch { return '' }
}

export async function reportError(kind: Kind, reason: unknown): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined') return
    if (sent.size >= MAX_PER_SESSION || !navigator.onLine) return
    const report = buildReport(kind, reason, {
      path: window.location.pathname,
      userAgent: navigator.userAgent,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    })
    if (!report) return
    const key = `${report.kind}|${report.message}|${report.stack?.split('\n')[1] ?? ''}`
    if (sent.has(key)) return
    sent.add(key)
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    await supabase.from('error_logs').insert(report)
  } catch {
    /* raporlama asla uygulamayı etkilemez */
  }
}

/** Uygulama kabuğunda bir kez çağrılır. */
export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', e => { void reportError('error', e.error ?? e.message) })
  window.addEventListener('unhandledrejection', e => { void reportError('unhandledrejection', e.reason) })
}
