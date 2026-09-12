import { isTefasAsset, tefasCode } from '@/lib/tefas'
import type { InvestmentAsset } from '@/types'

/* ── TEFAS fon stopajı ───────────────────────────────────────────────────────
 * Portföy değeri (computeHoldings) ve satış kâr/zararı BRÜTTÜR: TEFAS'ın
 * yayınladığı birim pay değeri vergi öncesidir. Gerçek hayatta stopaj, payın
 * GERİ ALIMINDA (satış) kâr üzerinden kesilir — yani bugünkü portföy değeri,
 * bugün satılsa cebe girecek tutardan stopaj kadar fazladır.
 *
 * Bu modül o farkı modelleyen SAF hesaptır. İki yerde kullanılır:
 *   • Yatırımlar özeti — "Net (stopaj sonrası)" satırı (gerçekleşmemiş kâr)
 *   • Satış kaydı      — gerçekleşen kâr üzerinden stopaj gider satırı
 *
 * Kurallar (bilinçli sadeleştirmeler):
 *   • Yalnız TEFAS fonları. Altın/döviz bu modelin dışında (farklı rejim).
 *   • Matrah fon BAZINDA kârdır; zarardaki fon kârdakini MAHSUP ETMEZ.
 *     (Gerçek mahsup kuralları beyan/portföy türüne göre değişir; burada
 *      bilinçli olarak en muhafazakâr — yani en yüksek vergi — varsayım.)
 *   • Zarar → 0 vergi. Negatif vergi (iade) hiç üretilmez.
 *   • Oran KULLANICI tarafından girilir. Uygulama hiçbir oranı varsayılan
 *     kabul etmez (yürürlükteki oran fon türüne ve tarihe göre değişir;
 *     hisse yoğun fonlarda istisna olabilir). Kapalıyken etki YOKTUR.
 * ------------------------------------------------------------------------- */

export interface FundTaxConfig {
  /** Kapalıyken hiçbir yüzey stopaj göstermez ve satışta kesinti yazılmaz. */
  enabled: boolean
  /** Fon bazında oran girilmemişse kullanılan oran (%). */
  defaultRate: number
  /** Fon kodu → oran (%). Buradaki değer defaultRate'i EZER (0 dahil). */
  rates: Record<string, number>
}

export const FUND_TAX_OFF: FundTaxConfig = { enabled: false, defaultRate: 0, rates: {} }

/** Oranı geçerli aralığa (%0–100) kırpar; sayı değilse 0. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0
  return Math.min(100, Math.max(0, rate))
}

/** Bu varlığa uygulanacak stopaj oranı (%). TEFAS dışı her varlıkta 0. */
export function fundTaxRate(asset: InvestmentAsset, cfg: FundTaxConfig): number {
  if (!cfg.enabled || !isTefasAsset(asset)) return 0
  // Fon bazında 0 girilmesi "bu fon istisna" demektir — ?? ile defaultRate'e
  // DÜŞMEZ (|| olsaydı 0 sessizce varsayılana dönerdi).
  const own = cfg.rates[tefasCode(asset)]
  return clampRate(own ?? cfg.defaultRate)
}

/** Kâr üzerinden stopaj — zararda 0. Kuruşa yuvarlanır (defter satırı tutarı). */
export function taxOnGain(gain: number, rate: number): number {
  if (!(gain > 0) || !(rate > 0)) return 0
  return Math.round(gain * rate) / 100
}

/** Bir pozisyonun gerçekleşmemiş kârı üzerindeki stopaj karşılığı. */
export function holdingTax(
  h: { asset: InvestmentAsset; pnl: number },
  cfg: FundTaxConfig,
): number {
  return taxOnGain(h.pnl, fundTaxRate(h.asset, cfg))
}

/** Portföyün toplam stopaj karşılığı — fon bazında hesaplanıp toplanır. */
export function portfolioTax(
  holdings: readonly { asset: InvestmentAsset; pnl: number }[],
  cfg: FundTaxConfig,
): number {
  return holdings.reduce((s, h) => s + holdingTax(h, cfg), 0)
}

/** Oranın gösterim biçimi: '%17,5' (ondalık ayracı virgül, gereksiz sıfır yok). */
export function fmtRate(rate: number): string {
  return '%' + rate.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}
