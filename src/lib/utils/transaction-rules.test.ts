import { describe, it, expect } from 'vitest'
import type { Category, Person, Transaction, TransactionRule } from '@/types'
import {
  textMatches, ruleMatches, findMatchingRule, matchRule, ruleOutcome, sortRules,
  validateRule, mergeTags, transactionsMatchingRule, ruleChangeFor, previewRuleOnHistory,
  normalizeRulePattern, suggestPatternFrom,
} from './transaction-rules'

const rule = (over: Partial<TransactionRule> = {}): TransactionRule => ({
  id: over.id ?? 'r1',
  pattern: 'migros',
  matchKind: 'contains',
  sortOrder: 1,
  isActive: true,
  categoryId: 'c-market',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
})

const cat = (id: string, scope: Category['scope'] = 'expense', over: Partial<Category> = {}): Category => ({
  id, name: id, icon: 'x', color: '#000', scope, isSystem: false, sortOrder: 0, ...over,
})

const categories: Category[] = [
  cat('c-market'), cat('c-yemek'), cat('c-maas', 'income'), cat('c-eski', 'expense', { isArchived: true }),
]

const people: Person[] = [
  { id: 'p-migros', name: 'Migros', role: 'recipient', createdAt: '2026-01-01' },
  { id: 'p-arsiv', name: 'Eski', role: 'recipient', createdAt: '2026-01-01', isArchived: true },
  { id: 'p-es', name: 'Eş', role: 'family_member', createdAt: '2026-01-01' },
]

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: over.id ?? 't1', type: 'expense', amount: 250, currency: 'TRY', date: '2026-10-01',
  accountId: 'a1', description: 'Migros Kadıköy', isInstallment: false,
  createdAt: '2026-10-01', updatedAt: '2026-10-01', ...over,
})

describe('textMatches — Türkçe duyarlı, harf büyüklüğü duyarsız', () => {
  it('içerir / ile başlar / tam eşit', () => {
    expect(textMatches('contains', 'migros', 'Market MIGROS Kadıköy')).toBe(true)
    expect(textMatches('startsWith', 'migros', 'Market MIGROS')).toBe(false)
    expect(textMatches('startsWith', 'MİGROS', 'migros jet 123')).toBe(true)
    expect(textMatches('equals', 'Migros', '  MIGROS ')).toBe(true)
    expect(textMatches('equals', 'Migros', 'Migros Jet')).toBe(false)
  })

  it('İ/ı/I ve Türkçe karakterler bankanın ASCII yazımını tutar', () => {
    expect(textMatches('contains', 'Şok Market', 'SOK MARKET ISTANBUL')).toBe(true)
    expect(textMatches('contains', 'şok', 'ŞOK MARKET')).toBe(true)
    expect(textMatches('contains', 'İstanbul', 'ISTANBUL')).toBe(true)
    expect(textMatches('contains', 'ığdır', 'IGDIR')).toBe(true)
    expect(textMatches('equals', 'çiçekçi', 'CICEKCI')).toBe(true)
    expect(textMatches('contains', 'öğle', 'OGLE YEMEGI')).toBe(true)
  })

  it('fazla boşluklar tekilleşir; boş desen hiçbir şeyle eşleşmez', () => {
    expect(textMatches('contains', 'migros   jet', 'MIGROS JET')).toBe(true)
    expect(textMatches('contains', '   ', 'herhangi')).toBe(false)
    expect(textMatches('equals', '', '')).toBe(false)
  })
})

describe('ruleMatches — koşullar', () => {
  it('etkin olmayan ya da silinmiş kural eşleşmez', () => {
    expect(ruleMatches(rule({ isActive: false }), tx())).toBe(false)
    expect(ruleMatches(rule({ deleted_at: '2026-11-02T00:00:00Z' }), tx())).toBe(false)
  })

  it('transfer kapsam dışıdır', () => {
    expect(ruleMatches(rule(), tx({ type: 'transfer' }))).toBe(false)
  })

  it('hesap koşulu', () => {
    expect(ruleMatches(rule({ accountId: 'a1' }), tx())).toBe(true)
    expect(ruleMatches(rule({ accountId: 'a2' }), tx())).toBe(false)
    expect(ruleMatches(rule({ accountId: null }), tx({ accountId: 'a9' }))).toBe(true)
  })

  it('tür koşulu', () => {
    expect(ruleMatches(rule({ txType: 'expense' }), tx())).toBe(true)
    expect(ruleMatches(rule({ txType: 'income' }), tx())).toBe(false)
  })

  it('tutar aralığı: mutlak tutar, uçlar dahil, kuruş hassasiyetinde', () => {
    expect(ruleMatches(rule({ minAmount: 250 }), tx())).toBe(true)
    expect(ruleMatches(rule({ maxAmount: 250 }), tx())).toBe(true)
    expect(ruleMatches(rule({ minAmount: 250.01 }), tx())).toBe(false)
    expect(ruleMatches(rule({ maxAmount: 249.99 }), tx())).toBe(false)
    expect(ruleMatches(rule({ minAmount: 100, maxAmount: 300 }), tx({ amount: -250 }))).toBe(true) // iade
    expect(ruleMatches(rule({ maxAmount: 0.3 }), tx({ amount: 0.1 + 0.2 }))).toBe(true)
  })

  it('tutar bilinmiyorsa tutar koşullu kural eşleşmez, koşulsuz kural eşleşir', () => {
    const s = { description: 'Migros', type: 'expense' as const }
    expect(ruleMatches(rule({ minAmount: 1 }), s)).toBe(false)
    expect(ruleMatches(rule(), s)).toBe(true)
    expect(ruleMatches(rule({ maxAmount: 10 }), { ...s, amount: Number.NaN })).toBe(false)
  })
})

