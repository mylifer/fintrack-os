import { differenceInCalendarDays, parseISO } from 'date-fns'
import { investmentXirr, realizedSales } from './investment-returns'
import type { InvestmentAsset, InvestmentTransaction } from '@/types'

/* Kapanan pozisyonlar — tamamı satılmış varlıklar.

   computeHoldings miktarı ~0 olan varlıkları düşürür; bu yüzden tahtanın
   görünümleri satılmış bir fonu (ör. TP2) hiç göstermez ve tarihsel grafiğine
   ulaşılamaz. Bu modül, işlem defterinden kapanmış varlıkları ve
   özetlerini çıkarır. Maliyet yöntemi realizedSales ile aynıdır (ağırlıklı
   ortalama, satış anındaki maliyet). */

/** computeHoldings ile aynı eşik: altındaki miktar "elde yok" sayılır. */
const QTY_EPS = 0.000001

export interface ClosedPosition {
  asset:      InvestmentAsset
  firstBuy:   string
  lastSell:   string
  /** İlk alımdan son satışa takvim günü. */
  daysHeld:   number
  /** Toplam alım tutarı (TL). */
  bought:     number
  /** Toplam satış geliri (TL). */
  sold:       number
  /** Satılan payların maliyeti (TL). */
  soldCost:   number
  /** Gerçekleşen kâr/zarar (brüt — stopaj ayrı defter satırı). */
  realized:   number
  /** realized / soldCost; maliyet yoksa null. */
  realizedPct: number | null
  /** Yıllık getiri (XIRR); süre çok kısaysa null. */
  xirr:       number | null
  /** Son satışın birim fiyatı — "satıştan beri" karşılaştırması için. */
  lastSellPrice: number
  txCount:    number
}

const byTime = (a: InvestmentTransaction, b: InvestmentTransaction) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)

/** İşlemleri olup eldeki miktarı sıfıra inmiş varlıklar, en son kapanan önce. */
export function closedPositions(transactions: InvestmentTransaction[]): ClosedPosition[] {
  const byAsset = new Map<InvestmentAsset, InvestmentTransaction[]>()
  for (const t of transactions) {
    const arr = byAsset.get(t.asset)
    if (arr) arr.push(t)
    else byAsset.set(t.asset, [t])
  }

  const sales = realizedSales(transactions)
  const out: ClosedPosition[] = []

  for (const [asset, list] of byAsset) {
    const txs = [...list].sort(byTime)
    let qty = 0
    for (const t of txs) qty = Math.max(0, qty + (t.type === 'buy' ? t.quantity : -t.quantity))
    if (qty >= QTY_EPS) continue

    const buys  = txs.filter(t => t.type === 'buy')
    const sells = txs.filter(t => t.type === 'sell')
    if (!buys.length || !sells.length) continue

    const assetSales = sales.filter(s => s.asset === asset)
    const realized   = assetSales.reduce((s, x) => s + x.gain, 0)
    const soldCost   = assetSales.reduce((s, x) => s + x.cost, 0)
    const lastSellTx = sells[sells.length - 1]

    out.push({
      asset,
      firstBuy:    buys[0].date,
      lastSell:    lastSellTx.date,
      daysHeld:    Math.max(0, differenceInCalendarDays(parseISO(lastSellTx.date), parseISO(buys[0].date))),
      bought:      buys.reduce((s, t) => s + t.quantity * t.pricePerUnit, 0),
      sold:        sells.reduce((s, t) => s + t.quantity * t.pricePerUnit, 0),
      soldCost,
      realized,
      realizedPct: soldCost > 0 ? (realized / soldCost) * 100 : null,
      // Pozisyon kapalı: değer 0, yıllıklaştırma son satışa kadar
      xirr:        investmentXirr(txs, 0, lastSellTx.date),
      lastSellPrice: lastSellTx.pricePerUnit,
      txCount:     txs.length,
    })
  }

  return out.sort((a, b) => b.lastSell.localeCompare(a.lastSell))
}
