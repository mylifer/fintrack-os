import type { Category, Person, Transaction, TransactionRule } from '@/types'
import { foldText } from '@/lib/auto-category'
import { dedupeTags, tagKey } from './tags'
import { toMinor } from './money'

/* ── İşlem kuralları (kullanıcı tanımlı otomatik sınıflandırma) ───────────────
   SAF modül: store/DB bilmez.

   Kural = koşullar + eylemler.
     Koşullar  açıklama metni (içerir / ile başlar / tam eşit) ZORUNLU;
               hesap, tür (gider/gelir) ve tutar aralığı isteğe bağlı.
     Eylemler  kategori ata, etiket ekle, alıcı ata (en az biri).

   Karşılaştırma Türkçe duyarlı ve büyük-küçük harf duyarsızdır: iki taraf da
   foldText'ten geçer (tr-TR küçültme + Türkçe harfleri ASCII'ye katlama), böylece
   "MİGROS", "Migros", "MIGROS" ve "migros" aynıdır; banka dökümünün Türkçe
   karaktersiz "SOK MARKET"i "Şok Market" kuralını tutar. Fazla boşluklar tekilleşir.

   Öncelik: kurallar `sortOrder`a göre (eşitlikte oluşturulma sırası) denenir,
   İLK eşleşen kazanır. Kural sonucu, kategori anahtar kelimesi ve alıcı geçmişi
   önerisinden ÖNCE gelir — ama elle seçilmiş değeri asla ezmez (bunu çağıran
   sağlar: form yalnız boş/otomatik alanlara, içe aktarma yalnız önerilere uygular).

   Transferler kural kapsamı dışındadır (kategori/alıcı taşımazlar). */

export type RuleFlowType = Transaction['type']

/** Kuralın denendiği işlem (ya da taslak) — yalnız gereken alanlar. */
export interface RuleSubject {
  description: string
  type: RuleFlowType
  accountId?: string | null
  /** İşlemin kendi para birimindeki tutar (işaret önemsiz; mutlak değer kullanılır).
   *  Bilinmiyorsa tutar koşullu kurallar eşleşmez. */
  amount?: number | null
}

/** Kural sonucunun uygulanabilir kısmı (geçersiz referanslar ayıklanmış). */
export interface RuleOutcome {
  rule: TransactionRule
  categoryId?: string
  tags: string[]
  recipientId?: string
}

export const MATCH_KIND_LABELS: Record<TransactionRule['matchKind'], string> = {
  contains:   'içeriyorsa',
  startsWith: 'ile başlıyorsa',
  equals:     'tam olarak buysa',
}

/** Saklama biçimi: baş/son boşluk atılır, iç boşluklar tekilleşir (yazım korunur). */
export function normalizeRulePattern(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

const isLiveRule = (r: TransactionRule) => !r.deleted_at

/** Değerlendirme sırası: sortOrder, sonra oluşturulma zamanı, sonra id (kararlı). */
export function sortRules<T extends Pick<TransactionRule, 'sortOrder' | 'createdAt' | 'id'>>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) =>
    (a.sortOrder - b.sortOrder) ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Açıklama metni koşulu tutuyor mu (Türkçe duyarlı, harf büyüklüğü duyarsız). */
export function textMatches(kind: TransactionRule['matchKind'], pattern: string, description: string): boolean {
  const pat = foldText(pattern)
  if (!pat) return false
  const text = foldText(description)
  switch (kind) {
    case 'contains':   return text.includes(pat)
    case 'startsWith': return text.startsWith(pat)
    case 'equals':     return text === pat
    default:           return false
  }
}

