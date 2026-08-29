import { isTefasAsset, tefasCode } from '@/lib/tefas'
import { GOLD_GRAMS } from '@/store/investment.store'
import type {
  InvestmentAsset, InvestmentHolding, InvestmentTransaction,
  PriceData, StaticInvestmentAsset, TefasFundPrice,
} from '@/types'
import type { AssetGroup } from '@/app/api/prices/history/route'

/* ── Yatırım tahtasının ortak modeli ─────────────────────────────────────────
 * Dört görünüm (Konsol · Sınıf · Dağılım · Odak) AYNI satır kümesini ve AYNI
 * kolon setini tüketir; görünüm değiştirmek tutarları değiştirmez. Hesap tek
 * yerde dursun diye satır modeli burada kurulur.
 * (bkz. board-pages-pattern: kabuk her şeyi tutar, görünümler saf sunumdur)
 * ------------------------------------------------------------------------- */

export interface AssetMeta { label: string; subLabel?: string; icon: string; unit: string }

const ASSET_META: Record<StaticInvestmentAsset, AssetMeta> = {
  GOLD_GRAM:     { label: 'Gram Altın',        icon: 'Au', unit: 'gr'   },
  GOLD_QUARTER:  { label: 'Çeyrek Altın',      icon: 'Au', unit: 'adet' },
  GOLD_HALF:     { label: 'Yarım Altın',       icon: 'Au', unit: 'adet' },
  GOLD_FULL:     { label: 'Tam Altın',         icon: 'Au', unit: 'adet' },
  GOLD_OZ:       { label: 'Ons Altın',         icon: 'Au', unit: 'oz'   },
  GOLD_BRACELET: { label: 'Bilezik (22 Ayar)', icon: 'Au', unit: 'gr'   },
  USD:           { label: 'ABD Doları',        icon: '$',  unit: '$'    },
  EUR:           { label: 'Euro',              icon: '€',  unit: '€'    },
  GBP:           { label: 'İngiliz Sterlini',  icon: '£',  unit: '£'    },
}

/** TEFAS fonları dinamik: etiket fon kodu, alt etiket fon unvanı (fiyat geldiyse). */
export function assetMeta(asset: InvestmentAsset, fundPrices: Record<string, TefasFundPrice>): AssetMeta {
  if (isTefasAsset(asset)) {
    const code = tefasCode(asset)
    return { label: code, subLabel: fundPrices[code]?.name, icon: 'F', unit: 'pay' }
  }
  return ASSET_META[asset]
}

/* ── Varlık sınıfı ───────────────────────────────────────────────────────── */

export type AssetClass = 'GOLD' | 'FX' | 'FUND'

/** Sınıf renkleri mevcut grafik renklerinden gelir (renk varlığı izler, sırayı
 *  değil). Üçlü palet dataviz doğrulayıcısından açık+koyu temada geçti. */
export const CLASS_META: Record<AssetClass, { label: string; color: string }> = {
  GOLD: { label: 'Altın', color: '#d97706' },
  FX:   { label: 'Döviz', color: '#2563eb' },
  FUND: { label: 'Fon',   color: '#e11d48' },
}

export const CLASS_ORDER: AssetClass[] = ['GOLD', 'FX', 'FUND']

export function assetClass(asset: InvestmentAsset): AssetClass {
  if (isTefasAsset(asset)) return 'FUND'
  if (asset === 'USD' || asset === 'EUR' || asset === 'GBP') return 'FX'
  return 'GOLD'
}

/** Sınıf içi ayrım: aynı hue'nun açıklık basamakları (sıralı ramp kuralı). */
export function classShade(cls: AssetClass, i: number, n: number): string {
  const base = CLASS_META[cls].color
  if (n <= 1) return base
  // 0 → tam ton, sonrakiler kademeli olarak zemine doğru açılır
  const alpha = 1 - (i / n) * 0.55
  return hexWithAlpha(base, alpha)
}

function hexWithAlpha(hex: string, a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')
  return hex + v
}

/* ── Grafik grubu ────────────────────────────────────────────────────────── */

/** Fiyat geçmişi API'sinde hangi seriye denk düşüyor. Ziynetler gram-eşdeğeri
 *  üzerinden GOLD serisini kullanır (canlı ziynet kotasyonu geçmişte yok). */
export function chartGroupOf(asset: InvestmentAsset): { group: AssetGroup; fundCode?: string } {
  if (isTefasAsset(asset)) return { group: 'TEFAS', fundCode: tefasCode(asset) }
  if (asset === 'USD' || asset === 'EUR' || asset === 'GBP') return { group: asset }
  return { group: 'GOLD' }
}

/** Bir birimin geçmiş seri fiyatı cinsinden çarpanı (altında gram karşılığı). */
export function historyUnitMultiplier(asset: InvestmentAsset): number {
  return GOLD_GRAMS[asset] ?? 1
}

/* ── Günlük değişim ──────────────────────────────────────────────────────── */

