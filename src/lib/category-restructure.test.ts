import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Budget, Category, RecurringTransaction, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   category-restructure — tek seferlik kategori düzeni geçişi

   Planlayıcı saf: taşımalar yalnız üst seviyedeki kategorilere uygulanır,
   birleştirmeler işlem/pay/bütçe/tekrarlayan bağlarını ve alt kategorileri
   hedefe taşıyıp kaynağı arşivler. Geçiş çalışma alanı başına bir kez, yalnız
   yetkili çekişlerden sonra koşar ve "Geri al" ile tamamen döner.
──────────────────────────────────────────────────────────────────────── */

let authoritative = true
const batches: Array<Array<{ kind: string; table: string; id: string; patch: Record<string, unknown> }>> = []

vi.mock('@/lib/sync/engine', () => ({
  lastPullWasAuthoritative: () => authoritative,
  localBatch: async (ops: typeof batches[number]) => { batches.push(ops) },
}))
vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return {
    useCategoryStore:    create(() => ({ categories: [] as Category[] })),
    useTransactionStore: create(() => ({ transactions: [] as Transaction[] })),
    useBudgetStore:      create(() => ({ budgets: [] as Budget[] })),
    useRecurringStore:   create(() => ({ recurring: [] as RecurringTransaction[] })),
  }
})

// Test ortamı "node": geçiş bayrağı localStorage'da tutulduğu için bellek içi
// bir localStorage + window taklidi gerekir.
const storage = new Map<string, string>()
vi.stubGlobal('window', {})
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v) },
  removeItem: (k: string) => { storage.delete(k) },
})

const { planCategoryRestructure, runCategoryRestructurePass } = await import('./category-restructure')
const { useCategoryStore, useTransactionStore, useBudgetStore, useRecurringStore } = await import('@/store')
const { useUndoStore } = await import('@/store/undo.store')
const { setActiveWorkspaceId } = await import('@/lib/workspace-context')

const cat = (o: Partial<Category> & { id: string; name: string }): Category => ({
  icon: 'package', color: '#6B7280', scope: 'expense', isSystem: true, sortOrder: 0, isArchived: false, ...o,
})
const tx = (o: Partial<Transaction> & { id: string }): Transaction => ({
  type: 'expense', amount: 100, currency: 'TRY', date: '2026-09-01', accountId: 'acc', description: '', ...o,
} as Transaction)
const budget = (o: Partial<Budget> & { id: string; categoryId: string }): Budget => ({
  amount: 1000, period: 'monthly', rollover: false, alertThreshold: 80, ...o,
} as Budget)
const rec = (o: Partial<RecurringTransaction> & { id: string }): RecurringTransaction => ({
  name: 'r', type: 'expense', amount: 1, currency: 'TRY', accountId: 'acc', description: '',
  frequency: 'monthly', startDate: '2026-01-01', nextDueDate: '2026-10-01', ...o,
} as RecurringTransaction)

const plan = (input: Partial<Parameters<typeof planCategoryRestructure>[0]>) =>
  planCategoryRestructure({ categories: [], transactions: [], budgets: [], recurring: [], ...input })

const parentOf = (p: ReturnType<typeof plan>, id: string) => p.categories.find(c => c.id === id)?.patch.parentId

