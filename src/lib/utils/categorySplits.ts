/* ────────────────────────────────────────────────────────────────────────
   Çoklu kategori (kategori bölme)

   Bir işlem birden fazla kategoriye bölünebilir: `tx.categorySplits` payları
   taşır, `tx.categoryId` ise EN BÜYÜK payın kategorisidir. Bu ikilik bilinçli:
   liste, arama, CSV ve kategoriye göre yazılmış her eski okuma yolu tek bir
   kategori görmeye devam eder; yalnızca kategori bazlı TOPLAMLAR payları
   görmek için expandByCategory()'den geçer.

   Değişmezler:
   · Paylar işlemin KENDİ para birimindedir (amount ile aynı birim).
   · Payların toplamı amount'a kuruşu kuruşuna eşittir (splitsMatchAmount).
   · 2'den az pay = bölünmemiş işlem; alan hiç yazılmaz (undefined).
──────────────────────────────────────────────────────────────────────── */

import type { CategorySplit, Transaction } from '@/types'
import { toMinor, toMajor, splitMoney } from './money'

/** İşlem gerçekten bölünmüş mü (2+ geçerli pay)? */
export function isSplitTx(tx: Pick<Transaction, 'categorySplits'>): boolean {
  return (tx.categorySplits?.length ?? 0) > 1
}

/** Payların toplamı tutara TAM eşit mi (kuruş hassasiyetinde)? */
export function splitsMatchAmount(splits: readonly CategorySplit[], amount: number): boolean {
  let acc = 0
  for (const s of splits) acc += toMinor(s.amount)
  return acc === toMinor(amount)
}

/** Kaydedilebilir mi: 2+ pay, her payın kategorisi dolu ve toplam tutarı tutuyor. */
export function splitsAreValid(splits: readonly CategorySplit[] | undefined, amount: number): boolean {
  if (!splits || splits.length < 2) return false
  if (splits.some(s => !s.categoryId)) return false
  return splitsMatchAmount(splits, amount)
}

/**
 * Tutarı verilen kategorilere eşit böler; kuruş kalanı ilk paylara gider
 * (splitMoney ile aynı konvansiyon — taksit bölüşümüyle tutarlı).
 */
export function equalSplit(amount: number, categoryIds: readonly string[]): CategorySplit[] {
  if (categoryIds.length === 0) return []
  const parts = splitMoney(amount, categoryIds.length)
  return categoryIds.map((categoryId, i) => ({ categoryId, amount: parts[i] }))
}

/**
 * Bir payın tutarı elle değişince farkı DİĞER paylara mevcut oranlarıyla
 * dağıtır — toplam her zaman `amount`ta sabit kalır (oran barının değişmezi).
 * `index` elle girilen payın sırasıdır; onun tutarı [0, amount] aralığına
 * kırpılır. Kuruş kalanı en son dokunulmamış paya eklenir.
 */
export function rebalanceSplits(
  splits: readonly CategorySplit[],
  index: number,
  nextAmount: number,
  amount: number,
): CategorySplit[] {
  const totalMinor = toMinor(amount)
  if (splits.length < 2) return splits.map(s => ({ ...s }))

  // İşaret korunur: iade (negatif tutar) işlemlerinde paylar da negatiftir.
  const sign = totalMinor < 0 ? -1 : 1
  const absTotal = Math.abs(totalMinor)
  const mine = Math.min(absTotal, Math.max(0, Math.abs(toMinor(nextAmount))))
  const left = absTotal - mine

  const others = splits.map((s, i) => (i === index ? 0 : Math.abs(toMinor(s.amount))))
  const otherSum = others.reduce((a, b) => a + b, 0)

  const out = splits.map((s, i) => ({ ...s, amount: toMajor(sign * (i === index ? mine : 0)) }))
  let acc = 0
  let lastOther = -1
  for (let i = 0; i < splits.length; i++) {
    if (i === index) continue
    const share = otherSum > 0
      ? Math.round((left * others[i]) / otherSum)
      : Math.round(left / (splits.length - 1))
    out[i].amount = toMajor(sign * share)
    acc += share
    lastOther = i
  }
  // Yuvarlama artığı son paya — toplam tam tutsun.
  if (lastOther >= 0 && acc !== left) {
    out[lastOther].amount = toMajor(sign * (Math.abs(toMinor(out[lastOther].amount)) + (left - acc)))
  }
  return out
}

