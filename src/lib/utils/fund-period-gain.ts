// Seçili dönemdeki TEFAS fon getirisi (TRY) — dashboard gelir kartı için.
//
// Dönem getirisi = dönem sonu değer − dönem başı değer − dönem içi alımlar
// + dönem içi satışlar. Satışın kâr/zararı satış anında ayrı bir gelir/gider
// işlemi olarak kaydedildiğinden (pnlLinkedTransactionId) GERÇEKLEŞEN kâr
// burada düşülür; yoksa gelir kartı aynı kazancı iki kez sayar.
import type { InvestmentTransaction, TefasFundPrice } from '@/types'
import { tefasAsset, tefasCodesIn } from '@/lib/tefas'
import { today } from './date'

export interface FundPricePoint { date: string; price: number }

export function calcFundPeriodGain(
  investTxs: InvestmentTransaction[],
  fundPrices: Record<string, TefasFundPrice>,
  history: Record<string, FundPricePoint[]>, // fon kodu → günlük seri (baz = dönem öncesi son kapanış)
  from: string,
  to: string,
  daily: boolean, // 'Bugün': yalnızca TEFAS `to` günü (bugün) taze kapanış yayınladıysa son iki kapanış farkı; aksi halde 0
  asOf: string = today(), // "şimdi" referansı — dönemin geçmişte bitip bitmediğini belirler (test'te sabitlenebilir)
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
    // Günlük getiri de haftalıkla AYNI formül: baz = prevPrice (dünkü kapanış =
    // gün başı değeri), buys/sells/realized düşülür. Böylece BUGÜN alınan paylar
    // (bugünün fiyatından alındığı için) günlük fiyat değişimine SAYILMAZ — eskiden
    // `qty × (price − prevPrice)` tüm adede uygulanıp aynı-gün alıma hayali günlük
    // getiri yazıyor ve günlüğü haftalıktan yüksek gösteriyordu.
    const dailyChange = fp?.prevPrice != null
      ? qty * fp.price - qtyStart * fp.prevPrice - buys + sells - realized
      : 0
    if (daily) {
      // Yalnızca TEFAS bugün (`to`) taze kapanış yayınladıysa say. Hafta sonu/tatilde
      // son kapanış Cuma'nındır (zaten Cuma gösterildi); Pazartesi yeni fiyat gelince
      // hafta sonu birikimi o gün yansır. Aksi halde aynı değişim Cts/Paz tekrarlanırdı.
      if (fp?.date === to) net += dailyChange
      continue
    }

    const pts    = history[code]
    const within = pts?.length ? pts.filter(p => p.date >= from && p.date <= to) : []
    const before = pts?.length ? pts.filter(p => p.date < from) : [] // dönem öncesi kapanışlar

    // Dönem SONU değeri: dönem BUGÜNE (asOf) kadar uzanıyorsa canlı fiyat (fp.price)
    // kullanılır. GEÇMİŞTE biten özel aralıklarda (to < bugün) ise dönem sonu, `to`
    // gününe kadarki SON kapanıştır — bugünkü fiyatla ölçmek `to`'dan bugüne olan
    // hareketi de getiriye katıp aralığı şişirirdi. Bir dönem yalnız `to` bugünden
    // ÖNCEYSE geçmişte bitmiştir. (Eskiden `to < fp.date` kullanılıyordu; TEFAS
    // fiyat tarihi T+1 ile bugünden İLERİ olabildiğinden, bugüne kadar uzanan "Tüm
    // Zamanlar" aralığı yanlışlıkla 'geçmiş' sayılıp eski/düşük kapanışla ölçülüyor
    // ve getiri negatife düşüyordu.) Canlı fiyat yoksa serinin son noktasına düşülür.
    const endsInPast = to < asOf
    const pEnd = endsInPast
      ? (within.length ? within[within.length - 1].price : undefined)
      : (fp?.price ?? (pts?.length ? pts[pts.length - 1].price : undefined))
    if (pEnd === undefined) continue

    if (qtyStart > 1e-6) {
      // Baz fiyat: dönem BAŞLAMADAN önceki son kapanış (= dönem başı portföy değeri).
      // TEFAS T+1 gecikmesiyle dönemin ilk günü (ör. Pazartesi) yayınlanan hareket
      // aslında önceki dönemin getirisidir; bunu döneme DAHİL ederek hafta artıda
      // başlar ve günlüğün prevPrice mantığıyla tutarlı olur (haftalık ≥ günlük).
      // Dönem sonu (pEnd) canlı fiyattan gelir; canlı fiyat (fp) geçmiş seriden bir
      // gün ÖNDE olabildiğinden (T+1) dönem içi kapanış (within) henüz boş olsa da
      // hesaplarız — aksi halde haftalık 0'a çöküp günlükten düşük görünüyordu.
      // Baz yoksa dönem içi ilk kapanışa düşülür; hiçbiri yoksa hesaplanamaz.
      // Seri hiç yüklenemediyse yalnız GÜNCEL pencerede günlük değişime düş.
      if (!pts?.length) { if (!endsInPast) net += dailyChange; continue }
      const pStart = before.length  ? before[before.length - 1].price
                   : within.length  ? within[0].price
                   : undefined
      if (pStart === undefined) continue
      net += qty * pEnd - qtyStart * pStart - buys + sells - realized
    } else {
      // Dönem başında pozisyon yok → baz fiyat gerekmez ('Tüm Zamanlar' dahil)
      net += qty * pEnd - buys + sells - realized
    }
  }
  return net
}