describe('planCategoryRestructure — taşımalar', () => {
  it('üst seviyedeki kategoriyi onaylanan üst kategorinin altına alır', () => {
    const p = plan({ categories: [
      cat({ id: 'sarj', name: 'Şarj' }),
      cat({ id: 'ulasim', name: 'Ulaşım' }),
      cat({ id: 'alkol', name: 'Alkol' }),
      cat({ id: 'eglence', name: 'Eğlence' }),
    ] })

    expect(parentOf(p, 'sarj')).toBe('ulasim')
    expect(parentOf(p, 'alkol')).toBe('eglence')
    expect(p.moved).toBe(2)
    expect(p.categories.find(c => c.id === 'sarj')?.prev).toEqual({ parentId: undefined })
  })

  it('kullanıcının zaten bir yere yerleştirdiği kategoriye dokunmaz', () => {
    const p = plan({ categories: [
      cat({ id: 'duty', name: 'Duty Free', parentId: 'seyahat' }),
      cat({ id: 'seyahat', name: 'Seyahat' }),
      cat({ id: 'alisveris', name: 'Alışveriş' }),
    ] })
    expect(p.categories).toHaveLength(0)
    expect(p.moved).toBe(0)
  })

  it('ad belirsizse (iki aktif eşleşme) ya da üst kategori yoksa atlar; arşivliler sayılmaz', () => {
    const p = plan({ categories: [
      cat({ id: 'k1', name: 'Kırtasiye' }),
      cat({ id: 'k2', name: 'Kırtasiye' }),
      cat({ id: 'alisveris', name: 'Alışveriş' }),
      cat({ id: 'legal', name: 'Legal' }),                                         // Çeşitli Hizmetler yok
      cat({ id: 'y', name: 'Yazılım' }),
      cat({ id: 'abo-arsiv', name: 'Abonelikler', isArchived: true }),
      cat({ id: 'abo', name: 'Abonelikler' }),
    ] })
    expect(parentOf(p, 'k1')).toBeUndefined()
    expect(parentOf(p, 'k2')).toBeUndefined()
    expect(parentOf(p, 'legal')).toBeUndefined()
    expect(parentOf(p, 'y')).toBe('abo')
  })

  it('gelir kapsamındaki aynı adlı kategoriye dokunmaz', () => {
    const p = plan({ categories: [
      cat({ id: 'sarj-gelir', name: 'Şarj', scope: 'income' }),
      cat({ id: 'ulasim', name: 'Ulaşım' }),
    ] })
    expect(p.categories).toHaveLength(0)
  })

  it('3 seviye sınırını aşacak taşımayı atlar', () => {
    const p = plan({ categories: [
      cat({ id: 'ulasim', name: 'Ulaşım', parentId: 'kok' }),
      cat({ id: 'kok', name: 'Kök' }),
      cat({ id: 'sarj', name: 'Şarj' }),
      cat({ id: 'ev-sarj', name: 'Ev Şarjı', parentId: 'sarj' }),                 // Şarj'ın alt kategorisi var
    ] })
    expect(parentOf(p, 'sarj')).toBeUndefined()
  })
})

