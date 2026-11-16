import type { CategorySplit, Transaction } from '@/types'
import { toMinor, toMajor, splitMoney, splitInstallments } from './money'
import { baseAmount } from './fx'
import { rescaleSplits, splitsForInstallments } from './categorySplits'

/* ────────────────────────────────────────────────────────────────────────
   Taksit editöründe tekil değişiklik → ALTTAKİ taksitlerin yeniden bölüşümü

   Kullanıcı `index`. taksiti değiştirdiğinde o taksit ve ÜSTÜNDEKİLER olduğu
   gibi kalır; toplamdan geriye kalan tutar alttaki taksitlere eşit bölünür
   (splitInstallments: banka kuralı, kuruş kalanı ilk alt taksite). Böylece toplam korunur.

   • Son taksit düzenlenirse altta satır yoktur → dizi aynen döner; toplam
     farkı editördeki uyarıyla görünür.
   • Üstteki taksitler toplamı aşarsa kalan negatiftir → alttakiler 0 olur
     (negatif taksit üretilmez; kayıt doğrulaması 0'ı zaten reddeder).
──────────────────────────────────────────────────────────────────────── */
export function rebalanceInstallmentsBelow(total: number, amounts: number[], index: number): number[] {
  const below = amounts.length - index - 1
  if (below <= 0) return amounts
  let aboveMinor = 0
  for (let i = 0; i <= index; i++) aboveMinor += toMinor(amounts[i])
  const remainderMinor = toMinor(total) - aboveMinor
  const tail = remainderMinor > 0
    ? splitInstallments(toMajor(remainderMinor), below)
    : Array.from({ length: below }, () => 0)
  return [...amounts.slice(0, index + 1), ...tail]
}

/* ────────────────────────────────────────────────────────────────────────
   Eski yuvarlamayla bölünmüş taksit gruplarını bulma (tek seferlik düzeltme)

   Eskiden taksitler splitMoney ile bölünüyordu (kuruş kalanı ilk birkaç
   taksite birer birer: 5×1.712,56 + 4×1.712,55). Bankalar ise kalanın
   tamamını 1. taksite koyar (1.712,60 + 8×1.712,55) → ekstreyle kuruş farkı.

   Yalnızca tutarları TAM OLARAK eski otomatik bölüşüme eşit olan gruplar
   döner; elle girilmiş özel tutarlara ve ekstreden gelen (zaten banka
   kuralıyla bölünmüş) gruplara dokunulmaz. Toplam her zaman korunur.
──────────────────────────────────────────────────────────────────────── */
export interface InstallmentRoundingFix {
  groupId: string
  description: string
  total: number
  /** Taksit sırasıyla satırlar ve yeni tutarları (yalnızca değişenler). */
  changes: { tx: Transaction; amount: number }[]
}

export function findInstallmentRoundingFixes(transactions: readonly Transaction[]): InstallmentRoundingFix[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (!t.isInstallment || !t.installGroupId || t.deleted_at) continue
    const g = groups.get(t.installGroupId)
    if (g) g.push(t)
    else groups.set(t.installGroupId, [t])
  }

  const fixes: InstallmentRoundingFix[] = []
  for (const [groupId, rows] of groups) {
    const n = rows.length
    if (n < 2) continue
    rows.sort((a, b) => (a.installIndex ?? 0) - (b.installIndex ?? 0))
    // Eksik/çift satırlı ya da karışık para birimli gruplar atlanır.
    if (rows.some((t, i) => t.installIndex !== i + 1 || (t.installTotal ?? n) !== n)) continue
    if (rows.some(t => t.currency !== rows[0].currency || !(t.amount > 0))) continue

    const amounts = rows.map(t => t.amount)
    const total = toMajor(amounts.reduce((s, a) => s + toMinor(a), 0))
    const legacy = splitMoney(total, n)
    if (!legacy.every((a, i) => toMinor(a) === toMinor(amounts[i]))) continue
    const bank = splitInstallments(total, n)
    const changes = rows
      .map((tx, i) => ({ tx, amount: bank[i] }))
      .filter(c => toMinor(c.amount) !== toMinor(c.tx.amount))
    if (changes.length === 0) continue
    fixes.push({ groupId, description: rows[0].description, total, changes })
  }
  return fixes
}

