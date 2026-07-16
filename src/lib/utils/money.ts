/* ────────────────────────────────────────────────────────────────────────
   Money math — IEEE-754 safety (S8)

   Amounts are stored as JS floats rounded to 2 decimals (kuruş). Floats are
   safe to STORE at that precision, but ACCUMULATING many of them drifts
   (0.1 + 0.2 = 0.30000000000000004). Every ledger reduction therefore runs in
   integer minor units (kuruş) and converts back to a major-unit float only at
   the end — which is exactly what the UI/formatCurrency layer consumes.

   Rule of thumb: never `reduce((s, x) => s + x.amount, 0)` over money. Use
   `sumBy` / `addMoney` / `subMoney` / `mulMoney` instead.
──────────────────────────────────────────────────────────────────────── */

/** Major-unit float (12.34) → integer minor units (1234 kuruş). */
export function toMinor(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100)
}

/** Integer minor units (1234) → major-unit float (12.34). */
export function toMajor(minor: number): number {
  return minor / 100
}

/** Round a single amount to kuruş precision (defensive normalisation). */
export function roundMoney(amount: number): number {
  return toMajor(toMinor(amount))
}

/** Exact sum of amounts derived from `items`, accumulated in minor units. */
export function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  let acc = 0
  for (const item of items) acc += toMinor(select(item))
  return toMajor(acc)
}

/** Exact sum of a plain number array. */
export function sumMoney(amounts: readonly number[]): number {
  return sumBy(amounts, (a) => a)
}

export function addMoney(a: number, b: number): number {
  return toMajor(toMinor(a) + toMinor(b))
}

export function subMoney(a: number, b: number): number {
  return toMajor(toMinor(a) - toMinor(b))
}

/** Multiply a money amount by a unitless factor (FX rate, %), kuruş-rounded. */
export function mulMoney(amount: number, factor: number): number {
  return toMajor(Math.round(toMinor(amount) * factor))
}

/**
 * Split a total into `count` parts that sum EXACTLY to the total.
 * The kuruş remainder goes to the earliest parts: 1000/3 → [333.34, 333.33, 333.33].
 */
export function splitMoney(total: number, count: number): number[] {
  const totalMinor = toMinor(total)
  const per = Math.floor(totalMinor / count)
  const remainder = totalMinor - per * count
  return Array.from({ length: count }, (_, i) => toMajor(per + (i < remainder ? 1 : 0)))
}
