import type { Account, Category, Person, Transaction } from '@/types'
import { makeTxSearchMatcher } from './txSearch'

/* ── Genel arama (komut paleti) — saf mantık ─────────────────────────────
   React'ten ve store'lardan bağımsız: veriyi parametre olarak alır, gruplu ve
   sıralı sonuç döndürür. İşlemler için mevcut txSearch eşleyicisi kullanılır
   (işlemler sayfasıyla aynı kurallar); diğer varlıklar ad üzerinden puanlanır. */

export type SearchKind = 'page' | 'account' | 'category' | 'person' | 'transaction'

export interface SearchPage {
  href: string
  label: string
  group?: string
}

export interface SearchHit {
  /** Liste anahtarı — tür + id */
  key: string
  kind: SearchKind
  id: string
  label: string
  /** İkincil satır (grup, üst kategori, rol, tarih…) */
  detail?: string
  /** Gidilecek yol; işlemlerde yok (düzenleme penceresi açılır) */
  href?: string
  /** Yalnız kind === 'transaction' */
  tx?: Transaction
  score: number
}

export interface SearchSection {
  kind: SearchKind
  title: string
  hits: SearchHit[]
}

export interface GlobalSearchData {
  pages: SearchPage[]
  accounts: Account[]
  categories: Category[]
  people: Person[]
  transactions: Transaction[]
}

export type SearchLimits = Record<SearchKind, number>

export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  page: 6, account: 5, category: 5, person: 5, transaction: 8,
}

/** İşlem araması bu uzunluktan kısa sorguda çalışmaz: tek harf/rakam
 *  ("1") neredeyse her tutarla eşleşip listeyi anlamsızca doldurur. */
export const TX_MIN_QUERY = 2

const SECTION_TITLES: Record<SearchKind, string> = {
  page: 'Sayfalar',
  account: 'Hesaplar',
  category: 'Kategoriler',
  person: 'Kişiler',
  transaction: 'İşlemler',
}

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }

/** Türkçe duyarlı küçük harf + aksan katlama: "Ödeme" ≈ "odeme", "İŞLEM" ≈ "islem".
 *  Mobil klavyede Türkçe karakter yazmadan da bulunabilsin diye. */
export function foldTr(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]/g, ch => FOLD[ch] ?? ch)
}

/**
 * Metnin sorguya uygunluk puanı (0 = eşleşmedi). Sorgu da katlanır
 * (foldTr idempotent — önceden katlanmış sorgu da verilebilir).
 * Tam eşleşme > baştan eşleşme > kelime başı > herhangi bir yerde.
 * Çok kelimeli sorguda her kelime ayrı ayrı geçmeli; puan en zayıf kelimeninki.
 */
export function scoreText(query: string, text: string): number {
  const q = foldTr(query.trim())
  if (!q) return 0
  const t = foldTr(text)
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  const words = q.split(/\s+/)
  let min = Infinity
  for (const w of words) {
    let s = 0
    if (t.startsWith(w)) s = 70
    else if (new RegExp(`(^|[\\s\\-/(.,&])${escapeRe(w)}`).test(t)) s = 60
    else if (t.includes(w)) s = 40
    if (s === 0) return 0
    min = Math.min(min, s)
  }
  return words.length > 1 ? min - 5 : min
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Puana göre azalan, eşitlikte ada göre (tr) sıralar ve sınırı uygular. */
function rank(hits: SearchHit[], limit: number): SearchHit[] {
  return hits
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'tr'))
    .slice(0, limit)
}

/** Arşivli kayıtlar bulunur ama canlıların arkasına düşer. */
const ARCHIVED_PENALTY = 15