/* ────────────────────────────────────────────────────────────────────────
   Taksitli satın almaların RAPOR görünümü

   Defterde 12 taksitli bir alışveriş 12 ayrı satırdır (her ay bir taksit) —
   bakiye, kredi kartı limiti ve gerçek nakit akışı bunu gerektirir. Ama
   raporda kullanıcının sorduğu soru farklıdır: "bu harcamayı ne zaman
   yaptım?" 12 aya bölünmüş 12 küçük gider değil, SATIN ALMA AYINA yazılmış
   tek bir toplam giderdir.

   collapseInstallments aynı `installGroupId`'ye sahip satırları tek bir
   türev satıra indirger:
     • tarih  = ilk taksitin (satın almanın) tarihi
     • tutar  = grubun TAMAMININ toplamı — gelecek tarihli taksitler DAHİL
                (taksitler onay beklemez); taahhüt ilk gün verilmiştir (aynı mantık
                calcAvailableCredit'te de var: taksitli alım limitten ilk gün
                tam tutarıyla düşer)

   DİKKAT:
   • Yalnız ANALİTİK yüzeylerde kullanılır (Raporlar / İstatistikler).
     Bakiye, net varlık trendi ve limit hesapları HAM `transactions` okumaya
     devam ETMELİ — oradaki gerçek para hareketi aylara yayılmıştır.
   • Dönen satırlar bellekte üretilen türevlerdir; ASLA yazılmaz/senkronlanmaz.
     `id` gerçek ilk taksit satırının id'sidir → listedeki düzenle/sil
     eylemleri store'daki gerçek satırı bulur (taksitli grup zaten topluca
     düzenlenir ve silinir, bkz. updateInstallmentGroup / remove).
   • `installIndex` düşürülür: rozet "(3/12)" yerine "12 taksit" gösterir —
     satır artık tek bir taksiti değil satın almanın tamamını temsil eder.
   • Taksitli olmayan satırlar aynen geçer; hiç taksitli grup yoksa GİRDİ
     DİZİSİNİN KENDİSİ döner (aşağı akıştaki useMemo'lar için referans
     kararlılığı).
──────────────────────────────────────────────────────────────────────── */
export function collapseInstallments(transactions: Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (!t.installGroupId) continue
    const rows = groups.get(t.installGroupId)
    if (rows) rows.push(t)
    else groups.set(t.installGroupId, [t])
  }
  if (groups.size === 0) return transactions

  const collapsed = new Map<string, Transaction>()
  for (const [groupId, rows] of groups) {
    // Satın alma satırı = en küçük installIndex; eşitlik/eksiklik halinde en
    // erken tarih. Grubun tüm ortak alanları (hesap, kategori, etiket, kişi)
    // bu satırdan miras alınır.
    let head = rows[0]
    for (const t of rows) {
      const ti = t.installIndex ?? Number.MAX_SAFE_INTEGER
      const hi = head.installIndex ?? Number.MAX_SAFE_INTEGER
      if (ti < hi || (ti === hi && t.date < head.date)) head = t
    }
    // Kuruş-exact toplama (S8); amountTry TRY-normalize toplam (S2/S3) —
    // aggregator'lar baseAmount okur, ham `amount` da tutarlı kalsın diye
    // ikisi birden toplanır (grup içi tüm satırlar aynı para birimindedir).
    let amountMinor = 0
    let baseMinor   = 0
    for (const t of rows) {
      amountMinor += toMinor(t.amount)
      baseMinor   += toMinor(baseAmount(t))
    }
    const amount = toMajor(amountMinor)
    collapsed.set(groupId, {
      ...head,
      amount,
      amountTry:    toMajor(baseMinor),
      categorySplits: groupCategorySplits(head, rows),
      installTotal: head.installTotal ?? rows.length,
      installIndex: undefined,
    })
  }

  // Grubun ilk rastlanan satırının YERİNE indirgenmiş satır konur, kalanlar
  // düşer — dizinin geri kalan sırası korunur.
  const out: Transaction[] = []
  const emitted = new Set<string>()
  for (const t of transactions) {
    if (!t.installGroupId) { out.push(t); continue }
    if (emitted.has(t.installGroupId)) continue
    emitted.add(t.installGroupId)
    out.push(collapsed.get(t.installGroupId)!)
  }
  return out
}

/* Kategori payları da grup toplamına taşınmalı: her taksit satırının payları
   O TAKSİTİN tutarına göre ölçeklidir (addInstallmentGroup → rescaleSplits).
   Baş satırın paylarını olduğu gibi devralmak, payların toplamını (~1 taksit)
   indirgenmiş tutardan (tüm taksitler) koparıyordu; txCategorySlices amountTry'yi
   pay/tutar oranıyla bölüp KALANI son paya yazdığı için son kategori neredeyse
   tüm alışverişi üstleniyordu (ör. 2.199₺'lik mutfak payı 13.944₺ görünüyordu).
   Paylar kategori bazında taksitler boyunca toplanır; tutmazsa (eksik/bozuk
   pay) baş satırın oranlarıyla toplama ölçeklenir. İşlem formu da taksitli
   grubun paylarını buradan okur — liste ile form aynı sayıyı gösterir. */
