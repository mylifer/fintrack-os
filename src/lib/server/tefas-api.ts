// TEFAS (tefas.gov.tr) yeni JSON API'si — sadece sunucu tarafında kullanılır
// (CSP connect-src tarayıcıdan dış origin'lere izin vermez, bkz. src/proxy.ts).
//
// POST /api/funds/fonFiyatBilgiGetir  { fonKodu, dil, periyod }
//   → { resultList: [{ fonKodu, fonUnvan, tarih: 'YYYY-MM-DD', fiyat, ... }] }
// periyod yalnızca {1, 3, 6, 12, 36, 60} ay değerlerini kabul eder (maks. 5 yıl).

const TEFAS_PRICE_URL = 'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir'

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/plain, */*',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

export const TEFAS_PERIODS = [1, 3, 6, 12, 36, 60] as const
export type TefasPeriod = (typeof TEFAS_PERIODS)[number]

export interface TefasPoint { date: string; price: number }
export interface TefasSeries { code: string; name: string; points: TefasPoint[] }

// İstenen gün sayısını API'nin kabul ettiği periyoda yuvarlar (5 yıldan eskisi yok)
export function snapPeriod(daysBack: number): TefasPeriod {
  const monthsNeeded = Math.ceil(Math.max(0, daysBack) / 30) + 1
  for (const p of TEFAS_PERIODS) if (p >= monthsNeeded) return p
  return 60
}

interface RawRow { fonKodu?: string; fonUnvan?: string; tarih?: string; fiyat?: number }

export async function fetchTefasSeries(
  code: string,
  period: TefasPeriod,
): Promise<TefasSeries | null> {
  try {
    const res = await fetch(TEFAS_PRICE_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ fonKodu: code, dil: 'TR', periyod: period }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = await res.json()
    const rows: RawRow[] = Array.isArray(body?.resultList) ? body.resultList : []

    // Tarih bazlı tekilleştirme: TEFAS aynı `tarih`i iki kez döndürürse grafikte
    // yinelenen dataKey oluşur; recharts hover'da (findEntryInArray) hep ilk
    // eşleşeni gösterir. Aynı tarih için son satır tutulur.
    const byDate = new Map<string, number>()
    for (const r of rows) {
      if (typeof r.fiyat === 'number' && r.fiyat > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.tarih ?? '')) {
        byDate.set(r.tarih!, r.fiyat!)
      }
    }
    const points: TefasPoint[] = [...byDate.entries()]
      .map(([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date))

    if (!points.length) return null
    return { code, name: rows[0]?.fonUnvan ?? code, points }
  } catch {
    return null
  }
}
