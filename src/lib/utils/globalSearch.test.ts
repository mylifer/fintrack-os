import { describe, it, expect } from 'vitest'
import type { Account, Category, Person, Transaction } from '@/types'
import { foldTr, scoreText, globalSearch, flattenSections, TX_MIN_QUERY, type GlobalSearchData } from './globalSearch'

const acc = (id: string, name: string, extra: Partial<Account> = {}) => ({
  id, name, type: 'checking', currency: 'TRY', balance: 0, initialBalance: 0, color: '#000',
  isArchived: false, createdAt: '2026-01-01', ...extra,
}) as Account

const cat = (id: string, name: string, extra: Partial<Category> = {}) => ({
  id, name, icon: '🛒', color: '#000', scope: 'expense', isSystem: false, sortOrder: 0, ...extra,
}) as Category

const person = (id: string, name: string, role: Person['role']) =>
  ({ id, name, role, createdAt: '2026-01-01' }) as Person

const tx = (id: string, description: string, date: string, extra: Partial<Transaction> = {}) => ({
  id, description, date, type: 'expense', amount: 100, currency: 'TRY', accountId: 'a1', ...extra,
}) as Transaction

const data: GlobalSearchData = {
  pages: [
    { href: '/dashboard', label: 'Ana Sayfa', group: 'Genel' },
    { href: '/payments', label: 'Ödeme Takibi', group: 'Planlama' },
    { href: '/debts', label: 'Borçlar', group: 'Planlama' },
    { href: '/settings', label: 'Ayarlar', group: 'Sistem' },
  ],
  accounts: [acc('a1', 'İş Bankası Maaş'), acc('a2', 'Eski Kart', { isArchived: true }), acc('a3', 'Kart Bonus')],
  categories: [cat('c1', 'Market'), cat('c2', 'Süpermarket', { parentId: 'c1' })],
  people: [person('p1', 'Ayşe', 'family_member'), person('p2', 'Migros', 'recipient')],
  transactions: [
    tx('t1', 'Migros alışveriş', '2026-10-01', { recipientId: 'p2', amount: 250.5 }),
    tx('t2', 'Kira', '2026-10-05', { amount: 12000 }),
    tx('t3', 'Market harcaması', '2026-11-01', { categoryId: 'c1' }),
    tx('t4', 'Migros', '2026-09-01'),
  ],
}

describe('foldTr / scoreText', () => {
  it('Türkçe harfleri katlar (İ/ı dahil)', () => {
    expect(foldTr('İŞLEM Ödeme ığüç')).toBe('islem odeme iguc')
  })

  it('tam > baştan > kelime başı > içinde', () => {
    expect(scoreText('market', 'Market')).toBe(100)
    expect(scoreText('mar', 'Market')).toBe(80)
    expect(scoreText('bon', 'Kart Bonus')).toBe(60)
    expect(scoreText('rket', 'Market')).toBe(40)
    expect(scoreText('xyz', 'Market')).toBe(0)
  })

  it('çok kelimeli sorguda her kelime geçmeli', () => {
    expect(scoreText('iş maaş', 'İş Bankası Maaş')).toBeGreaterThan(0)
    expect(scoreText('iş kira', 'İş Bankası Maaş')).toBe(0)
  })
})

describe('globalSearch', () => {
  it('boş sorgu tüm sayfaları nav sırasıyla döndürür', () => {
    const s = globalSearch('  ', data)
    expect(s).toHaveLength(1)
    expect(s[0].hits.map(h => h.href)).toEqual(['/dashboard', '/payments', '/debts', '/settings'])
  })

  it('Türkçe karaktersiz yazımla sayfa bulur', () => {
    const hits = flattenSections(globalSearch('odeme', data))
    expect(hits[0]).toMatchObject({ kind: 'page', href: '/payments' })
  })

  it('grup başlığıyla eşleşme ad eşleşmesinin arkasında kalır', () => {
    const pages = globalSearch('planlama', data).find(s => s.kind === 'page')!.hits
    expect(pages.map(h => h.href)).toEqual(['/debts', '/payments']) // eşit puan → ada göre
  })

  it('arşivli hesap canlının arkasına düşer ve işaretlenir', () => {
    const accounts = globalSearch('kart', data).find(s => s.kind === 'account')!.hits
    expect(accounts.map(h => h.id)).toEqual(['a3', 'a2'])
    expect(accounts[1].detail).toBe('Arşivli')
    expect(accounts[0].href).toBe('/accounts/a3')
  })

  it('kişi rolüne göre doğru detay yoluna gider', () => {
    const people = flattenSections(globalSearch('ayşe', data)).filter(h => h.kind === 'person')
    expect(people[0].href).toBe('/aile-uyeleri/p1')
    const rec = flattenSections(globalSearch('migros', data)).find(h => h.kind === 'person')!
    expect(rec.href).toBe('/alicilar/p2')
  })

  it('alt kategoride üst kategori adı detayda', () => {
    const cats = globalSearch('market', data).find(s => s.kind === 'category')!.hits
    expect(cats[0]).toMatchObject({ id: 'c1', score: 100 })
    expect(cats[1]).toMatchObject({ id: 'c2', detail: 'Market' })
  })

  it('işlemler: açıklamada doğrudan geçen önde, eşitlikte yeni tarih önce', () => {
    const txs = globalSearch('migros', data).find(s => s.kind === 'transaction')!.hits
    // t4 "Migros" tam eşleşme (100), t1 baştan (80); kategori/kişi üzerinden eşleşen yok
    expect(txs.map(h => h.id)).toEqual(['t4', 't1'])
    expect(txs[0].tx?.id).toBe('t4')
    expect(txs[0].href).toBeUndefined()
  })

  it('işlemler: kategori adı üzerinden de bulunur (txSearch kuralı)', () => {
    const txs = globalSearch('market', data).find(s => s.kind === 'transaction')!.hits
    expect(txs.map(h => h.id)).toContain('t3')
  })

  it('işlemler: tutarla bulunur (virgüllü biçim dahil)', () => {
    expect(globalSearch('12000', data).find(s => s.kind === 'transaction')!.hits[0].id).toBe('t2')
    expect(globalSearch('250,50', data).find(s => s.kind === 'transaction')!.hits[0].id).toBe('t1')
  })

  it(`işlem araması ${TX_MIN_QUERY} karakterden kısa sorguda çalışmaz`, () => {
    expect(globalSearch('m', data).some(s => s.kind === 'transaction')).toBe(false)
  })

  it('bölüm başına sınır uygulanır, sonuçsuz bölüm dönmez', () => {
    const many = { ...data, transactions: Array.from({ length: 30 }, (_, i) => tx(`x${i}`, `Kahve ${i}`, '2026-10-10')) }
    const s = globalSearch('kahve', many, { page: 6, account: 5, category: 5, person: 5, transaction: 3 })
    expect(s.map(x => x.kind)).toEqual(['transaction'])
    expect(s[0].hits).toHaveLength(3)
  })

  it('hiçbir şey eşleşmezse boş dizi', () => {
    expect(globalSearch('qqqq', data)).toEqual([])
  })
})
