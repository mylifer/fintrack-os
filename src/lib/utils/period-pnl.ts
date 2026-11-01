import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { InvestmentTransaction } from '@/types'

/* Dönemsel kâr/zarar — grafiklerde seçilen zaman aralığı (1A, 3A, 1Y…) için.

   Portföy değerindeki değişim kâr/zarar DEĞİLDİR: alım değeri büyütür, satış
   küçültür ama ikisi de para giriş-çıkışıdır. Bu yüzden:

     K/Z = bitiş değeri − başlangıç değeri − (dönemdeki alımlar − dönemdeki satışlar)

   Örnek: dönem başında ₺10.000, dönemde ₺1.000 kazanıldı, ₺500'lük satış yapıldı
   → bitiş ₺10.500. Değer farkı ₺500 ama K/Z = 10.500 − 10.000 + 500 = ₺1.000.

   Yüzde, Modified Dietz ile: K/Z / (başlangıç değeri + ağırlıklı akışlar). Dönemin
   ortasında yatırılan para dönemin yarısı kadar "sermaye" sayılır; böylece yeni
   alımlar yüzdeyi şişirmez, satışlar da düşürmez. */

/** Para akışı: alım (+), satış (−) — TL. */
export interface CashFlow { date: string; amount: number }

export function cashFlowsOf(txs: InvestmentTransaction[]): CashFlow[] {
  return txs.map(t => ({
    date:   t.date,
    amount: (t.type === 'buy' ? 1 : -1) * t.quantity * t.pricePerUnit,
  }))
}

export interface PeriodPnl {
  /** Akışlardan arındırılmış kâr/zarar (TL). */
  pnl:     number
  /** Dönemdeki net akış: alımlar − satışlar. */
  netFlow: number
  /** Modified Dietz getirisi (%); sermaye tabanı yoksa null. */
  pct:     number | null
}

/**
 * Başlangıç noktasının değeri o günkü işlemleri zaten içerir; bu yüzden yalnızca
 * `startDate < tarih <= endDate` aralığındaki akışlar sayılır.
 */
export function periodPnl(opts: {
  startDate:  string
  startValue: number
  endDate:    string
  endValue:   number
  flows:      CashFlow[]
}): PeriodPnl {
  const { startDate, startValue, endDate, endValue, flows } = opts
  const span = Math.max(0, differenceInCalendarDays(parseISO(endDate), parseISO(startDate)))

  let netFlow  = 0
  let weighted = 0
  for (const f of flows) {
    if (f.date <= startDate || f.date > endDate) continue
    netFlow += f.amount
    const w = span > 0 ? differenceInCalendarDays(parseISO(endDate), parseISO(f.date)) / span : 0
    weighted += w * f.amount
  }

  const pnl  = endValue - startValue - netFlow
  const base = startValue + weighted
  // Çok küçük taban (ör. dönem sonunda yapılan tek alım) anlamsız yüzdeler üretir
  const pct  = base > 1e-6 ? (pnl / base) * 100 : null
  return { pnl, netFlow, pct }
}
