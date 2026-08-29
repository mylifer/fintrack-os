import { historyUnitMultiplier, chartGroupOf } from './shared'
import { histKey } from './useAssetHistory'
import type { InvestmentAsset, InvestmentTransaction } from '@/types'
import type { PricePoint } from '@/app/api/prices/history/route'

/* ── Zaman çizelgeleri ───────────────────────────────────────────────────────
 * Portföyün geçmiş değeri = her varlığın O GÜNKÜ miktarı × o günkü fiyatı.
 * Maliyet çizelgesi computeHoldings ile BİREBİR aynı ortalama-maliyet oyununu
 * oynar (satış maliyeti ortalama maliyetle düşer) — üstteki özet kartlarıyla
 * grafiğin son noktası birbirini tutsun diye.
 * ------------------------------------------------------------------------- */

export interface QtyPoint { date: string; qty: number }

const byDate = (a: InvestmentTransaction, b: InvestmentTransaction) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)

/** Bir varlığın kümülatif miktarı — GEÇMİŞ SERİ BİRİMİNDE (altında gram). */
export function qtyTimelineFor(asset: InvestmentAsset, txs: InvestmentTransaction[]): QtyPoint[] {
  const mult = historyUnitMultiplier(asset)
  let cum = 0
  return [...txs]
    .filter(t => t.asset === asset)
    .sort(byDate)
    .map(t => {
      cum = Math.max(0, cum + (t.type === 'buy' ? t.quantity * mult : -(t.quantity * mult)))
      return { date: t.date, qty: cum }
    })
}

/** Adım fonksiyonu: verilen tarihte geçerli değer (çizelge artan sıralı). */
function stepAt<T extends { date: string }>(timeline: T[], date: string, pick: (t: T) => number): number {
  let v = 0
  for (const e of timeline) {
    if (e.date > date) break
    v = pick(e)
  }
  return v
}

export interface CostPoint { date: string; cost: number }

/** Tüm portföyün maliyet bazı çizelgesi (her işlemden sonra bir nokta). */
export function costTimeline(txs: InvestmentTransaction[]): CostPoint[] {
  const pos = new Map<InvestmentAsset, { qty: number; cost: number }>()
  const out: CostPoint[] = []

  for (const tx of [...txs].sort(byDate)) {
    if (!pos.has(tx.asset)) pos.set(tx.asset, { qty: 0, cost: 0 })
    const p = pos.get(tx.asset)!
    if (tx.type === 'buy') {
      p.cost += tx.quantity * tx.pricePerUnit
      p.qty  += tx.quantity
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0
      p.qty  = Math.max(0, p.qty - tx.quantity)
      p.cost = p.qty * avg
    }
    let total = 0
    for (const v of pos.values()) total += v.cost
    out.push({ date: tx.date, cost: total })
  }
  return out
}

/* ── Birleşik portföy serisi ─────────────────────────────────────────────── */

export interface PortfolioPoint { date: string; value: number; cost: number }

/** Fiyat serisini ileri-doldurmalı arayan yardımcı. */
function priceLookup(points: PricePoint[]) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  let i = 0
  let last = sorted[0]?.price ?? 0
  return (date: string) => {
    while (i < sorted.length && sorted[i].date <= date) { last = sorted[i].price; i++ }
    return last
  }
}

/**
 * Tüm varlıkların geçmiş değerini tek seriye toplar.
 *
 * NOT (ziynet yaklaşımı): çeyrek/yarım/tam/bilezik için geçmiş kotasyon yok;
 * gram-eşdeğeri × gram altın fiyatı kullanılır — mevcut PriceHistoryChart ile
 * aynı sözleşme. BUGÜNKÜ nokta bu yaklaşımla değil, canlı toplamla (todayValue)
 * çizilir; böylece grafiğin ucu özet kartlarıyla birebir aynı olur.
 */
export function buildPortfolioSeries(opts: {
  assets:       InvestmentAsset[]
  transactions: InvestmentTransaction[]
  series:       Record<string, PricePoint[]>
  from:         string
  todayStr:     string
  todayValue:   number
  todayCost:    number
}): PortfolioPoint[] {
  const { assets, transactions, series, from, todayStr, todayValue, todayCost } = opts

  // Varlık başına: miktar çizelgesi + hangi fiyat serisini okuyacağı
  const plans = assets.map(asset => {
    const { group, fundCode } = chartGroupOf(asset)
    const key = Object.keys(series).find(k => k.startsWith(`${group}|${fundCode ?? ''}|`))
    return { asset, qty: qtyTimelineFor(asset, transactions), points: key ? series[key] : undefined }
  }).filter(p => p.points && p.points.length)

  if (!plans.length) return []

  // Ortak tarih ekseni: tüm serilerin birleşimi
  const dateSet = new Set<string>()
  for (const p of plans) for (const pt of p.points!) if (pt.date >= from) dateSet.add(pt.date)
  const dates = [...dateSet].sort()
  if (!dates.length) return []

  const lookups = plans.map(p => ({ qty: p.qty, at: priceLookup(p.points!) }))
  const costs   = costTimeline(transactions)

  const rows: PortfolioPoint[] = dates.map(date => {
    let value = 0
    for (const l of lookups) {
      const q = stepAt(l.qty, date, e => e.qty)
      if (q > 0) value += q * l.at(date)
    }
    return { date, value, cost: stepAt(costs, date, e => e.cost) }
  })

  // Bugünkü ankraj: canlı toplam (kotasyon evreni geçmiş seriden farklı)
  const last = rows[rows.length - 1]
  if (last && last.date === todayStr) {
    last.value = todayValue
    last.cost  = todayCost
  } else {
    rows.push({ date: todayStr, value: todayValue, cost: todayCost })
  }

  return rows
}

/** Sparkline için: tek varlığın birim fiyat serisi (normalize edilmemiş ham). */
export function sparkPoints(points: PricePoint[], take = 30): number[] {
  if (!points.length) return []
  const tail = points.slice(-take)
  return tail.map(p => p.price)
}

export { histKey }