/**
 * Toplam tutar değiştiğinde payları mevcut oranlarıyla yeniden ölçekler
 * (tutar alanına yazarken paylar orantılı kalsın diye). Kuruş kalanı son paya.
 */
export function rescaleSplits(splits: readonly CategorySplit[], nextAmount: number): CategorySplit[] {
  if (splits.length === 0) return []
  const oldMinor = splits.reduce((a, s) => a + toMinor(s.amount), 0)
  const nextMinor = toMinor(nextAmount)
  if (oldMinor === 0) return equalSplit(nextAmount, splits.map(s => s.categoryId))

  const out: CategorySplit[] = []
  let acc = 0
  for (let i = 0; i < splits.length; i++) {
    if (i === splits.length - 1) {
      out.push({ ...splits[i], amount: toMajor(nextMinor - acc) })
    } else {
      const part = Math.round((nextMinor * toMinor(splits[i].amount)) / oldMinor)
      acc += part
      out.push({ ...splits[i], amount: toMajor(part) })
    }
  }
  return out
}

/** En büyük paya sahip kategori — `tx.categoryId` bununla damgalanır. */
export function primarySplitCategoryId(splits: readonly CategorySplit[] | undefined): string | undefined {
  if (!splits?.length) return undefined
  let best = splits[0]
  for (const s of splits) if (Math.abs(toMinor(s.amount)) > Math.abs(toMinor(best.amount))) best = s
  return best.categoryId || undefined
}

/** İşlem bu kategoriyi (pay olarak veya tek kategori olarak) içeriyor mu? */
export function txHasCategory(tx: Transaction, categoryId: string): boolean {
  if (tx.categorySplits?.length) return tx.categorySplits.some(s => s.categoryId === categoryId)
  return tx.categoryId === categoryId
}

/** İşlemin dokunduğu tüm kategori id'leri (bölünmemişse tek elemanlı). */
export function txCategoryIds(tx: Transaction): string[] {
  if (tx.categorySplits?.length) return tx.categorySplits.map(s => s.categoryId)
  return tx.categoryId ? [tx.categoryId] : []
}

/**
 * Bölünmüş bir işlemi kategori başına BİRER sanal satıra açar. Sanal satırlar
 * yalnızca kategori bazlı TOPLAMA içindir — id'leri aynıdır, dolayısıyla satır
 * SAYAN yerlerde kullanılmamalıdır.
 *
 * amountTry (TRY snapshot) paylar oranında bölünür, kalan son paya eklenir;
 * snapshot yoksa hiç yazılmaz — baseAmount() kurlar gelince canlı çevirir (L3).
 */
export function txCategorySlices(tx: Transaction): Transaction[] {
  const splits = tx.categorySplits
  if (!splits || splits.length < 2) return [tx]

  const totalMinor = toMinor(tx.amount)
  const tryMinor = tx.amountTry === undefined ? null : toMinor(tx.amountTry)
  let acc = 0

  return splits.map((s, i) => {
    let amountTry: number | undefined
    if (tryMinor !== null) {
      if (i === splits.length - 1) {
        amountTry = toMajor(tryMinor - acc)
      } else {
        const part = totalMinor === 0 ? 0 : Math.round((tryMinor * toMinor(s.amount)) / totalMinor)
        acc += part
        amountTry = toMajor(part)
      }
    }
    return {
      ...tx,
      categoryId:     s.categoryId,
      amount:         s.amount,
      amountTry,
      categorySplits: undefined,
    }
  })
}

/**
 * Kategori bazlı toplama için işlem listesini paylara açar. Bölünmemiş satırlar
 * olduğu gibi geçer (referans korunur → gereksiz kopya yok).
 */
export function expandByCategory(transactions: readonly Transaction[]): Transaction[] {
  let hasSplit = false
  for (const tx of transactions) {
    if (isSplitTx(tx)) { hasSplit = true; break }
  }
  if (!hasSplit) return transactions as Transaction[]
  return transactions.flatMap(txCategorySlices)
}
