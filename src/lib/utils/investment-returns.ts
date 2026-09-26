import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { InvestmentAsset, InvestmentTransaction } from '@/types'

/* Yatırım getirisi — gerçekleşen kâr/zarar ve yıllık getiri (XIRR).

   Maliyet yöntemi computeHoldings ile BİREBİR aynı: ağırlıklı ortalama maliyet;
   satış, SATIŞ ANINDAKİ ortalama maliyetle düşer. İşlemler (tarih, createdAt)
   sırasıyla oynatılır — geriye tarihli bir satış, kendisinden SONRAKİ alımların
   maliyetini görmez (denetim #7: satış kârı eskiden bugünkü ortalama maliyetle
   hesaplanıyordu). */

const byTime = (a: InvestmentTransaction, b: InvestmentTransaction) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)

export interface RealizedSale {
  id: string
  asset: InvestmentAsset
  date: string
  quantity: number
  proceeds: number
  cost: number
  gain: number
}

/** Tüm satışların gerçekleşen kâr/zararı (brüt — stopaj ayrı defter satırıdır). */
export function realizedSales(transactions: InvestmentTransaction[]): RealizedSale[] {
  const pos = new Map<InvestmentAsset, { qty: number; cost: number }>()
  const out: RealizedSale[] = []
  for (const tx of [...transactions].sort(byTime)) {
    const p = pos.get(tx.asset) ?? { qty: 0, cost: 0 }
    pos.set(tx.asset, p)
    if (tx.type === 'buy') {
      p.cost += tx.quantity * tx.pricePerUnit
      p.qty  += tx.quantity
      continue
    }
    const avg      = p.qty > 0 ? p.cost / p.qty : 0
    const soldQty  = Math.min(tx.quantity, p.qty)   // eldekinden fazlası maliyetsiz
    const cost     = soldQty * avg
    const proceeds = tx.quantity * tx.pricePerUnit
    out.push({ id: tx.id, asset: tx.asset, date: tx.date, quantity: tx.quantity, proceeds, cost, gain: proceeds - cost })
    p.qty  = Math.max(0, p.qty - tx.quantity)
    p.cost = p.qty * avg
  }
  return out
}

/**
 * Bir satışın maliyet bazı için: `at` anındaki (tarih + createdAt) ortalama
 * birim maliyet. `excludeId` düzenlenen işlemin eski halini dışarıda bırakır.
 */
export function avgCostAt(
  transactions: InvestmentTransaction[],
  asset: InvestmentAsset,
  at: { date: string; createdAt: string },
  excludeId?: string,
): number {
  let qty = 0, cost = 0
  for (const tx of [...transactions].sort(byTime)) {
    if (tx.asset !== asset || tx.id === excludeId) continue
    if (tx.date > at.date || (tx.date === at.date && tx.createdAt >= at.createdAt)) break
    if (tx.type === 'buy') {
      cost += tx.quantity * tx.pricePerUnit
      qty  += tx.quantity
    } else {
      const avg = qty > 0 ? cost / qty : 0
      qty  = Math.max(0, qty - tx.quantity)
      cost = qty * avg
    }
  }
  return qty > 0 ? cost / qty : 0
}

/* ── XIRR ──────────────────────────────────────────────────────────────── */

export interface CashFlow { date: string; amount: number }

/**
 * Düzensiz aralıklı nakit akışlarının yıllık iç verim oranı (0.25 = %25).
 * Yatırım işaret kuralı: alım −, satış ve bugünkü değer +.
 * Hem negatif hem pozitif akış yoksa ya da çözüm bulunamazsa null.
 */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows.filter(f => Number.isFinite(f.amount) && f.amount !== 0)
  if (!fs.some(f => f.amount < 0) || !fs.some(f => f.amount > 0)) return null
  const t0 = parseISO([...fs].sort((a, b) => a.date.localeCompare(b.date))[0].date)
  const ys = fs.map(f => ({ y: differenceInCalendarDays(parseISO(f.date), t0) / 365, a: f.amount }))

  const npv  = (r: number) => ys.reduce((s, { y, a }) => s + a / Math.pow(1 + r, y), 0)
  const dnpv = (r: number) => ys.reduce((s, { y, a }) => s - (y * a) / Math.pow(1 + r, y + 1), 0)

  // Newton — çoğu portföyde birkaç adımda yakınsar
  let r = 0.1
  for (let i = 0; i < 50; i++) {
    const f = npv(r), d = dnpv(r)
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break
    const next = r - f / d
    if (!Number.isFinite(next) || next <= -0.9999) break
    if (Math.abs(next - r) < 1e-9) return next
    r = next
  }

  // Yedek: ikiye bölme (npv, r arttıkça azalır: alım önce, dönüş sonra)
  let lo = -0.9999, hi = 100
  let flo = npv(lo), fhi = npv(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid
    if (fm * flo > 0) { lo = mid; flo = fm } else { hi = mid; fhi = fm }
  }
  return (lo + hi) / 2
}

/** Yıllıklaştırma için en kısa süre: birkaç günlük %2, "yıllık %200" diye görünmesin. */
export const XIRR_MIN_DAYS = 30

/**
 * Varlık kümesinin yıllık getirisi: alım/satış akışları + bugünkü değer.
 * İlk işlem XIRR_MIN_DAYS'ten yeniyse null (yıllıklaştırma yanıltıcı).
 */
export function investmentXirr(
  transactions: InvestmentTransaction[],
  currentValue: number,
  todayStr: string,
): number | null {
  if (!transactions.length) return null
  const first = transactions.reduce((m, t) => (t.date < m ? t.date : m), transactions[0].date)
  if (differenceInCalendarDays(parseISO(todayStr), parseISO(first)) < XIRR_MIN_DAYS) return null
  const flows: CashFlow[] = transactions.map(t => ({
    date: t.date,
    amount: (t.type === 'buy' ? -1 : 1) * t.quantity * t.pricePerUnit,
  }))
  if (currentValue > 0) flows.push({ date: todayStr, amount: currentValue })
  return xirr(flows)
}