/** Canlı feed'deki bir önceki kapanış. Yoksa null — "—" gösterilir, 0 değil. */
export function prevAssetPrice(
  asset: InvestmentAsset,
  prices: PriceData | null,
  fundPrices: Record<string, TefasFundPrice>,
): number | null {
  if (isTefasAsset(asset)) return fundPrices[tefasCode(asset)]?.prevPrice ?? null
  if (!prices) return null
  if (asset === 'GOLD_QUARTER'  && prices.prevGoldQuarterTry) return prices.prevGoldQuarterTry
  if (asset === 'GOLD_HALF'     && prices.prevGoldHalfTry)    return prices.prevGoldHalfTry
  if (asset === 'GOLD_FULL'     && prices.prevGoldFullTry)    return prices.prevGoldFullTry
  if (asset === 'GOLD_BRACELET' && prices.prevBilezikGramTry) return prices.prevBilezikGramTry
  if (asset in GOLD_GRAMS) {
    return prices.prevGoldGramTry ? prices.prevGoldGramTry * GOLD_GRAMS[asset]! : null
  }
  if (asset === 'USD') return prices.prevUsdTry ?? null
  if (asset === 'EUR') return prices.prevEurTry ?? null
  if (asset === 'GBP') return prices.prevGbpTry ?? null
  return null
}

/* ── Satır modeli ────────────────────────────────────────────────────────── */

export interface AssetRow extends InvestmentHolding {
  cls:       AssetClass
  meta:      AssetMeta
  /** Portföy değeri içindeki payı (0–1). Fiyat yoksa 0. */
  weight:    number
  /** Bugünkü değişim — önceki kapanış yoksa null. */
  dayPct:    number | null
  dayValue:  number | null
  /** Bu varlığın fiyatı çekilebildi mi (fon fiyatı gecikebilir). */
  hasPrices: boolean
  /** Geçmiş serinin birimi cinsinden güncel fiyat (altında GRAM fiyatı).
   *  Grafik ankrajı bunu kullanır — ziynet kotasyonu gram serisiyle karışmasın. */
  unitPrice: number
  txCount:   number
  lastDate:  string | null
  group:     AssetGroup
  fundCode?: string
}

export function buildRows(
  holdings: InvestmentHolding[],
  transactions: InvestmentTransaction[],
  prices: PriceData | null,
  fundPrices: Record<string, TefasFundPrice>,
): AssetRow[] {
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0)

  return holdings.map(h => {
    const txs   = transactions.filter(t => t.asset === h.asset)
    const prev  = prevAssetPrice(h.asset, prices, fundPrices)
    const { group, fundCode } = chartGroupOf(h.asset)
    const hasPrices = isTefasAsset(h.asset) ? !!fundPrices[tefasCode(h.asset)] : !!prices
    const dayPct = prev && prev > 0 ? ((h.currentPrice - prev) / prev) * 100 : null
    // Altın türevleri geçmişte gram serisinden okunur; canlı ziynet kotasyonunu
    // o seriye ankraj yaparsak grafiğin son noktası sıçrar.
    const unitPrice = group === 'GOLD' ? (prices?.goldGramTry ?? 0) : h.currentPrice

    return {
      ...h,
      cls:      assetClass(h.asset),
      meta:     assetMeta(h.asset, fundPrices),
      weight:   totalValue > 0 ? h.currentValue / totalValue : 0,
      dayPct,
      dayValue: prev !== null ? (h.currentPrice - prev) * h.quantity : null,
      hasPrices,
      unitPrice,
      txCount:  txs.length,
      lastDate: txs.reduce<string | null>((m, t) => (m === null || t.date > m ? t.date : m), null),
      group,
      fundCode,
    }
  })
}

/* ── Sıralama ────────────────────────────────────────────────────────────── */

export type SortId = 'value' | 'pnl' | 'pnlPct' | 'day' | 'cost' | 'name'

export const SORT_LABELS: Record<SortId, string> = {
  value:  'Değer',
  pnl:    'K/Z',
  pnlPct: 'K/Z %',
  day:    'Günlük',
  cost:   'Maliyet',
  name:   'İsim',
}

export function sortRows(rows: AssetRow[], sort: SortId): AssetRow[] {
  const out = [...rows]
  switch (sort) {
    case 'value':  out.sort((a, b) => b.currentValue - a.currentValue); break
    case 'pnl':    out.sort((a, b) => b.pnl - a.pnl); break
    case 'pnlPct': out.sort((a, b) => b.pnlPercent - a.pnlPercent); break
    case 'day':    out.sort((a, b) => (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity)); break
    case 'cost':   out.sort((a, b) => b.totalCost - a.totalCost); break
    case 'name':   out.sort((a, b) => a.meta.label.localeCompare(b.meta.label, 'tr-TR')); break
  }
  return out
}

/* ── Biçimlendirme ───────────────────────────────────────────────────────── */

export function fmtQty(qty: number, unit: string) {
  const dec = unit === 'adet' ? 0 : 4
  return qty.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: dec }) + ' ' + unit
}

export function pnlColor(pnl: number) {
  return pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-destructive' : 'text-muted-foreground'
}

/** İşaretli yüzde — sayfanın geri kalanı gibi son ek '%', ondalık AYRACI VİRGÜL. */
export function fmtPct(pct: number, digits = 2) {
  const n = Math.abs(pct).toLocaleString('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })
  return (pct >= 0 ? '+' : '−') + n + '%'
}

/** İşaretsiz pay yüzdesi ('%32,8') — dağılım/pay kolonları için ön ekli biçim. */
export function pctLabel(ratio: number, digits = 1) {
  return '%' + (ratio * 100).toLocaleString('tr-TR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })
}
