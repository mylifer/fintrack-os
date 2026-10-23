import type { Account, CurrencyCode, Transaction } from '@/types'
import { isInvestmentPrincipalTx, isRealizedInvestmentPnlTx } from './calculations'
import { roundMoney } from './money'

/* ── Döviz hesabındaki eski yatırım defter satırları ──────────────────────────
   2026-10'a kadar yatırım alım/satımının bağlı defter satırı, seçilen hesap
   USD/EUR/GBP olsa bile TL tutar ve 'TRY' etiketiyle yazılıyordu. Bakiye hesabı
   satırın tutarını hesabın kendi birimi saydığı için 10.000 ₺'lik alım USD
   hesabından 10.000 $ düşüyordu. Yeni kayıtlar doğru yazılıyor; bu modül ESKİ
   satırları bulur ve İŞLEM GÜNÜNÜN kuruyla hesabın para birimine çevirir.

   Saf modül: store/DB yok. Uygulama tarafı lib/fix-investment-ledger.ts. */

/** Yatırımın ürettiği defter satırı mı (alım/satış anaparası, kâr/zarar, stopaj). */
function isInvestmentLedgerRow(t: Pick<Transaction, 'icon' | 'description'>): boolean {
  return isInvestmentPrincipalTx(t) || isRealizedInvestmentPnlTx(t)
}

/** Döviz hesabına 'TRY' etiketiyle yazılmış canlı yatırım satırları. */
export function findMislabeledInvestmentRows<T extends Transaction>(
  transactions: readonly T[],
  accounts: readonly Pick<Account, 'id' | 'currency'>[],
): T[] {
  const currencyOf = new Map(accounts.map(a => [a.id, a.currency]))
  return transactions.filter(t => {
    if (t.deleted_at) return false
    if (t.currency !== 'TRY') return false
    const acc = currencyOf.get(t.accountId)
    return !!acc && acc !== 'TRY' && isInvestmentLedgerRow(t)
  })
}

export interface PricePoint { date: string; price: number }

/** İşlem gününün kuru: o gün ya da öncesindeki son kapanış (hafta sonu/tatil);
 *  seri o günden sonra başlıyorsa ilk nokta. Seri boşsa null. */
export function rateOn(points: readonly PricePoint[], date: string): number | null {
  if (points.length === 0) return null
  const d = date.slice(0, 10)
  let best: PricePoint | null = null
  for (const p of points) {
    if (p.date <= d && (!best || p.date > best.date)) best = p
  }
  const pick = best ?? [...points].sort((a, b) => a.date.localeCompare(b.date))[0]
  return pick.price > 0 ? pick.price : null
}

export interface LedgerFix {
  id: string
  patch: { amount: number; currency: CurrencyCode; amountTry: number }
}

/**
 * Satır başına yama: tutar hesabın para birimine (işlem günü kuruyla) çevrilir;
 * amountTry (raporların TL değeri) satırın ÖZGÜN TL tutarı olarak kalır — o gün
 * gerçekten ödenen/alınan TL budur. Kuru bulunamayan satır atlanır (yanlış kurla
 * yazmaktansa bir sonraki açılışta yeniden denenir).
 */
export function planLedgerFixes(
  rows: readonly Transaction[],
  accounts: readonly Pick<Account, 'id' | 'currency'>[],
  history: Partial<Record<CurrencyCode, readonly PricePoint[]>>,
): LedgerFix[] {
  const currencyOf = new Map(accounts.map(a => [a.id, a.currency]))
  const out: LedgerFix[] = []
  for (const t of rows) {
    const currency = currencyOf.get(t.accountId)
    if (!currency || currency === 'TRY') continue
    const rate = rateOn(history[currency] ?? [], t.date)
    if (!rate) continue
    const amountTry = roundMoney(t.amountTry ?? t.amount)
    out.push({ id: t.id, patch: { amount: roundMoney(amountTry / rate), currency, amountTry } })
  }
  return out
}
