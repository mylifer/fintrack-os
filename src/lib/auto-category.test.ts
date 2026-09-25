import { describe, it, expect } from 'vitest'
import type { Category, Transaction } from '@/types'
import { keywordCategory, parseKeywords, recipientCategory } from './auto-category'
import { validateImportRows } from './utils/csv'

const cat = (o: Partial<Category>): Category => ({
  id: '', name: '', icon: '', color: '', scope: 'expense', isSystem: false, sortOrder: 0, ...o,
})
const tx = (o: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 10, currency: 'TRY', date: '2026-09-01',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

describe('parseKeywords', () => {
  it('virgülle böler, Türkçe küçük harfe çevirir, boşları ve tekrarları atar', () => {
    expect(parseKeywords(' Migros , ŞOK,, migros ,  A101 ')).toEqual(['migros', 'şok', 'a101'])
    expect(parseKeywords('İSTANBUL KART')).toEqual(['istanbul kart'])
  })
})

describe('keywordCategory', () => {
  const categories = [
    cat({ id: 'market', matchKeywords: ['migros', 'şok'] }),
    cat({ id: 'yakit', matchKeywords: ['migros jet'] }),
    cat({ id: 'maas', scope: 'income', matchKeywords: ['maaş'] }),
    cat({ id: 'eski', isArchived: true, matchKeywords: ['bim'] }),
  ]

  it('açıklamada geçen kelimeye göre, büyük/küçük harf ve Türkçe İ/ı duyarsız', () => {
    expect(keywordCategory('MİGROS Kadıköy', 'expense', categories)).toBe('market')
    expect(keywordCategory('Şok market', 'expense', categories)).toBe('market')
  })

  it('banka dökümündeki ASCII büyük harf metin de eşleşir ("MIGROS", "SOK")', () => {
    expect(keywordCategory('MIGROS KADIKOY', 'expense', categories)).toBe('market')
    expect(keywordCategory('POS SOK MARKET 1234', 'expense', categories)).toBe('market')
  })

  it('birden çok eşleşmede en uzun (en özgül) kelime kazanır', () => {
    expect(keywordCategory('Migros Jet Ataşehir', 'expense', categories)).toBe('yakit')
  })

  it('kapsam uyuşmazsa, kategori arşivliyse ya da transferse öneri yok', () => {
    expect(keywordCategory('Eylül maaşı', 'expense', categories)).toBeUndefined()
    expect(keywordCategory('Eylül maaşı', 'income', categories)).toBe('maas')
    expect(keywordCategory('BIM', 'expense', categories)).toBeUndefined()
    expect(keywordCategory('migros', 'transfer', categories)).toBeUndefined()
    expect(keywordCategory('', 'expense', categories)).toBeUndefined()
  })
})

describe('recipientCategory', () => {
  const categories = [cat({ id: 'kahve' }), cat({ id: 'yemek' }), cat({ id: 'arsiv', isArchived: true }), cat({ id: 'gelir', scope: 'income' })]

  it('alıcıya aynı türde en sık verilen kategori', () => {
    const txs = [
      tx({ recipientId: 'r', categoryId: 'kahve' }),
      tx({ recipientId: 'r', categoryId: 'kahve' }),
      tx({ recipientId: 'r', categoryId: 'yemek' }),
      tx({ recipientId: 'baska', categoryId: 'yemek' }),
      tx({ recipientId: 'baska', categoryId: 'yemek' }),
    ]
    expect(recipientCategory('r', 'expense', txs, categories)).toBe('kahve')
  })

  it('eşitlikte en yeni işlemin kategorisi; arşivli ve tür dışı kategoriler sayılmaz', () => {
    const txs = [
      tx({ recipientId: 'r', categoryId: 'kahve', date: '2026-08-01' }),
      tx({ recipientId: 'r', categoryId: 'yemek', date: '2026-09-10' }),
      tx({ recipientId: 'r', categoryId: 'arsiv' }),
      tx({ recipientId: 'r', categoryId: 'arsiv' }),
      tx({ recipientId: 'r', type: 'income', categoryId: 'gelir' }),
    ]
    expect(recipientCategory('r', 'expense', txs, categories)).toBe('yemek')
    expect(recipientCategory('r', 'income', txs, categories)).toBe('gelir')
    expect(recipientCategory('yok', 'expense', txs, categories)).toBeUndefined()
  })
})

describe('içe aktarma — kategori sütunu yoksa anahtar kelime kuralı', () => {
  it('eşleşmeyen/boş kategori kurala düşer; açık kategori adı önceliklidir', () => {
    const categories = [cat({ id: 'market', name: 'Market', matchKeywords: ['migros'] }), cat({ id: 'diger', name: 'Diğer' })]
    const mapping = { date: 'd', description: 'a', amount: 't', type: 'y', category: 'k' }
    const { valid } = validateImportRows([
      { d: '2026-09-01', a: 'MIGROS KADIKOY', t: '120', y: 'gider', k: '' },
      { d: '2026-09-01', a: 'MIGROS KADIKOY', t: '120', y: 'gider', k: 'Diğer' },
    ], mapping, categories)
    expect(valid.map(v => v.categoryId)).toEqual(['market', 'diger'])
  })
})