export function groupCategorySplits(head: Transaction, rows: readonly Transaction[]): CategorySplit[] | undefined {
  if (!head.categorySplits || head.categorySplits.length < 2) return head.categorySplits
  let amountMinor = 0
  for (const t of rows) amountMinor += toMinor(t.amount)
  const byCat = new Map<string, number>()
  for (const s of head.categorySplits) byCat.set(s.categoryId, 0)
  let ok = true
  for (const t of rows) {
    const parts = t.categorySplits?.length
      ? t.categorySplits
      : t.categoryId ? [{ categoryId: t.categoryId, amount: t.amount }] : []
    if (parts.length === 0) { ok = false; break }
    for (const s of parts) byCat.set(s.categoryId, (byCat.get(s.categoryId) ?? 0) + toMinor(s.amount))
  }
  if (ok) {
    let sum = 0
    for (const m of byCat.values()) sum += m
    if (sum === amountMinor) {
      const merged = [...byCat.entries()]
        .filter(([, m]) => m !== 0)
        .map(([categoryId, m]) => ({ categoryId, amount: toMajor(m) }))
      return merged.length > 1 ? merged : undefined
    }
  }
  return rescaleSplits(head.categorySplits, toMajor(amountMinor))
}

/* ────────────────────────────────────────────────────────────────────────
   Taksitli + bölünmüş alışverişlerde kategori payı onarımı (tek seferlik)

   Eskiden satın alma düzeyindeki paylar her taksitte AYRI yuvarlanıyordu
   (rescaleSplits): r_ij = round(a_i × s_j / T). Kategori toplamları kuruş
   kayıyordu (2.199,00₺'lik pay → 2.198,98₺). Şimdiki kayıt yolu
   splitsForInstallments ile tam dağıtır; bu tarayıcı eski grupları bulur.

   Girilen pay s_j kayıtlı satırlardan GERİ ÇÖZÜLÜR: her taksit için
   (r_ij − ½)·T/a_i ≤ s_j < (r_ij + ½)·T/a_i (kuruş biriminde). Aralıkların
   kesişimindeki adaylardan en "yuvarlak" olan seçilir (tam lira > 10 kuruş >
   diğer), eşitlikte bugünkü toplama en yakın. Son kategori kalanı alır
   (rescaleSplits'te de kalan son paya yazılıyordu).

   Kesişimi boş olan grup (ör. sonradan tek taksiti elle değiştirilmiş) tahmin
   edilmez; `unresolved` listesinde döner, elle düzenlenmesi için gösterilir.
──────────────────────────────────────────────────────────────────────── */
export interface InstallmentSplitFix {
  groupId: string
  description: string
  currency: Transaction['currency']
  total: number
  /** Kategori bazında bugünkü toplam → onarılmış toplam (yalnızca değişenler). */
  categories: { categoryId: string; from: number; to: number }[]
  /** Satırlar ve yeni payları (yalnızca payı değişen satırlar). */
  changes: { tx: Transaction; splits: CategorySplit[] }[]
}

export interface InstallmentSplitScan {
  fixes: InstallmentSplitFix[]
  /** Payları kayıtlı taksitlerden tutarlı biçimde geri çözülemeyen gruplar. */
  unresolved: { groupId: string; description: string }[]
}