describe('findMatchingRule — sıralı, ilk eşleşen kazanır', () => {
  const general = rule({ id: 'genel', pattern: 'migros', sortOrder: 2, categoryId: 'c-market' })
  const special = rule({ id: 'ozel', pattern: 'migros jet', sortOrder: 1, categoryId: 'c-yemek' })

  it('sortOrder önce gelen kazanır (dizideki sıra değil)', () => {
    expect(findMatchingRule([general, special], tx({ description: 'MIGROS JET ATASEHIR' }))?.id).toBe('ozel')
    expect(findMatchingRule([general, special], tx({ description: 'MIGROS KADIKOY' }))?.id).toBe('genel')
  })

  it('eşit sortOrder: önce oluşturulan', () => {
    const a = rule({ id: 'a', sortOrder: 1, createdAt: '2026-11-02T00:00:00Z' })
    const b = rule({ id: 'b', sortOrder: 1, createdAt: '2026-11-01T00:00:00Z' })
    expect(findMatchingRule([a, b], tx())?.id).toBe('b')
    expect(sortRules([a, b]).map(r => r.id)).toEqual(['b', 'a'])
  })

  it('etkin olmayan kural atlanır, sıradakine düşülür', () => {
    expect(findMatchingRule([{ ...special, isActive: false }, general], tx({ description: 'migros jet' }))?.id).toBe('genel')
  })

  it('eşleşme yoksa undefined', () => {
    expect(findMatchingRule([general], tx({ description: 'Şok' }))).toBeUndefined()
    expect(findMatchingRule([], tx())).toBeUndefined()
  })
})

describe('ruleOutcome / matchRule — geçersiz referanslar ayıklanır', () => {
  it('kategori türle uyuşmalı ve arşivlenmemiş olmalı', () => {
    expect(ruleOutcome(rule(), 'expense', categories).categoryId).toBe('c-market')
    expect(ruleOutcome(rule({ categoryId: 'c-maas' }), 'expense', categories).categoryId).toBeUndefined()
    expect(ruleOutcome(rule({ categoryId: 'c-eski' }), 'expense', categories).categoryId).toBeUndefined()
    expect(ruleOutcome(rule({ categoryId: 'yok' }), 'expense', categories).categoryId).toBeUndefined()
  })

  it('alıcı: arşivli/aile üyesi alıcı sayılmaz; kişi listesi verilmezse olduğu gibi', () => {
    expect(ruleOutcome(rule({ recipientId: 'p-migros' }), 'expense', categories, people).recipientId).toBe('p-migros')
    expect(ruleOutcome(rule({ recipientId: 'p-arsiv' }), 'expense', categories, people).recipientId).toBeUndefined()
    expect(ruleOutcome(rule({ recipientId: 'p-es' }), 'expense', categories, people).recipientId).toBeUndefined()
    expect(ruleOutcome(rule({ recipientId: 'x' }), 'expense', categories).recipientId).toBe('x')
  })

  it('etiketler tekilleşir', () => {
    expect(ruleOutcome(rule({ tags: ['Market', 'market', ' ', 'Ev'] }), 'expense', categories).tags).toEqual(['Market', 'Ev'])
  })

  it('matchRule kuralı ve sonucu birlikte döner', () => {
    const out = matchRule([rule({ tags: ['ev'] })], tx(), categories, people)
    expect(out?.rule.id).toBe('r1')
    expect(out?.categoryId).toBe('c-market')
    expect(out?.tags).toEqual(['ev'])
    expect(matchRule([rule()], tx({ description: 'yok' }), categories)).toBeUndefined()
  })
})

