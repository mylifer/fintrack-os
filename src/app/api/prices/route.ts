import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrencyRates {
  usdTry: number
  eurTry: number
  gbpTry: number
}

// ── TCMB ─────────────────────────────────────────────────────────────────────
// Official Turkish Central Bank rates — updates on business days (morning + intraday)
// URL format: /kurlar/YYYYMM/DD.xml  |  /kurlar/today.xml (alias for current business day)

function tcmbUrl(offsetDays: number): string {
  if (offsetDays === 0) return 'https://www.tcmb.gov.tr/kurlar/today.xml'
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dy = String(d.getUTCDate()).padStart(2, '0')
  return `https://www.tcmb.gov.tr/kurlar/${y}${mo}/${dy}.xml`
}

function parseTCMBXml(xml: string): CurrencyRates | null {
  const block = (code: string): string => {
    const m = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)</Currency>`))
    return m?.[1] ?? ''
  }
  const num = (b: string, tag: string): number | null => {
    const m = b.match(new RegExp(`<${tag}>([\\d.]+)</${tag}>`))
    return m ? parseFloat(m[1]) : null
  }
  const rate = (code: string): number | null => {
    const b = block(code)
    return num(b, 'ForexSelling') ?? num(b, 'BanknoteSelling')
  }

  const usdTry = rate('USD')
  const eurTry = rate('EUR')
  const gbpTry = rate('GBP')
  if (!usdTry || !eurTry || !gbpTry) return null
  return { usdTry, eurTry, gbpTry }
}

async function fetchTCMB(offsetDays: number): Promise<CurrencyRates | null> {
  try {
    const res = await fetch(tcmbUrl(offsetDays), { cache: 'no-store' })
    if (!res.ok) return null
    return parseTCMBXml(await res.text())
  } catch { return null }
}

// Walk back up to 5 days to skip weekends / holidays
async function latestTCMB(from = 0): Promise<CurrencyRates | null> {
  for (let i = from; i < from + 5; i++) {
    const r = await fetchTCMB(i)
    if (r) return r
  }
  return null
}

// ── Gold ──────────────────────────────────────────────────────────────────────
// Primary:  goldapi.io XAU/USD × TCMB USD/TRY  (real-time; requires GOLDAPI_KEY env var)
// Fallback: fawazahmed0 XAU/USD × TCMB USD/TRY (daily snapshot; no key needed)

function isoDate(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offsetDays)
  return d.toISOString().split('T')[0]
}

async function goldFromFawazahmed(dateTag: string, usdTry: number): Promise<number | null> {
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateTag}/v1/currencies/usd.min.json`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const d = await res.json()
    const xauPerUsd: number | undefined = d?.usd?.xau
    if (!xauPerUsd) return null
    // xauPerUsd = XAU per 1 USD  →  gram price in TRY = usdTry / (xauPerUsd × 31.1035 g/oz)
    return usdTry / (xauPerUsd * 31.1035)
  } catch { return null }
}

async function fetchCurrentGold(usdTry: number): Promise<number | null> {
  const key = process.env.GOLDAPI_KEY
  if (key) {
    try {
      const res = await fetch('https://www.goldapi.io/api/XAU/USD', {
        headers: { 'x-access-token': key },
        cache: 'no-store',
      })
      if (res.ok) {
        const d = await res.json()
        if (typeof d.price === 'number' && d.price > 0) {
          return (d.price * usdTry) / 31.1035
        }
      }
    } catch {}
  }
  // No key or goldapi failed — use fawazahmed0 (today → latest tag)
  return (
    (await goldFromFawazahmed(isoDate(0), usdTry)) ??
    (await goldFromFawazahmed('latest', usdTry))
  )
}

async function fetchPrevGold(usdTry: number): Promise<number | null> {
  return (
    (await goldFromFawazahmed(isoDate(1), usdTry)) ??
    (await goldFromFawazahmed('latest', usdTry))
  )
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const current = await latestTCMB(0)
    if (!current) throw new Error('TCMB unavailable')

    const prev = await latestTCMB(1)

    const [goldGramTry, prevGoldGramTry] = await Promise.all([
      fetchCurrentGold(current.usdTry),
      prev ? fetchPrevGold(prev.usdTry) : Promise.resolve(null),
    ])

    if (!goldGramTry) throw new Error('Gold price unavailable')

    return NextResponse.json(
      {
        ...current,
        goldGramTry,
        prevUsdTry:      prev?.usdTry,
        prevEurTry:      prev?.eurTry,
        prevGbpTry:      prev?.gbpTry,
        prevGoldGramTry: prevGoldGramTry ?? undefined,
        updatedAt:       Date.now(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ error: 'Fiyatlar alınamadı' }, { status: 502 })
  }
}
