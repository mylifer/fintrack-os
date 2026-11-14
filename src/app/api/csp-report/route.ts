import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/* ── CSP ihlal raporu toplayıcısı (güvenlik denetimi H1) ─────────────────────
   proxy.ts'teki politika `report-uri /api/csp-report` ve `report-to
   csp-endpoint` (Reporting-Endpoints başlığı) ile buraya raporlar. İki biçim:
   - report-uri:  application/csp-report  → { "csp-report": { ... } }
   - report-to:   application/reports+json → [{ type: "csp-violation", body: { ... } }]

   Yalnız SUNUCU GÜNLÜĞÜNE yazılır (Vercel → Logs); dış servis, veritabanı yok.
   Oturum gerektirmez (proxy bu yolu auth'tan muaf tutar), bu yüzden:
   - gövde MAX_BODY_BYTES ile sınırlı (Content-Length'e güvenilmez, akış sayılır),
   - istek sınırı (kullanıcı ya da IP başına, lib/server/rate-limit),
   - günlüğe yalnız bilinen alanlar, kısaltılarak yazılır; URL'lerin sorgu
     dizesi atılır (arama terimi / token taşıyabilir). */

const MAX_BODY_BYTES = 16 * 1024
const MAX_REPORTS = 10
const MAX_FIELD = 300

// Raporlar gövdesiz 204 ile yanıtlanır; tarayıcı yanıtı okumaz.
const noContent = () => new NextResponse(null, { status: 204 })

async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { buf.set(c, off); off += c.byteLength }
  return new TextDecoder().decode(buf)
}

function clip(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  return String(v).slice(0, MAX_FIELD)
}

/** URL'den sorgu dizesi ve hash'i atar; URL değilse ('inline', 'eval') olduğu gibi. */
function stripUrl(v: unknown): string | undefined {
  const s = clip(v)
  if (!s) return s
  try {
    const u = new URL(s)
    return `${u.origin}${u.pathname}`.slice(0, MAX_FIELD)
  } catch {
    return s
  }
}

interface Violation {
  document?: string
  directive?: string
  blocked?: string
  source?: string
  line?: string
  sample?: string
  disposition?: string
}

/** İki rapor biçimini de tek, kısaltılmış biçime çevirir. */
function normalizeReports(payload: unknown): Violation[] {
  const out: Violation[] = []
  const push = (b: Record<string, unknown> | undefined) => {
    if (!b || typeof b !== 'object') return
    out.push({
      document:    stripUrl(b['document-uri'] ?? b.documentURL),
      directive:   clip(b['effective-directive'] ?? b.effectiveDirective ?? b['violated-directive']),
      blocked:     stripUrl(b['blocked-uri'] ?? b.blockedURL),
      source:      stripUrl(b['source-file'] ?? b.sourceFile),
      line:        clip(b['line-number'] ?? b.lineNumber),
      sample:      clip(b['script-sample'] ?? b.sample),
      disposition: clip(b.disposition),
    })
  }
  if (Array.isArray(payload)) {
    for (const r of payload.slice(0, MAX_REPORTS)) {
      const rec = r as { type?: unknown; body?: Record<string, unknown> }
      if (rec?.type === 'csp-violation') push(rec.body)
    }
  } else if (payload && typeof payload === 'object') {
    push((payload as Record<string, Record<string, unknown>>)['csp-report'])
  }
  return out
}

export async function POST(request: Request) {
  const limited = rateLimit(request, 'cspReport')
  // Aşımda da 204: tarayıcı yeniden denemez, saldırgana sinyal verilmez.
  if (limited) return noContent()

  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!/application\/(csp-report|reports\+json|json)/.test(type)) return noContent()

  const text = await readCapped(request)
  if (!text) return noContent()

  let payload: unknown
  try { payload = JSON.parse(text) } catch { return noContent() }

  for (const v of normalizeReports(payload)) {
    console.warn('[csp-violation]', JSON.stringify(v))
  }
  return noContent()
}