describe('planCategoryRestructure — birleştirmeler', () => {
  const base = [
    cat({ id: 'tech', name: 'Tech', isSystem: false, parentId: 'alisveris' }),
    cat({ id: 'tekno', name: 'Teknoloji', parentId: 'alisveris' }),
    cat({ id: 'alisveris', name: 'Alışveriş' }),
    cat({ id: 'market', name: 'Market' }),
  ]

  it('işlemleri, bütçeleri ve tekrarlayanları hedefe bağlar, kaynağı arşivler', () => {
    const p = plan({
      categories: base,
      transactions: [tx({ id: 't1', categoryId: 'tech' }), tx({ id: 't2', categoryId: 'market' })],
      budgets: [
        budget({ id: 'b1', categoryId: 'tech', categoryName: 'Tech' }),
        budget({ id: 'b2', categoryId: JSON.stringify(['tech', 'tekno', 'market']) }),
      ],
      recurring: [rec({ id: 'r1', categoryId: 'tech' })],
    })

    expect(p.merged).toBe(1)
    expect(p.categories.find(c => c.id === 'tech')).toEqual({
      id: 'tech', patch: { isArchived: true }, prev: { isArchived: false },
    })
    expect(p.transactions).toEqual([{ id: 't1', patch: { categoryId: 'tekno' }, prev: { categoryId: 'tech' } }])
    expect(p.budgets.find(b => b.id === 'b1')?.patch).toEqual({ categoryId: 'tekno', categoryName: 'Teknoloji' })
    // Çoklu kategori bütçesi dizi biçimini korur, tekrar eden hedef tekilleşir
    expect(p.budgets.find(b => b.id === 'b2')?.patch).toEqual({
      categoryId: JSON.stringify(['tekno', 'market']), categoryName: 'Teknoloji, Market',
    })
    expect(p.recurring).toEqual([{ id: 'r1', patch: { categoryId: 'tekno' }, prev: { categoryId: 'tech' } }])
  })

  it('bölünmüş işlemde payları birleştirir; tek pay kalırsa bölmeyi kaldırır', () => {
    const p = plan({
      categories: base,
      transactions: [
        // Tech + Teknoloji → tek pay kalır → bölünmemiş işlem
        tx({ id: 's1', amount: 100, categoryId: 'tech', categorySplits: [
          { categoryId: 'tech', amount: 60 }, { categoryId: 'tekno', amount: 40 },
        ] }),
        // Tech + Market → iki pay kalır; en büyük pay categoryId olur
        tx({ id: 's2', amount: 100, categoryId: 'market', categorySplits: [
          { categoryId: 'market', amount: 55.5 }, { categoryId: 'tech', amount: 44.5 },
        ] }),
        // Tech + Teknoloji + Market → Teknoloji payları toplanır ve en büyük pay olur
        tx({ id: 's3', amount: 100, categoryId: 'market', categorySplits: [
          { categoryId: 'market', amount: 40 }, { categoryId: 'tech', amount: 30.1 }, { categoryId: 'tekno', amount: 29.9 },
        ] }),
      ],
    })

    const byId = Object.fromEntries(p.transactions.map(t => [t.id, t.patch]))
    expect(byId.s1).toEqual({ categorySplits: undefined, categoryId: 'tekno' })
    expect(byId.s2).toEqual({ categorySplits: [{ categoryId: 'market', amount: 55.5 }, { categoryId: 'tekno', amount: 44.5 }] })
    expect(byId.s3).toEqual({
      categorySplits: [{ categoryId: 'market', amount: 40 }, { categoryId: 'tekno', amount: 60 }],
      categoryId: 'tekno',
    })
  })

  it('kaynağın alt kategorilerini hedefe taşır; zincirleme birleştirme çalışır', () => {
    const p = plan({
      categories: [
        cat({ id: 'household', name: 'Household', isSystem: false }),
        cat({ id: 'dekor', name: 'Dekor', isSystem: false, parentId: 'household' }),
        cat({ id: 'impr', name: 'Improvements', isSystem: false, parentId: 'household' }),
        cat({ id: 'ev', name: 'Ev' }),
        cat({ id: 'tadilat', name: 'Tadilat', parentId: 'ev' }),
      ],
      transactions: [tx({ id: 't1', categoryId: 'household' }), tx({ id: 't2', categoryId: 'impr' })],
    })

    const byId = Object.fromEntries(p.categories.map(c => [c.id, c]))
    expect(byId.household.patch).toEqual({ isArchived: true })
    expect(byId.dekor).toEqual({ id: 'dekor', patch: { parentId: 'ev' }, prev: { parentId: 'household' } })
    // Önce Ev'in altına geçti, sonra Tadilat'a birleşti — özgün üst kategori geri alınabilsin
    expect(byId.impr).toEqual({
      id: 'impr', patch: { parentId: 'ev', isArchived: true }, prev: { parentId: 'household', isArchived: false },
    })
    expect(Object.fromEntries(p.transactions.map(t => [t.id, t.patch.categoryId]))).toEqual({ t1: 'ev', t2: 'tadilat' })
    expect(p.merged).toBe(2)
  })

  it('hedef yoksa ya da kaynak zaten arşivliyse hiçbir şey yapmaz', () => {
    const p = plan({
      categories: [
        cat({ id: 'tech', name: 'Tech' }),                                          // Teknoloji yok
        cat({ id: 'mobil', name: 'Mobil Hat', isArchived: true }),
        cat({ id: 'tel', name: 'Telefon' }),
      ],
      transactions: [tx({ id: 't1', categoryId: 'tech' }), tx({ id: 't2', categoryId: 'mobil' })],
    })
    expect(p.categories).toHaveLength(0)
    expect(p.transactions).toHaveLength(0)
    expect(p.merged).toBe(0)
  })
})