function sameSplits(a: readonly CategorySplit[] | undefined, b: readonly CategorySplit[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((s, i) => s.categoryId === b[i].categoryId && toMinor(s.amount) === toMinor(b[i].amount))
}

/** Yuvarlaklık puanı: tam lira 2, 10 kuruş 1, diğer 0. */
function roundness(minor: number): number {
  return minor % 100 === 0 ? 2 : minor % 10 === 0 ? 1 : 0
}

export function findInstallmentSplitFixes(transactions: readonly Transaction[]): InstallmentSplitScan {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (!t.installGroupId || t.deleted_at) continue
    const g = groups.get(t.installGroupId)
    if (g) g.push(t)
    else groups.set(t.installGroupId, [t])
  }

  const fixes: InstallmentSplitFix[] = []
  const unresolved: InstallmentSplitScan['unresolved'] = []

  for (const [groupId, rows] of groups) {
    if (rows.length < 2) continue
    rows.sort((a, b) => (a.installIndex ?? 0) - (b.installIndex ?? 0))
    const head = rows[0]
    if (!head.categorySplits || head.categorySplits.length < 2) continue
    const order = head.categorySplits.map(s => s.categoryId)
    const amounts = rows.map(t => t.amount)
    const aMinor = amounts.map(toMinor)
    const T = aMinor.reduce((x, y) => x + y, 0)

    // Yalnız pozitif tutarlı, her satırı aynı kategori sırasıyla bölünmüş gruplar.
    const shapeOk = T > 0 && aMinor.every(a => a > 0) && rows.every(t =>
      t.categorySplits?.length === order.length &&
      t.categorySplits.every((s, i) => s.categoryId === order[i] && toMinor(s.amount) >= 0))
    if (!shapeOk) {
      // Bölünmüş ama tutarlı biçimde çözülemeyen grup → elle bakılsın.
      if (rows.some(t => (t.categorySplits?.length ?? 0) > 1)) unresolved.push({ groupId, description: head.description })
      continue
    }

    const current = order.map((_, j) => rows.reduce((acc, t) => acc + toMinor(t.categorySplits![j].amount), 0))
    // Satırlar YENİ kayıt yoluyla (splitsForInstallments) da üretilmiş olabilir.
    // Bugünkü toplamlar o yolla satırları birebir veriyorsa bugünkü toplam da
    // geçerli bir adaydır — eşit yuvarlaklıkta mesafesi 0 olduğu için kazanır.
    const exact = splitsForInstallments(order.map((categoryId, j) => ({ categoryId, amount: toMajor(current[j]) })), amounts)
    const newPathOk = rows.every((t, i) => sameSplits(t.categorySplits, exact[i]))

    // Son kategori dışındakileri ESKİ yoldan (satır satır yuvarlama) geri çöz.
    const target: number[] = []
    let legacyOk = true
    for (let j = 0; j < order.length - 1 && legacyOk; j++) {
      let lo = -Infinity
      let hi = Infinity
      for (let i = 0; i < rows.length; i++) {
        const r = toMinor(rows[i].categorySplits![j].amount)
        lo = Math.max(lo, ((r - 0.5) * T) / aMinor[i])
        hi = Math.min(hi, ((r + 0.5) * T) / aMinor[i])
      }
      let best: number | null = null
      for (let c = Math.max(0, Math.ceil(lo - 1e-9)); c < hi - 1e-9; c++) {
        if (best === null) { best = c; continue }
        const rc = roundness(c)
        const rb = roundness(best)
        if (rc > rb || (rc === rb && Math.abs(c - current[j]) < Math.abs(best - current[j]))) best = c
      }
      if (best === null) legacyOk = false
      else target.push(best)
    }
    if (!legacyOk) {
      // Eski yolla açıklanamıyor: yeni yolla tutarlıysa zaten doğrudur, değilse elle bakılsın.
      if (!newPathOk) unresolved.push({ groupId, description: head.description })
      continue
    }
    // İki yolla da açıklanabiliyorsa bugünkü toplam da aday: daha yuvarlak değilse
    // değiştirilmez (yeni kaydedilmiş, kasıtlı kuruşlu payları korur).
    if (newPathOk) {
      for (let j = 0; j < target.length; j++) {
        if (roundness(current[j]) >= roundness(target[j])) target[j] = current[j]
      }
    }
    const lastMinor = T - target.reduce((x, y) => x + y, 0)
    if (lastMinor < 0) {
      unresolved.push({ groupId, description: head.description })
      continue
    }
    target.push(lastMinor)

    const targetSplits = order.map((categoryId, j) => ({ categoryId, amount: toMajor(target[j]) }))
    const next = splitsForInstallments(targetSplits, amounts)
    const categories = order
      .map((categoryId, j) => ({ categoryId, from: toMajor(current[j]), to: toMajor(target[j]) }))
      .filter(c => toMinor(c.from) !== toMinor(c.to))
    // Kategori toplamları zaten doğruysa satır içi dağılımı yeniden yazmaya gerek yok.
    if (categories.length === 0) continue
    const changes = rows
      .map((tx, i) => ({ tx, splits: next[i] }))
      .filter(c => !sameSplits(c.tx.categorySplits, c.splits))
    fixes.push({ groupId, description: head.description, currency: head.currency, total: toMajor(T), categories, changes })
  }
  return { fixes, unresolved }
}
