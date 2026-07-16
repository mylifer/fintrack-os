import type { Transaction, Person, Category, Account } from '@/types'

// Türkçe büyük İ/ı dönüşümleri için locale-duyarlı küçük harf ("İşlem" ↔ "işlem").
const lc = (s: string) => s.toLocaleLowerCase('tr-TR')

/**
 * Tüm alanlarda arama: açıklama, satıcı, not, etiket ve tutarın yanı sıra
 * kişi (aile üyesi / alıcı), kategori ve hesap ADLARI da eşleşir.
 * Ad eşleşmeleri önden id kümelerine çevrilir; işlem başına yalnız Set lookup yapılır.
 */
export function makeTxSearchMatcher(
  query: string,
  ctx: { people: Person[]; categories: Category[]; accounts: Account[] },
): (t: Transaction) => boolean {
  const q = lc(query.trim())
  if (!q) return () => true

  const personIds   = new Set(ctx.people.filter(p => lc(p.name).includes(q)).map(p => p.id))
  const categoryIds = new Set(ctx.categories.filter(c => lc(c.name).includes(q)).map(c => c.id))
  const accountIds  = new Set(ctx.accounts.filter(a => lc(a.name).includes(q)).map(a => a.id))

  return t =>
    lc(t.description).includes(q) ||
    (t.merchant != null && lc(t.merchant).includes(q)) ||
    (t.notes    != null && lc(t.notes).includes(q)) ||
    (t.tags?.some(tag => lc(tag).includes(q)) ?? false) ||
    String(t.amount).includes(q) ||
    t.amount.toFixed(2).replace('.', ',').includes(q) ||
    (t.familyMemberId != null && personIds.has(t.familyMemberId)) ||
    (t.recipientId    != null && personIds.has(t.recipientId)) ||
    (t.categoryId     != null && categoryIds.has(t.categoryId)) ||
    accountIds.has(t.accountId) ||
    (t.toAccountId != null && accountIds.has(t.toAccountId))
}