describe('runCategoryRestructurePass', () => {
  beforeEach(() => {
    authoritative = true
    batches.length = 0
    storage.clear()
    setActiveWorkspaceId('ws-1')
    useCategoryStore.setState({ categories: [
      cat({ id: 'tech', name: 'Tech', parentId: 'alisveris' }),
      cat({ id: 'tekno', name: 'Teknoloji', parentId: 'alisveris' }),
      cat({ id: 'alisveris', name: 'Alışveriş' }),
      cat({ id: 'kirtasiye', name: 'Kırtasiye' }),
    ] })
    useTransactionStore.setState({ transactions: [tx({ id: 't1', categoryId: 'tech' })] })
    useBudgetStore.setState({ budgets: [] })
    useRecurringStore.setState({ recurring: [] })
    useUndoStore.setState({ toasts: [] })
  })

  it('planı tek bir atomik yazımla uygular, store\'ları günceller ve bildirim gösterir', async () => {
    await runCategoryRestructurePass()

    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual(expect.arrayContaining([
      { kind: 'patch', table: 'categories', id: 'tech', patch: { isArchived: true } },
      { kind: 'patch', table: 'categories', id: 'kirtasiye', patch: { parentId: 'alisveris' } },
      { kind: 'patch', table: 'transactions', id: 't1', patch: { categoryId: 'tekno' } },
    ]))
    const cats = Object.fromEntries(useCategoryStore.getState().categories.map(c => [c.id, c]))
    expect(cats.tech.isArchived).toBe(true)
    expect(cats.kirtasiye.parentId).toBe('alisveris')
    expect(useTransactionStore.getState().transactions[0].categoryId).toBe('tekno')

    const toasts = useUndoStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].label).toContain('1 kategori taşındı')
    expect(toasts[0].label).toContain('1 kategori birleştirildi')
  })

  it('çalışma alanı başına yalnız bir kez çalışır', async () => {
    await runCategoryRestructurePass()
    await runCategoryRestructurePass()
    expect(batches).toHaveLength(1)

    setActiveWorkspaceId('ws-2')
    useCategoryStore.setState({ categories: [cat({ id: 'a', name: 'Alkol' }), cat({ id: 'e', name: 'Eğlence' })] })
    await runCategoryRestructurePass()
    expect(batches).toHaveLength(2)
  })

  it('YETKİSİZ çekişte çalışmaz ve kendini bitti saymaz', async () => {
    authoritative = false
    await runCategoryRestructurePass()
    expect(batches).toHaveLength(0)

    authoritative = true
    await runCategoryRestructurePass()
    expect(batches).toHaveLength(1)
  })

  it('"Geri al" her şeyi özgün haline döndürür', async () => {
    await runCategoryRestructurePass()
    const [toast] = useUndoStore.getState().toasts
    await useUndoStore.getState().runUndo(toast.id)

    expect(batches).toHaveLength(2)
    expect(batches[1]).toEqual(expect.arrayContaining([
      { kind: 'patch', table: 'categories', id: 'tech', patch: { isArchived: false } },
      { kind: 'patch', table: 'categories', id: 'kirtasiye', patch: { parentId: undefined } },
      { kind: 'patch', table: 'transactions', id: 't1', patch: { categoryId: 'tech' } },
    ]))
    const cats = Object.fromEntries(useCategoryStore.getState().categories.map(c => [c.id, c]))
    expect(cats.tech.isArchived).toBe(false)
    expect(cats.kirtasiye.parentId).toBeUndefined()
    expect(useTransactionStore.getState().transactions[0].categoryId).toBe('tech')
  })

  it('değişecek bir şey yoksa yazmaz, bildirim göstermez ama bitti sayar', async () => {
    useCategoryStore.setState({ categories: [cat({ id: 'market', name: 'Market' })] })
    await runCategoryRestructurePass()
    expect(batches).toHaveLength(0)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
    expect(storage.get('fintrack.categoryHierarchy.v1:ws-1')).toBe('1')
  })
})
