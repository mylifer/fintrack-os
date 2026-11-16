import type { CategorySplit, Transaction } from '@/types'
import { toMinor, toMajor, splitMoney, splitInstallments } from './money'
import { baseAmount } from './fx'
import { rescaleSplits } from './categorySplits'

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
      categorySplits: collapseSplits(head, rows, amountMinor),
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
   pay) baş satırın oranlarıyla toplama ölçeklenir. */
function collapseSplits(head: Transaction, rows: Transaction[], amountMinor: number): CategorySplit[] | undefined {
  if (!head.categorySplits || head.categorySplits.length < 2) return head.categorySplits
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
