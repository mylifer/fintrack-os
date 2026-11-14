'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

/* Ayarlar > Hata kayıtları ──────────────────────────────────────────────────
   Üretimde yakalanan hatalar public.error_logs'a yazılır (lib/error-reporter,
   migration 0020). Bu kart kullanıcının KENDİ son 30 günlük kayıtlarını
   okur — migration 0027'deki sahip-yalnız SELECT politikasıyla. Aynı mesaj
   tek satırda toplanır (adet, son görülme, sayfalar).

   Okuma hiçbir durumda hata fırlatmaz: oturum yok (girişsiz kip), çevrimdışı
   ya da 0027 henüz uygulanmamış (izin hatası) → sessizce "okunamadı". */

const DAYS = 30
const FETCH_LIMIT = 500
const MAX_GROUPS = 20
const MAX_PATHS = 3

export interface ErrorLogRow {
  created_at: string
  message: string
  path: string | null
}

export interface ErrorLogGroup {
  message: string
  count: number
  lastAt: string
  paths: string[]
}

/** Aynı mesajları gruplar; en son görülen önce. Girdi sırasından bağımsız. */
export function groupErrorLogs(rows: readonly ErrorLogRow[]): ErrorLogGroup[] {
  const map = new Map<string, ErrorLogGroup>()
  for (const r of rows) {
    const key = r.message.trim()
    let g = map.get(key)
    if (!g) {
      g = { message: key, count: 0, lastAt: r.created_at, paths: [] }
      map.set(key, g)
    }
    g.count++
    if (r.created_at > g.lastAt) g.lastAt = r.created_at
    if (r.path && !g.paths.includes(r.path) && g.paths.length < MAX_PATHS) g.paths.push(r.path)
  }
  return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
}

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; groups: ErrorLogGroup[]; total: number }

async function loadGroups(): Promise<State> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'unavailable' }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { status: 'unavailable' }
    const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
    const { data, error } = await supabase
      .from('error_logs')
      .select('created_at, message, path')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT)
    if (error || !Array.isArray(data)) return { status: 'unavailable' }
    const rows = data as ErrorLogRow[]
    return { status: 'ready', groups: groupErrorLogs(rows), total: rows.length }
  } catch {
    return { status: 'unavailable' }
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ErrorLogsCard() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    void loadGroups().then(s => { if (alive) setState(s) })
    return () => { alive = false }
  }, [])

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">Hata Kayıtları</div>
        <div className="text-xs text-muted-foreground mb-3">
          Son {DAYS} günde bu hesapta yakalanan uygulama hataları. Kayıtlar {DAYS} gün sonra kendiliğinden silinir.
        </div>

        {state.status === 'loading' && (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        )}
        {state.status === 'unavailable' && (
          <div className="text-sm text-muted-foreground">Kayıt okunamadı.</div>
        )}
        {state.status === 'ready' && state.groups.length === 0 && (
          <div className="text-sm text-muted-foreground">Son {DAYS} günde hata kaydı yok.</div>
        )}
        {state.status === 'ready' && state.groups.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {state.groups.slice(0, MAX_GROUPS).map(g => (
              <li key={g.message} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm break-words min-w-0">{g.message}</span>
                  {g.count > 1 && (
                    <span className="flex-shrink-0 text-xs tabular-nums rounded-md bg-muted px-1.5 py-0.5">×{g.count}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatWhen(g.lastAt)}{g.paths.length > 0 && <> · {g.paths.join(', ')}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {state.status === 'ready' && state.groups.length > MAX_GROUPS && (
          <div className="text-xs text-muted-foreground mt-2">
            +{state.groups.length - MAX_GROUPS} farklı hata daha (toplam {state.total} kayıt)
          </div>
        )}
      </CardContent>
    </Card>
  )
}