export function globalSearch(
  query: string,
  data: GlobalSearchData,
  limits: SearchLimits = DEFAULT_SEARCH_LIMITS,
): SearchSection[] {
  const raw = query.trim()

  // Boş sorgu: tüm sayfalar (hızlı gezinme listesi), sıralama nav sırasıyla.
  if (!raw) {
    return [{
      kind: 'page',
      title: SECTION_TITLES.page,
      hits: data.pages.map(p => ({
        key: `page:${p.href}`, kind: 'page' as const, id: p.href,
        label: p.label, detail: p.group, href: p.href, score: 0,
      })),
    }]
  }

  const q = foldTr(raw)
  const sections: SearchSection[] = []
  const push = (kind: SearchKind, hits: SearchHit[]) => {
    const ranked = rank(hits, limits[kind])
    if (ranked.length) sections.push({ kind, title: SECTION_TITLES[kind], hits: ranked })
  }

  // ── Sayfalar: ad ya da grup başlığı ──
  push('page', data.pages.flatMap(p => {
    const score = Math.max(scoreText(q, p.label), p.group ? scoreText(q, p.group) - 30 : 0)
    return score > 0
      ? [{ key: `page:${p.href}`, kind: 'page' as const, id: p.href, label: p.label, detail: p.group, href: p.href, score }]
      : []
  }))

  // ── Hesaplar ──
  push('account', data.accounts.flatMap(a => {
    const s = scoreText(q, a.name)
    if (!s) return []
    return [{
      key: `account:${a.id}`, kind: 'account' as const, id: a.id, label: a.name,
      detail: a.isArchived ? 'Arşivli' : undefined,
      href: `/accounts/${a.id}`, score: s - (a.isArchived ? ARCHIVED_PENALTY : 0),
    }]
  }))

  // ── Kategoriler: alt kategoride üst kategori adı ikincil satırda ──
  const catById = new Map(data.categories.map(c => [c.id, c]))
  push('category', data.categories.flatMap(c => {
    const s = scoreText(q, c.name)
    if (!s) return []
    const parent = c.parentId ? catById.get(c.parentId)?.name : undefined
    const detail = [parent, c.isArchived ? 'Arşivli' : undefined].filter(Boolean).join(' · ') || undefined
    return [{
      key: `category:${c.id}`, kind: 'category' as const, id: c.id, label: c.name, detail,
      href: `/categories/${c.id}`, score: s - (c.isArchived ? ARCHIVED_PENALTY : 0),
    }]
  }))

  // ── Kişiler: aile üyeleri ve alıcılar ──
  push('person', data.people.flatMap(p => {
    const s = scoreText(q, p.name)
    if (!s) return []
    const fam = p.role === 'family_member'
    return [{
      key: `person:${p.id}`, kind: 'person' as const, id: p.id, label: p.name,
      detail: [fam ? 'Aile üyesi' : 'Alıcı', p.isArchived ? 'Arşivli' : undefined].filter(Boolean).join(' · '),
      href: `${fam ? '/aile-uyeleri' : '/alicilar'}/${p.id}`,
      score: s - (p.isArchived ? ARCHIVED_PENALTY : 0),
    }]
  }))

  // ── İşlemler: eşleşme kuralı txSearch'ten; açıklamada doğrudan geçenler
  //    öne, eşitlikte en yeni tarih önce. ──
  if (raw.length >= TX_MIN_QUERY) {
    const match = makeTxSearchMatcher(raw, {
      people: data.people, categories: data.categories, accounts: data.accounts,
    })
    const accName = new Map(data.accounts.map(a => [a.id, a.name]))
    const hits: SearchHit[] = []
    for (const t of data.transactions) {
      if (!match(t)) continue
      const direct = Math.max(scoreText(q, t.description), t.merchant ? scoreText(q, t.merchant) : 0)
      hits.push({
        key: `transaction:${t.id}`, kind: 'transaction', id: t.id,
        label: t.description || t.merchant || '(Açıklamasız)',
        detail: [t.date, accName.get(t.accountId)].filter(Boolean).join(' · '),
        tx: t,
        score: direct || 10,
      })
    }
    const ranked = hits
      .sort((a, b) => b.score - a.score || b.tx!.date.localeCompare(a.tx!.date))
      .slice(0, limits.transaction)
    if (ranked.length) sections.push({ kind: 'transaction', title: SECTION_TITLES.transaction, hits: ranked })
  }

  return sections
}

/** Bölümleri klavye gezintisi için tek düz listeye çevirir. */
export function flattenSections(sections: SearchSection[]): SearchHit[] {
  return sections.flatMap(s => s.hits)
}