describe('validateRule', () => {
  it('desen ve en az bir eylem zorunlu', () => {
    expect(validateRule({ pattern: ' ', matchKind: 'contains', categoryId: 'c' }).pattern).toBeTruthy()
    expect(validateRule({ pattern: 'x', matchKind: 'contains' }).actions).toBeTruthy()
    expect(validateRule({ pattern: 'x', matchKind: 'contains', tags: [' '] }).actions).toBeTruthy()
    expect(validateRule({ pattern: 'x', matchKind: 'contains', tags: ['ev'] })).toEqual({})
    expect(validateRule({ pattern: 'x', matchKind: 'contains', recipientId: 'p' })).toEqual({})
  })

  it('tutar aralığı tutarlı olmalı', () => {
    expect(validateRule({ pattern: 'x', matchKind: 'contains', categoryId: 'c', minAmount: 10, maxAmount: 5 }).amount).toBeTruthy()
    expect(validateRule({ pattern: 'x', matchKind: 'contains', categoryId: 'c', minAmount: -1 }).amount).toBeTruthy()
    expect(validateRule({ pattern: 'x', matchKind: 'contains', categoryId: 'c', minAmount: 5, maxAmount: 5 })).toEqual({})
  })
})

describe('geçmiş işlemler', () => {
  const txs: Transaction[] = [
    tx({ id: 'boş', categoryId: undefined, date: '2026-10-01' }),
    tx({ id: 'aynı', categoryId: 'c-market', date: '2026-10-02' }),
    tx({ id: 'farklı', categoryId: 'c-yemek', date: '2026-10-03' }),
    tx({ id: 'bölünmüş', categoryId: 'c-yemek', date: '2026-10-04', categorySplits: [{ categoryId: 'c-yemek', amount: 200 }, { categoryId: 'c-market', amount: 50 }] }),
    tx({ id: 'silinmiş', deleted_at: '2026-10-05' }),
    tx({ id: 'transfer', type: 'transfer', toAccountId: 'a2' }),
    tx({ id: 'mutabakat', systemKind: 'reconciliation' }),
    tx({ id: 'ilgisiz', description: 'Şok' }),
  ]

  it('eşleşenler: canlı, transfer/sistem kaydı olmayan; etkin olmayan kural da önizlenir', () => {
    const ids = transactionsMatchingRule(rule({ isActive: false }), txs).map(t => t.id)
    expect(ids).toEqual(['boş', 'aynı', 'farklı', 'bölünmüş'])
  })

  it('kategorisi DOLU ve FARKLI olan da değişiklik listesine girer; bölünmüşün kategorisine dokunulmaz', () => {
    const { matched, changes } = previewRuleOnHistory(rule(), txs, categories)
    expect(matched.map(t => t.id)).toEqual(['bölünmüş', 'farklı', 'aynı', 'boş']) // en yeni önce
    expect(changes.map(c => c.tx.id)).toEqual(['farklı', 'boş'])
    expect(changes[0].patch).toEqual({ categoryId: 'c-market' })
    expect(changes[0].revert).toEqual({ categoryId: 'c-yemek' })
    expect(changes[1].revert).toEqual({ categoryId: null })
  })

  it('etiket eklenir (mevcutlar korunur), alıcı değişir, geri alma eski değerleri taşır', () => {
    const r = rule({ categoryId: null, tags: ['Ev', 'market'], recipientId: 'p-migros' })
    const c = ruleChangeFor(r, tx({ tags: ['Market'], recipientId: null }), categories, people)!
    expect(c.patch).toEqual({ tags: ['Market', 'Ev'], recipientId: 'p-migros' })
    expect(c.revert).toEqual({ tags: ['Market'], recipientId: null })
    // Zaten uygulanmışsa değişiklik yok
    expect(ruleChangeFor(r, tx({ tags: ['ev', 'MARKET'], recipientId: 'p-migros' }), categories, people)).toBeNull()
  })

  it('türle uyuşmayan kategori geçmişe de yazılmaz', () => {
    expect(ruleChangeFor(rule({ categoryId: 'c-maas' }), tx(), categories)).toBeNull()
  })
})

describe('yardımcılar', () => {
  it('mergeTags', () => {
    expect(mergeTags(undefined, ['a'])).toEqual(['a'])
    expect(mergeTags(['A', 'b'], ['a', 'c'])).toEqual(['A', 'b', 'c'])
  })

  it('normalizeRulePattern / suggestPatternFrom', () => {
    expect(normalizeRulePattern('  Migros   Jet ')).toBe('Migros Jet')
    expect(suggestPatternFrom('IKEA KARTAL (2/6)')).toBe('IKEA KARTAL')
    expect(suggestPatternFrom('YEMEKSEPETI 4423156789 ISTANBUL')).toBe('YEMEKSEPETI')
    expect(suggestPatternFrom('Kira')).toBe('Kira')
  })
})
