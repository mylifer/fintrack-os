import type { Transaction } from '@/types'
import { toMinor, toMajor } from './money'
import { baseAmount } from './fx'

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
     • tutar  = grubun TAMAMININ toplamı — gelecek tarihli ve onay bekleyen
                taksitler DAHİL; taahhüt ilk gün verilmiştir (aynı mantık
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
    collapsed.set(groupId, {
      ...head,
      amount:       toMajor(amountMinor),
      amountTry:    toMajor(baseMinor),
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