/** Kural bu işleme uyuyor mu? (Etkin olmayan / silinmiş kural hiçbir şeyle eşleşmez.) */
export function ruleMatches(rule: TransactionRule, subject: RuleSubject): boolean {
  if (!rule.isActive || !isLiveRule(rule)) return false
  if (subject.type === 'transfer') return false
  if (rule.txType && rule.txType !== subject.type) return false
  if (rule.accountId && rule.accountId !== subject.accountId) return false
  const hasMin = rule.minAmount != null && Number.isFinite(rule.minAmount)
  const hasMax = rule.maxAmount != null && Number.isFinite(rule.maxAmount)
  if (hasMin || hasMax) {
    if (subject.amount == null || !Number.isFinite(subject.amount)) return false
    // Kuruş düzeyinde karşılaştırma: 0.1 + 0.2 gibi kayan nokta artıkları uçları kaçırmasın
    const amt = Math.abs(toMinor(subject.amount))
    if (hasMin && amt < Math.abs(toMinor(rule.minAmount!))) return false
    if (hasMax && amt > Math.abs(toMinor(rule.maxAmount!))) return false
  }
  return textMatches(rule.matchKind, rule.pattern, subject.description)
}

/** Sıradaki İLK eşleşen kural (yoksa undefined). */
export function findMatchingRule(rules: readonly TransactionRule[], subject: RuleSubject): TransactionRule | undefined {
  for (const r of sortRules(rules)) if (ruleMatches(r, subject)) return r
  return undefined
}

/** Kategori bu işlem türü için kullanılabilir mi (arşivsiz, kapsamı uygun). */
function usableCategory(id: string | null | undefined, type: RuleFlowType, categories: readonly Category[]): string | undefined {
  if (!id || type === 'transfer') return undefined
  const c = categories.find(x => x.id === id)
  return c && !c.isArchived && !c.deleted_at && c.scope === type ? c.id : undefined
}

function usableRecipient(id: string | null | undefined, people?: readonly Person[]): string | undefined {
  if (!id) return undefined
  if (!people) return id
  const p = people.find(x => x.id === id)
  return p && p.role === 'recipient' && !p.isArchived && !p.deleted_at ? p.id : undefined
}

/** Kuralın bu işlem türünde uygulanabilir sonucu. Silinmiş/arşivlenmiş ya da
 *  türle uyuşmayan kategori, silinmiş/arşivlenmiş alıcı atlanır (kural yine
 *  eşleşmiş sayılır — sıradaki kurala düşülmez, sonuç yalnız eksik kalır). */
export function ruleOutcome(
  rule: TransactionRule,
  type: RuleFlowType,
  categories: readonly Category[],
  people?: readonly Person[],
): RuleOutcome {
  return {
    rule,
    categoryId: usableCategory(rule.categoryId, type, categories),
    tags: dedupeTags(rule.tags ?? []),
    recipientId: usableRecipient(rule.recipientId, people),
  }
}

/** Eşleşen ilk kuralın uygulanabilir sonucu (yoksa undefined). */
export function matchRule(
  rules: readonly TransactionRule[],
  subject: RuleSubject,
  categories: readonly Category[],
  people?: readonly Person[],
): RuleOutcome | undefined {
  const rule = findMatchingRule(rules, subject)
  return rule ? ruleOutcome(rule, subject.type, categories, people) : undefined
}

/** Etiket listesine kural etiketlerini ekler (büyük-küçük harf duyarsız tekil). */
export function mergeTags(current: readonly string[] | null | undefined, add: readonly string[]): string[] {
  return dedupeTags([...(current ?? []), ...add])
}

/* ── Doğrulama ─────────────────────────────────────────────────────────────── */

export type RuleDraft = Pick<TransactionRule, 'pattern' | 'matchKind'> &
  Partial<Pick<TransactionRule, 'accountId' | 'txType' | 'minAmount' | 'maxAmount' | 'categoryId' | 'tags' | 'recipientId'>>

/** Kaydetmeden önce hatalar (alan → mesaj). Boş nesne = geçerli. */
export function validateRule(d: RuleDraft): Partial<Record<'pattern' | 'amount' | 'actions', string>> {
  const errors: Partial<Record<'pattern' | 'amount' | 'actions', string>> = {}
  if (!foldText(d.pattern ?? '')) errors.pattern = 'Aranacak metni yazın'
  const bad = (n: number | null | undefined) => n != null && (!Number.isFinite(n) || n < 0)
  if (bad(d.minAmount) || bad(d.maxAmount)) errors.amount = 'Tutar sıfır ya da pozitif olmalı'
  else if (d.minAmount != null && d.maxAmount != null && d.minAmount > d.maxAmount) errors.amount = 'En az tutar en çok tutardan büyük olamaz'
  if (!d.categoryId && !d.recipientId && !(d.tags ?? []).some(t => t.trim())) errors.actions = 'Kategori, etiket ya da alıcıdan en az birini seçin'
  return errors
}

