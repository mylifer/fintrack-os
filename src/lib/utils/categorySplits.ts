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

/** Aynı kategori birden fazla payda geçiyor mu? (Alt/üst kategori ilişkisi
 *  kurala DAHİL DEĞİL — yalnız birebir aynı kategori tekrarı sayılır.) */
export function hasDuplicateCategory(splits: readonly CategorySplit[]): boolean {
  const seen = new Set<string>()
  for (const s of splits) {
    if (seen.has(s.categoryId)) return true
    seen.add(s.categoryId)
  }
  return false
}

/**
 * Kaydedilebilir mi: 2+ pay, her payın kategorisi dolu, kategoriler birbirinden
 * farklı ve toplam tutarı tutuyor.
 */
export function splitsAreValid(splits: readonly CategorySplit[] | undefined, amount: number): boolean {
  if (!splits || splits.length < 2) return false
  if (splits.some(s => !s.categoryId)) return false
  if (hasDuplicateCategory(splits)) return false
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

/* ── Elle girilen paylar (form durumu) ──────────────────────────────────────
   Formda her pay "sabit" ya da "otomatik"tir. Kullanıcının tutarını YAZDIĞI
   pay sabitlenir ve bir daha kendiliğinden değişmez; kalan tutar otomatik
   payların arasında paylaşılır — pratikte sonuncusu kalanı yutar.

   Sabitler kalana sığmıyorsa (tutar küçüldü ya da yeni giriş çok büyük)
   SONDAN başlayarak serbest bırakılır: en eski girişler korunur, kalanı
   emen hep son paydır. `pinned` yalnızca form durumudur — kayda gitmez.
─────────────────────────────────────────────────────────────────────────── */

export interface DraftSplit extends CategorySplit {
  /** Kullanıcı bu payın tutarını elle yazdı → kalan dağıtılırken korunur. */
  pinned?: boolean
}

/** Minor birimde eşit bölüm; kuruş kalanı ilk paylara (splitMoney konvansiyonu). */
function splitMinor(totalMinor: number, count: number): number[] {
  const per = Math.floor(totalMinor / count)
  const rem = totalMinor - per * count
  return Array.from({ length: count }, (_, i) => per + (i < rem ? 1 : 0))
}

/**
 * Payları `total`a oturtur: sabitler korunur, kalan otomatik paylara eşit
 * dağıtılır. `forced` verilirse o pay bu çağrıda sabitlenir (elle giriş).
 * Toplam HER ZAMAN tam tutar; sığmayan sabitler sondan serbest bırakılır.
 */
function allocate(
  splits: readonly DraftSplit[],
  total: number,
  forced?: { index: number; amount: number },
): DraftSplit[] {
  if (splits.length === 0) return []
  const totalMinor = toMinor(total)
  const sign = totalMinor < 0 ? -1 : 1
  const absTotal = Math.abs(totalMinor)
  // Tek pay bölme değildir: tutarın tamamını taşır.
  if (splits.length === 1) return [{ ...splits[0], amount: total, pinned: false }]

  const amt    = splits.map(s => Math.abs(toMinor(s.amount)))
  const pinned = splits.map(s => !!s.pinned)

  // Elle giriş: kendi payı [0, toplam] aralığına kırpılır ve sabitlenir.
  let rest = absTotal
  if (forced) {
    amt[forced.index]    = Math.min(absTotal, Math.max(0, Math.abs(toMinor(forced.amount))))
    pinned[forced.index] = true
    rest = absTotal - amt[forced.index]
  }

  const isFixed = (j: number) => pinned[j] && !(forced && j === forced.index)
  const fixedSum = () => splits.reduce((acc, _, j) => acc + (isFixed(j) ? amt[j] : 0), 0)

  // Sığmayan sabitleri SONDAN serbest bırak — kalanı emen hep son paydır.
  for (let j = splits.length - 1; j >= 0 && fixedSum() > rest; j--) {
    if (isFixed(j)) pinned[j] = false
  }

  const freeIdx = () => splits.map((_, j) => j).filter(j => !isFixed(j) && !(forced && j === forced.index))
  // Kalan bir yere YAZILMALI (toplam değişmezi): tek bir otomatik pay bile
  // kalmadıysa son sabit serbest bırakılır.
  if (freeIdx().length === 0 && fixedSum() !== rest) {
    for (let j = splits.length - 1; j >= 0; j--) if (isFixed(j)) { pinned[j] = false; break }
  }

  const free = freeIdx()
  const left = Math.max(0, rest - fixedSum())
  if (free.length > 0) {
    const parts = splitMinor(left, free.length)
    free.forEach((j, k) => { amt[j] = parts[k] })
  }

  return splits.map((s, j) => ({ ...s, amount: toMajor(sign * amt[j]), pinned: pinned[j] }))
}

/**
 * Bir payın tutarı elle girildi. O pay sabitlenir, DAHA ÖNCE girilen paylar
 * aynen kalır ve kalan tutar otomatik paylara (pratikte sonuncusuna) yazılır.
 */
export function setSplitAmount(
  splits: readonly DraftSplit[],
  index: number,
  nextAmount: number,
  total: number,
): DraftSplit[] {
  return allocate(splits, total, { index, amount: nextAmount })
}

/**
 * Tutar değişti ya da pay eklendi/çıkarıldı: sabitler korunur, kalan otomatik
 * paylara dağıtılır.
 */
export function distributeSplits(splits: readonly DraftSplit[], total: number): DraftSplit[] {
  return allocate(splits, total)
}

/** Tüm sabitleri kaldırır → paylar yeniden eşit bölünür. */
export function unpinSplits(splits: readonly DraftSplit[], total: number): DraftSplit[] {
  return allocate(splits.map(s => ({ ...s, pinned: false })), total)
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
