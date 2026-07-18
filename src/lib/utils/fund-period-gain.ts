// Seçili dönemdeki TEFAS fon getirisi (TRY) — dashboard gelir kartı için.
//
// Dönem getirisi = dönem sonu değer − dönem başı değer − dönem içi alımlar
// + dönem içi satışlar. Satışın kâr/zararı satış anında ayrı bir gelir/gider
// işlemi olarak kaydedildiğinden (pnlLinkedTransactionId) GERÇEKLEŞEN kâr
// burada düşülür; yoksa gelir kartı aynı kazancı iki kez sayar.
import type { InvestmentTransaction, TefasFundPrice } from '@/types'
import { tefasAsset, tefasCodesIn } from '@/lib/tefas'

export interface FundPricePoint { date: string; price: number }

export function calcFundPeriodGain(
  investTxs: InvestmentTransaction[],
  fundPrices: Record<string, TefasFundPrice>,
  history: Record<string, FundPricePoint[]>, // fon kodu → dönem başı öncesini de kapsayan günlük seri
  from: string,
  to: string,
  daily: boolean, // 'Bugün': yalnızca TEFAS `to` günü (bugün) taze kapanış yayınladıysa son iki kapanış farkı; aksi halde 0
): number {
  let net = 0
  for (const code of tefasCodesIn(investTxs.map(t => t.asset))) {
    const asset = tefasAsset(code)
    const txs = investTxs
      .filter(t => t.asset === asset && t.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (!txs.length) continue

    // Ortalama maliyet replay'i (computeHoldings ile aynı yöntem): dönem başı
    // miktar, dönem içi alım/satım tutarları ve satışların gerçekleşen kârı
    let qty = 0, totalCost = 0, qtyStart = 0, buys = 0, sells = 0, realized = 0
    for (const tx of txs) {
      if (tx.type === 'buy') {
        totalCost += tx.quantity * tx.pricePerUnit
        qty       += tx.quantity
      } else {
        const avg = qty > 0 ? totalCost / qty : 0
        if (tx.date >= from) realized += tx.quantity * (tx.pricePerUnit - avg)
        qty       = Math.max(0, qty - tx.quantity)
        totalCost = qty * avg
      }
      if (tx.date < from) qtyStart = qty
      else if (tx.type === 'buy') buys  += tx.quantity * tx.pricePerUnit
      else                        sells += tx.quantity * tx.pricePerUnit
    }

    const fp = fundPrices[code]
    const dailyChange = fp?.prevPrice ? qty * (fp.price - fp.prevPrice) : 0
    if (daily) {
      // Günlük değişimi yalnızca TEFAS bugün (`to`) taze bir kapanış yayınladıysa
      // say. Hafta sonu/tatilde son kapanış Cuma'nındır ve zaten Cuma
      // gösterilmiştir; Pazartesi TEFAS yeni fiyatı yayınlayınca hafta sonu
      // birikimi o gün yansır. Aksi halde aynı değişim Cts/Paz tekrar sayılırdı.
      if (fp?.date === to) net += dailyChange
      continue
    }

    const pts  = history[code]
    const pNow = fp?.price ?? (pts?.length ? pts[pts.length - 1].price : undefined)
    if (pNow === undefined) continue

    if (qtyStart > 1e-6) {
      // Baz fiyat: dönem başından önceki son kapanış (seri o kadar geriye
      // gitmiyorsa ilk nokta); seri hiç yüklenemediyse günlük değişime düş
      const before = pts?.filter(p => p.date < from)
      const pStart = before?.length ? before[before.length - 1].price : pts?.[0]?.price
      if (pStart === undefined) { net += dailyChange; continue }
      net += qty * pNow - qtyStart * pStart - buys + sells - realized
    } else {
      // Dönem başında pozisyon yok → baz fiyat gerekmez ('Tüm Zamanlar' dahil)
      net += qty * pNow - buys + sells - realized
    }
  }
  return net
}