/* ── Geçmiş işlemler: önizleme ve uygulama ───────────────────────────────────── */

/** Kuralın denenebileceği geçmiş işlem: canlı, transfer/sistem kaydı değil. */
function eligible(t: Transaction): boolean {
  return !t.deleted_at && t.type !== 'transfer' && !t.systemKind && !t.workspaceTransferId
}

/** Bu kuralla (TEK BAŞINA, sıralamadan bağımsız) eşleşen mevcut işlemler. */
export function transactionsMatchingRule(rule: TransactionRule, transactions: readonly Transaction[]): Transaction[] {
  const probe = { ...rule, isActive: true }
  return transactions.filter(t => eligible(t) && ruleMatches(probe, t))
}

export interface RuleHistoryChange {
  tx: Transaction
  /** Yazılacak alanlar (yalnız değişenler) */
  patch: Partial<Pick<Transaction, 'categoryId' | 'tags' | 'recipientId'>>
  /** Geri almada yazılacak ESKİ değerler (aynı anahtarlar; yoksa null) */
  revert: Record<string, unknown>
}

/** Kuralın bir işlemde değiştireceği alanlar (değişiklik yoksa null).
 *  • Bölünmüş (çok kategorili) işlemin kategorisine dokunulmaz — paylar bozulur.
 *  • Etiketler EKLENİR, mevcutlar korunur.
 *  • Alıcı kuralın alıcısıyla değiştirilir (kullanıcı listeyi onaylar). */
export function ruleChangeFor(
  rule: TransactionRule,
  tx: Transaction,
  categories: readonly Category[],
  people?: readonly Person[],
): RuleHistoryChange | null {
  if (!eligible(tx)) return null
  const out = ruleOutcome(rule, tx.type, categories, people)
  const patch: RuleHistoryChange['patch'] = {}
  const revert: Record<string, unknown> = {}
  const split = (tx.categorySplits?.length ?? 0) >= 2
  if (out.categoryId && !split && tx.categoryId !== out.categoryId) {
    patch.categoryId = out.categoryId
    revert.categoryId = tx.categoryId ?? null
  }
  if (out.tags.length) {
    const have = new Set((tx.tags ?? []).map(tagKey))
    if (out.tags.some(t => !have.has(tagKey(t)))) {
      patch.tags = mergeTags(tx.tags, out.tags)
      revert.tags = tx.tags ?? null
    }
  }
  if (out.recipientId && tx.recipientId !== out.recipientId) {
    patch.recipientId = out.recipientId
    revert.recipientId = tx.recipientId ?? null
  }
  return Object.keys(patch).length ? { tx, patch, revert } : null
}

/** Kuralın geçmişe uygulanması önizlemesi: eşleşenler ve bunların içinde
 *  gerçekten değişecek olanlar (en yeni önce). */
export function previewRuleOnHistory(
  rule: TransactionRule,
  transactions: readonly Transaction[],
  categories: readonly Category[],
  people?: readonly Person[],
): { matched: Transaction[]; changes: RuleHistoryChange[] } {
  const matched = transactionsMatchingRule(rule, transactions)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const changes: RuleHistoryChange[] = []
  for (const t of matched) {
    const c = ruleChangeFor(rule, t, categories, people)
    if (c) changes.push(c)
  }
  return { matched, changes }
}

/** "Bu açıklamadan kural oluştur" için öneri metni: banka taksit eki ve sondaki
 *  uzun sayılar (referans/terminal no) atılır. */
export function suggestPatternFrom(description: string): string {
  return normalizeRulePattern(
    description
      .replace(/\(\d+\/\d+\)/g, ' ')
      .replace(/\s*\d{5,}.*$/, ''),
  )
}
