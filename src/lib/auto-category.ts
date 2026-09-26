import type { Category, Transaction } from '@/types'

/* ── Otomatik kategori ────────────────────────────────────────────────────────
   İki kaynak, ikisi de yalnızca kategori BOŞKEN (ya da önceki otomatik seçim
   hâlâ duruyorken) devreye girer — kullanıcının elle seçtiği kategori asla
   ezilmez (bkz. TransactionFormModal):

   1) Anahtar kelime kuralı — kategoriye tanımlı `matchKeywords`'ten biri işlem
      açıklamasında geçiyorsa. Kullanıcının açık talimatıdır, önce gelir.
   2) Alıcı geçmişi — seçilen alıcıya aynı türdeki işlemlerde en sık verilen
      kategori. 2026-09 verisinde harcamaların ~%80'i alıcının en sık
      kategorisine düşüyordu; 143 alıcının 131'i hep tek kategoride.

   Arşivlenmiş ya da işlem türüyle kapsamı uyuşmayan kategoriler önerilmez. */

type FlowType = Transaction['type']

/** Türkçe duyarlı küçük harf + fazla boşlukların tekilleştirilmesi (saklama
 *  biçimi — kullanıcı "şok" yazdıysa "şok" görünür). */
export function normalizeKeyword(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim()
}

const ASCII_FOLD: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' }

/** Eşleştirme biçimi: Türkçe harfler ASCII karşılığına katlanır. Banka
 *  dökümleri büyük harf ve Türkçe karaktersiz gelir ("MIGROS", "SOK MARKET"):
 *  tr-TR küçültmesi "MIGROS"u "mıgros" yapar ve "migros" kuralını kaçırırdı. */
export function foldText(s: string): string {
  return normalizeKeyword(s).replace(/[ışğüöçâîû]/g, ch => ASCII_FOLD[ch])
}

/** Virgülle ayrılmış girdiyi temiz, tekil bir anahtar kelime listesine çevirir. */
export function parseKeywords(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const k = normalizeKeyword(part)
    if (k && !out.includes(k)) out.push(k)
  }
  return out
}

function usable(c: Category, type: FlowType): boolean {
  return !c.isArchived && type !== 'transfer' && c.scope === type
}

/** Açıklamada geçen anahtar kelimeye göre kategori. Birden çok kural eşleşirse
 *  EN UZUN kelime kazanır ("migros jet" > "migros") — daha özgül olan odur. */
export function keywordCategory(
  description: string,
  type: FlowType,
  categories: Category[],
): string | undefined {
  const text = foldText(description)
  if (!text) return undefined
  let best: { id: string; len: number } | undefined
  for (const c of categories) {
    if (!usable(c, type) || !c.matchKeywords?.length) continue
    for (const k of c.matchKeywords) {
      const kw = foldText(k)
      if (kw && text.includes(kw) && (!best || kw.length > best.len)) best = { id: c.id, len: kw.length }
    }
  }
  return best?.id
}

/** Alıcıya geçmişte (aynı türde) en sık verilen kategori. Bölünmüş işlemler
 *  baskın payın kategorisini taşır (categoryId), o sayılır. Eşitlikte en
 *  yeni işlemin kategorisi kazanır. */
export function recipientCategory(
  recipientId: string,
  type: FlowType,
  transactions: Transaction[],
  categories: Category[],
): string | undefined {
  const byId = new Map(categories.map(c => [c.id, c]))
  const tally = new Map<string, { count: number; last: string }>()
  for (const tx of transactions) {
    if (tx.recipientId !== recipientId || tx.type !== type || !tx.categoryId) continue
    const cat = byId.get(tx.categoryId)
    if (!cat || !usable(cat, type)) continue
    const t = tally.get(tx.categoryId)
    if (t) {
      t.count++
      if (tx.date > t.last) t.last = tx.date
    } else {
      tally.set(tx.categoryId, { count: 1, last: tx.date })
    }
  }
  let best: [string, { count: number; last: string }] | undefined
  for (const entry of tally) {
    if (!best || entry[1].count > best[1].count || (entry[1].count === best[1].count && entry[1].last > best[1].last)) {
      best = entry
    }
  }
  return best?.[0]
}
