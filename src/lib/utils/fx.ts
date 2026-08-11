import type { CurrencyCode, PriceData, Transaction } from '@/types'
import { mulMoney } from './money'

/* ────────────────────────────────────────────────────────────────────────
   FX / base-currency normalization (S2, S3)

   The base (reporting) currency is TRY. Every transaction persists a snapshot
   `amountTry` = amount converted at the rate in effect when it was created or
   edited (see transactions.store). All analytical aggregators sum `amountTry`,
   never the raw `amount`, so a mixed-currency ledger can't add ₺ + $ as bare
   numbers, and a historical row keeps its rate even as the live rate moves.

   Live rates are pushed here from the investment store's price fetch, so this
   module has NO store imports (avoids an import cycle: stores → fx → money).
──────────────────────────────────────────────────────────────────────── */

let rates: { usdTry: number; eurTry: number; gbpTry: number } | null = null

/** Publish the latest live rates (called after prices are fetched). */
export function setBaseRates(prices: PriceData | null): void {
  if (!prices) return
  rates = { usdTry: prices.usdTry, eurTry: prices.eurTry, gbpTry: prices.gbpTry }
}

/** TRY per 1 unit of `currency`; null when unknown/unavailable. */
export function rateFor(currency: CurrencyCode): number | null {
  if (currency === 'TRY') return 1
  if (!rates) return null
  if (currency === 'USD') return rates.usdTry
  if (currency === 'EUR') return rates.eurTry
  if (currency === 'GBP') return rates.gbpTry
  return null
}

/** Convert an amount in `currency` into base TRY. Falls back to the raw amount
 *  only when no rate is available (degraded — affects foreign amounts booked
 *  before prices load; TRY is always exact). Sign is preserved. */
export function toBaseTry(amount: number, currency: CurrencyCode): number {
  const r = rateFor(currency)
  if (r === null) return amount
  return mulMoney(amount, r)
}

/** The `amountTry` snapshot to PERSIST for a write — the converted value, or
 *  `null` when no rate is available yet.
 *
 *  Neden ayrı bir fonksiyon: toBaseTry kur yokken ham tutara düşer, bu OKUMA
 *  için kasıtlı bir degrade. Ama snapshot KALICIDIR — baseAmount() bir kez
 *  yazılmış değeri döndürür, kurlar sonradan gelse bile düzelmez. Ham fallback'i
 *  damgalamak $100'ü sonsuza dek 100₺ yapar. Bu yüzden yazma yolunun tamamı
 *  (withBase + update) kararı BURADAN alır; null gelince alan temizlenir. */
export function baseSnapshot(amount: number, currency: CurrencyCode): number | null {
  return rateFor(currency) === null ? null : toBaseTry(amount, currency)
}

/** Convert a base-TRY amount back into `currency` (cross-currency transfer legs). */
export function fromBaseTry(amountTry: number, currency: CurrencyCode): number {
  const r = rateFor(currency)
  if (r === null || r === 0) return amountTry
  return mulMoney(amountTry, 1 / r)
}

/** TRY-normalized value of a transaction: the snapshot if present, else a
 *  best-effort live conversion for legacy rows without `amountTry`. */
export function baseAmount(
  tx: Pick<Transaction, 'amount' | 'currency'> & { amountTry?: number | null },
): number {
  if (tx.amountTry != null) return tx.amountTry
  return toBaseTry(tx.amount, tx.currency)
}
