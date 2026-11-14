import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/* ────────────────────────────────────────────────────────────────────────
   sync/repair — takılı kategori ve geçersiz hesap referansı onarımları

   Denetimde (audit/bug-audit-2026-08-28.md → "Hâlâ testsiz kalan yüksek
   riskli modüller") testsiz listelenmişti: onarım KİMLİK değiştirir ve
   yerelden SİLER, yani yanlış bir karar sessiz veri kaybıdır. engine.test.ts
   ile aynı sahte Dexie/Supabase kalıbı; onarım gerçek engine primitive'leri
   (localBatch/localUpsert) üzerinden yazar, dolayısıyla outbox'a ne girdiği de
   doğrulanır.
──────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown> & { id: string }

class FakeTable {
  rows = new Map<string, Row>()

  async put(r: Row) { this.rows.set(r.id, { ...r }) }
  async bulkPut(rs: Row[]) { for (const r of rs) await this.put(r) }
  async get(id: string) { const r = this.rows.get(id); return r ? { ...r } : undefined }
  async toArray() { return [...this.rows.values()].map(r => ({ ...r })) }
  async count() { return this.rows.size }
  async clear() { this.rows.clear() }
  async delete(id: string) { this.rows.delete(id) }
  async bulkDelete(ids: string[]) { for (const id of ids) this.rows.delete(id) }

  async update(id: string, patch: Record<string, unknown>) {
    const r = this.rows.get(id)
    if (!r) return 0
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete r[k]
      else r[k] = v
    }
    return 1
  }

  // repair.ts Collection.filter kullanır (engine.test.ts'teki sahtede yok)
  filter(fn: (r: Row) => boolean) {
    const rows = this.rows
    return { toArray: async () => [...rows.values()].filter(r => fn({ ...r })).map(r => ({ ...r })) }
  }

  where(field: string) {
    const rows = this.rows
    return {
      equals: (val: unknown) => ({
        toArray: async () => [...rows.values()].filter(r => r[field] === val).map(r => ({ ...r })),
      }),
      anyOf: (ids: string[]) => ({
        toArray: async () => [...rows.values()].filter(r => ids.includes(r[field] as string)).map(r => ({ ...r })),
        modify: async (patch: Record<string, unknown>) => {
          for (const r of rows.values()) {
            if (!ids.includes(r[field] as string)) continue
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete r[k]
              else r[k] = v
            }
          }
        },
      }),
    }
  }
}

const tables = {
  accounts: new FakeTable(), transactions: new FakeTable(), categories: new FakeTable(),
  budgets: new FakeTable(), debts: new FakeTable(), investmentTransactions: new FakeTable(),
  people: new FakeTable(), recurringTransactions: new FakeTable(), workspaces: new FakeTable(),
  paymentPlans: new FakeTable(), paymentOccurrences: new FakeTable(), savingsGoals: new FakeTable(),
  _outbox: new FakeTable(),
}

vi.mock('@/lib/db', () => ({
  db: {
    ...tables,
    transaction: async (_mode: string, ...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>
      return fn()
    },
  },
}))

// Onarım ağa çıkmaz; engine modülü yüklenebilsin diye asgari sahte.
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('@/lib/auth', () => ({ getUserId: async () => 'user-1' }))
vi.mock('@/store/sync-status.store', () => ({
  useSyncStatusStore: { getState: () => ({ report: () => {}, notify: () => {} }) },
}))

const { repairStuckCategories, repairInvalidAccountRefs } = await import('./repair')
const { localUpsert } = await import('./engine')

const RLS_ERR = 'new row violates row-level security policy (USING expression) for table "categories"'

const cat = (id: string, over: Record<string, unknown> = {}): Row => ({
  id, name: 'Market', icon: '🛒', color: '#0f0', scope: 'expense', isSystem: false, sortOrder: 1,
  workspaceId: 'ws-1', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
})
const tx = (id: string, over: Record<string, unknown> = {}): Row => ({
  id, type: 'expense', amount: 250, currency: 'TRY', date: '2026-03-01', accountId: 'a1',
  description: 'Alışveriş', isInstallment: false, createdAt: '2026-03-01', workspaceId: 'ws-1',
  updatedAt: '2026-03-01T00:00:00.000Z', ...over,
})

async function seed(table: keyof typeof tables, ...rows: Row[]) {
  for (const r of rows) await tables[table].put(r)
}

// Takılı outbox girdisi: snapshot satırın kendisi, lastError RLS hatası
async function stuckEntry(table: string, row: Row, lastError: string | null = RLS_ERR, attempts = 12) {
  const { id: _id, ...rest } = row
  void _id
  await tables._outbox.put({
    id: `${table}:${row.id}`, table, entityId: row.id,
    snapshot: { id: row.id, ...rest }, attempts, lastError,
    enqueuedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

const outboxEntry = (key: string) => tables._outbox.rows.get(key)
const snap = (key: string) => outboxEntry(key)?.snapshot as Record<string, unknown> | undefined

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/* ══ repairStuckCategories ═══════════════════════════════════════════════ */

describe('repairStuckCategories — takılmış kategori yoksa', () => {
  it('kuyruk boşken hiçbir şeye dokunmaz', async () => {
    await seed('categories', cat('c1'))
    expect(await repairStuckCategories()).toEqual({ remapped: 0, rekeyed: 0, cleared: 0 })
    expect(tables.categories.rows.has('c1')).toBe(true)
  })

  it('RLS dışı hatalar ve başka tablolardaki RLS hataları onarım kapsamında DEĞİL', async () => {
    await seed('categories', cat('c1'))
    await seed('transactions', tx('t1', { categoryId: 'c1' }))
    await stuckEntry('categories', cat('c1'), 'fetch failed')
    await stuckEntry('transactions', tx('t1'), RLS_ERR)

    expect(await repairStuckCategories()).toEqual({ remapped: 0, rekeyed: 0, cleared: 0 })
    expect(tables.categories.rows.has('c1')).toBe(true)
    expect(tables._outbox.rows.size).toBe(2)
  })

  it('deneme sayısına bakmaz: tek bir RLS hatası yeterli (retryDeadLetters sayacı sıfırlar)', async () => {
    await seed('categories', cat('c-yabanci'))
    await stuckEntry('categories', cat('c-yabanci'), RLS_ERR, 0)
    const r = await repairStuckCategories()
    expect(r.rekeyed).toBe(1)
  })
})

describe('repairStuckCategories — remap (aynı isimli canlı kategori var)', () => {
  it('tüm referansları mevcut kategoriye taşır, yabancı satırı yalnız yerelden siler', async () => {
    await seed('categories',
      cat('c-yabanci', { name: 'Market' }),
      cat('c-benim',   { name: '  MARKET ' }),                 // trim + büyük/küçük harf
      cat('c-alt',     { name: 'Manav', parentId: 'c-yabanci' }),
    )
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }), tx('t2', { categoryId: 'c-baska' }))
    await seed('budgets', { id: 'b1', categoryId: 'c-yabanci', amount: 1000, workspaceId: 'ws-1' })
    await seed('recurringTransactions', { id: 'r1', categoryId: 'c-yabanci', amount: 50, workspaceId: 'ws-1' })
    await stuckEntry('categories', cat('c-yabanci'))

    const r = await repairStuckCategories()

    expect(r).toEqual({ remapped: 1, rekeyed: 0, cleared: 0 })
    expect((await tables.transactions.get('t1'))!.categoryId).toBe('c-benim')
    expect((await tables.transactions.get('t2'))!.categoryId).toBe('c-baska')   // ilgisiz satıra dokunulmaz
    expect((await tables.budgets.get('b1'))!.categoryId).toBe('c-benim')
    expect((await tables.recurringTransactions.get('r1'))!.categoryId).toBe('c-benim')
    expect((await tables.categories.get('c-alt'))!.parentId).toBe('c-benim')

    // Yabancı satır yerelden gitti, kuyruğu temizlendi — ama TOMBSTONE'lanmadı
    // (o kimlikle buluta yazamayız)
    expect(tables.categories.rows.has('c-yabanci')).toBe(false)
    expect(outboxEntry('categories:c-yabanci')).toBeUndefined()

    // Taşınan referanslar buluta gidecek (outbox'ta yeni değerle)
    expect(snap('transactions:t1')!.categoryId).toBe('c-benim')
    expect(snap('budgets:b1')!.categoryId).toBe('c-benim')
    expect(snap('recurring_transactions:r1')!.categoryId).toBe('c-benim')
    expect(snap('categories:c-alt')!.parentId).toBe('c-benim')
    expect(outboxEntry('transactions:t2')).toBeUndefined()
  })

  it('Türkçe büyük/küçük harf: "İLAÇ" ile "ilaç" aynı kategori sayılır', async () => {
    await seed('categories', cat('c-yabanci', { name: 'İLAÇ' }), cat('c-benim', { name: 'ilaç' }))
    await stuckEntry('categories', cat('c-yabanci', { name: 'İLAÇ' }))
    expect((await repairStuckCategories()).remapped).toBe(1)
  })

  it('farklı scope (gelir/gider) aynı isimde olsa da hedef OLMAZ → rekey', async () => {
    await seed('categories', cat('c-yabanci', { scope: 'expense' }), cat('c-gelir', { scope: 'income' }))
    await stuckEntry('categories', cat('c-yabanci'))
    const r = await repairStuckCategories()
    expect(r).toEqual({ remapped: 0, rekeyed: 1, cleared: 0 })
    expect(tables.categories.rows.has('c-gelir')).toBe(true)
  })

  it('silinmiş (tombstone) kategori hedef olarak seçilmez', async () => {
    await seed('categories', cat('c-yabanci'), cat('c-olu', { deleted_at: '2026-02-01T00:00:00Z' }))
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }))
    await stuckEntry('categories', cat('c-yabanci'))

    const r = await repairStuckCategories()
    expect(r.rekeyed).toBe(1)
    expect((await tables.transactions.get('t1'))!.categoryId).not.toBe('c-olu')
  })
})

describe('repairStuckCategories — rekey (kullanıcının hesabına yeni kimlikle kopya)', () => {
  it('klon tüm alanları korur, yeni kimlikle kuyruğa girer, referanslar ona taşınır', async () => {
    const yabanci = cat('c-yabanci', { name: 'Kırtasiye', icon: '✏️', color: '#123', matchKeywords: ['kalem'], sortOrder: 7 })
    await seed('categories', yabanci)
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }))
    await stuckEntry('categories', yabanci)

    const r = await repairStuckCategories()
    expect(r).toEqual({ remapped: 0, rekeyed: 1, cleared: 0 })

    const cats = await tables.categories.toArray()
    expect(cats).toHaveLength(1)
    const klon = cats[0]
    expect(klon.id).not.toBe('c-yabanci')
    expect(klon).toMatchObject({
      name: 'Kırtasiye', icon: '✏️', color: '#123', matchKeywords: ['kalem'], sortOrder: 7, workspaceId: 'ws-1',
    })
    expect(snap(`categories:${klon.id}`)).toMatchObject({ id: klon.id, name: 'Kırtasiye', deleted_at: null })
    expect((await tables.transactions.get('t1'))!.categoryId).toBe(klon.id)
    expect(snap('transactions:t1')!.categoryId).toBe(klon.id)
    expect(outboxEntry('categories:c-yabanci')).toBeUndefined()
  })

  it('takılı ebeveyn + takılı çocuk: klonun parentId\'si ebeveynin YENİ kimliğine çevrilir', async () => {
    await seed('categories', cat('p-yabanci', { name: 'Ulaşım' }), cat('ch-yabanci', { name: 'Taksi', parentId: 'p-yabanci' }))
    await stuckEntry('categories', cat('p-yabanci', { name: 'Ulaşım' }))
    await stuckEntry('categories', cat('ch-yabanci', { name: 'Taksi', parentId: 'p-yabanci' }))

    expect((await repairStuckCategories()).rekeyed).toBe(2)

    const cats = await tables.categories.toArray()
    const parent = cats.find(c => c.name === 'Ulaşım')!
    const child  = cats.find(c => c.name === 'Taksi')!
    expect(parent.id).not.toBe('p-yabanci')
    expect(child.parentId).toBe(parent.id)
    expect(snap(`categories:${child.id}`)!.parentId).toBe(parent.id)
  })

  it('ikinci koşu boş döner (onarım tekrarlanabilir, kopya çoğalmaz)', async () => {
    await seed('categories', cat('c-yabanci'))
    await stuckEntry('categories', cat('c-yabanci'))
    await repairStuckCategories()
    expect(await repairStuckCategories()).toEqual({ remapped: 0, rekeyed: 0, cleared: 0 })
    expect(await tables.categories.count()).toBe(1)
  })
})

describe('repairStuckCategories — kenar durumlar', () => {
  it('satır yerelde yoksa yalnız kuyruk temizlenir (cleared)', async () => {
    await stuckEntry('categories', cat('c-yok'))
    expect(await repairStuckCategories()).toEqual({ remapped: 0, rekeyed: 0, cleared: 1 })
    expect(tables._outbox.rows.size).toBe(0)
  })

  it('tombstone\'lu takılı satır: klonlanmaz/diriltilmez, kuyruktan ve yerelden temizlenir', async () => {
    const olu = cat('c-yabanci', { deleted_at: '2026-02-01T00:00:00Z' })
    await seed('categories', olu)
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }))
    await stuckEntry('categories', olu)

    expect(await repairStuckCategories()).toEqual({ remapped: 0, rekeyed: 0, cleared: 1 })
    expect(await tables.categories.count()).toBe(0)        // diriltilmiş klon YOK
    // Karakterizasyon: silinmiş kategoriye bağlı işlem olduğu gibi kalır
    // (kategori zaten silinmişti; referans taşınmaz, kuyruğa yazılmaz)
    expect((await tables.transactions.get('t1'))!.categoryId).toBe('c-yabanci')
    expect(outboxEntry('transactions:t1')).toBeUndefined()
  })

  it('kısmi hata: yerel batch patlarsa yabancı satır ve kuyruk girdisi SİLİNMEZ (tekrar denenebilir)', async () => {
    await seed('categories', cat('c-yabanci'))
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }))
    await stuckEntry('categories', cat('c-yabanci'))
    vi.spyOn(tables.transactions, 'update').mockRejectedValueOnce(new Error('QuotaExceededError'))

    await expect(repairStuckCategories()).rejects.toThrow('QuotaExceededError')

    expect(tables.categories.rows.has('c-yabanci')).toBe(true)
    expect(outboxEntry('categories:c-yabanci')).toBeDefined()
  })

  it('kısmi hata: 3. geçiş yarıda kesilirse ikinci koşu remap yoluna düşer, kopya çoğalmaz', async () => {
    await seed('categories', cat('c-yabanci'))
    await seed('transactions', tx('t1', { categoryId: 'c-yabanci' }))
    await stuckEntry('categories', cat('c-yabanci'))
    vi.spyOn(tables.categories, 'delete').mockRejectedValueOnce(new Error('tarayıcı kapandı'))

    await expect(repairStuckCategories()).rejects.toThrow('tarayıcı kapandı')
    // batch commit oldu: klon + taşınmış referans var, yabancı satır ve girdi duruyor
    expect(await tables.categories.count()).toBe(2)
    expect(outboxEntry('categories:c-yabanci')).toBeDefined()

    vi.restoreAllMocks()
    const r = await repairStuckCategories()
    expect(r).toEqual({ remapped: 1, rekeyed: 0, cleared: 0 })
    const cats = await tables.categories.toArray()
    expect(cats).toHaveLength(1)
    expect((await tables.transactions.get('t1'))!.categoryId).toBe(cats[0].id)
  })

  it('aynı isimli İKİ takılı kategori, hedef yok: ikisi de ayrı klonlanır (karakterizasyon — mükerrer isim)', async () => {
    await seed('categories', cat('y1'), cat('y2'))
    await stuckEntry('categories', cat('y1'))
    await stuckEntry('categories', cat('y2'))
    expect((await repairStuckCategories()).rekeyed).toBe(2)
    expect((await tables.categories.toArray()).filter(c => c.name === 'Market')).toHaveLength(2)
  })

  // BİLİNEN HATA (#R2): referans taşıma yalnız `categoryId`'ye bakıyor
  // (repair.ts:82). Bölünmüş işlemin `categorySplits[].categoryId` payları
  // yabancı kimlikte kalır; yabancı satır yerelden silinince pay "bilinmeyen
  // kategori"ye düşer ve kategori bazlı toplamlardan (expandByCategory) kaybolur.
  it.fails('BİLİNEN HATA #R2: bölünmüş işlemin categorySplits payları da taşınmalı', async () => {
    await seed('categories', cat('c-yabanci', { name: 'Market' }), cat('c-benim', { name: 'Market' }), cat('c-ev', { name: 'Ev' }))
    await seed('transactions', tx('t1', {
      amount: 300, categoryId: 'c-ev',
      categorySplits: [{ categoryId: 'c-ev', amount: 200 }, { categoryId: 'c-yabanci', amount: 100 }],
    }))
    await stuckEntry('categories', cat('c-yabanci'))

    await repairStuckCategories()

    const splits = (await tables.transactions.get('t1'))!.categorySplits as { categoryId: string }[]
    expect(splits.map(s => s.categoryId)).toEqual(['c-ev', 'c-benim'])
  })

  // BİLİNEN HATA (#R3): remap hedefi isim+scope ile seçiliyor, çalışma alanı
  // KIYASLANMIYOR (repair.ts:60). Kategoriler alan başınadır
  // (categories.store → rowInActiveWorkspace). Paylaşılan alandaki takılı
  // kategori (ör. üyelik düşerken kuyruğa girmiş), kullanıcının KİŞİSEL
  // alanındaki aynı isimli kategoriye bağlanır: paylaşılan alandaki işlemler
  // o alanda görünmeyen bir kategoriye işaret eder ve bu hâliyle buluta itilir.
  it.fails('BİLİNEN HATA #R3: remap hedefi aynı çalışma alanından seçilmeli (paylaşılan alan)', async () => {
    await seed('categories',
      cat('c-paylasilan', { name: 'Market', workspaceId: 'ws-aile' }),   // alan sahibinin satırı
      cat('c-kisisel',    { name: 'Market', workspaceId: 'ws-benim' }),
    )
    await seed('transactions', tx('t-aile', { categoryId: 'c-paylasilan', workspaceId: 'ws-aile' }))
    await stuckEntry('categories', cat('c-paylasilan', { workspaceId: 'ws-aile' }))

    await repairStuckCategories()

    const yeni = (await tables.transactions.get('t-aile'))!.categoryId as string
    expect(yeni).not.toBe('c-kisisel')
    expect((await tables.categories.get(yeni))!.workspaceId).toBe('ws-aile')
  })

  it('paylaşılan alandaki takılı kategori rekey edilince klon AYNI alanda kalır (başka alana sızmaz)', async () => {
    await seed('categories', cat('c-paylasilan', { name: 'Okul', workspaceId: 'ws-aile' }))
    await seed('transactions', tx('t-aile', { categoryId: 'c-paylasilan', workspaceId: 'ws-aile' }))
    await stuckEntry('categories', cat('c-paylasilan', { name: 'Okul', workspaceId: 'ws-aile' }))

    expect((await repairStuckCategories()).rekeyed).toBe(1)
    const [klon] = await tables.categories.toArray()
    expect(klon.workspaceId).toBe('ws-aile')
    expect((await tables.transactions.get('t-aile'))!.workspaceId).toBe('ws-aile')
  })
})

/* ══ repairInvalidAccountRefs ════════════════════════════════════════════ */

const UUID_ERR = 'invalid input syntax for type uuid: ""'

describe('repairInvalidAccountRefs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T09:00:00.000Z'))
  })

  it('geçerli hesap referanslı ve başka tablolardaki girdilere dokunmaz', async () => {
    await seed('transactions', tx('t1'))
    await stuckEntry('transactions', tx('t1'), UUID_ERR)
    await stuckEntry('debts', { id: 'd1', accountId: '' }, UUID_ERR)

    expect(await repairInvalidAccountRefs()).toEqual({ fixed: 0, redated: 0, dropped: 0, cleared: 0 })
    expect(tables._outbox.rows.size).toBe(2)
  })

  it('kaynaksız transfer (geçmiş tarih) → hedef hesabın geliri; alanlar korunur, kuyruk geçerli payload taşır', async () => {
    const bozuk = tx('t1', {
      type: 'transfer', accountId: '', toAccountId: 'a-banka', amount: 5000, date: '2026-10-01',
      description: 'Kredi girişi', debtPrincipalId: 'd1', approvalStatus: 'approved', workspaceId: 'ws-2',
    })
    await seed('transactions', bozuk)
    await stuckEntry('transactions', bozuk, UUID_ERR)

    expect(await repairInvalidAccountRefs()).toEqual({ fixed: 1, redated: 0, dropped: 0, cleared: 0 })

    const row = (await tables.transactions.get('t1'))!
    expect(row).toMatchObject({
      type: 'income', accountId: 'a-banka', amount: 5000, date: '2026-10-01', icon: '🏦',
      description: 'Kredi girişi', debtPrincipalId: 'd1', approvalStatus: 'approved', workspaceId: 'ws-2',
    })
    expect('toAccountId' in row).toBe(false)

    const e = outboxEntry('transactions:t1')!
    expect(e.attempts).toBe(0)
    expect(e.lastError).toBe(null)
    expect((e.snapshot as Record<string, unknown>).accountId).toBe('a-banka')
    expect((e.snapshot as Record<string, unknown>).type).toBe('income')
  })

  it('mevcut ikon korunur', async () => {
    const bozuk = tx('t1', { type: 'transfer', accountId: '', toAccountId: 'a2', icon: '💳' })
    await seed('transactions', bozuk)
    await stuckEntry('transactions', bozuk, UUID_ERR)
    await repairInvalidAccountRefs()
    expect((await tables.transactions.get('t1'))!.icon).toBe('💳')
  })

  it('ileri tarihli satır bugüne çekilir ve onaylanır (redated)', async () => {
    const bozuk = tx('t1', { type: 'transfer', accountId: '', toAccountId: 'a2', date: '2027-01-15', approvalStatus: 'pending' })
    await seed('transactions', bozuk)
    await stuckEntry('transactions', bozuk, UUID_ERR)

    expect(await repairInvalidAccountRefs()).toEqual({ fixed: 1, redated: 1, dropped: 0, cleared: 0 })
    const row = (await tables.transactions.get('t1'))!
    expect(row.date).toBe('2026-11-14')
    expect(row.approvalStatus).toBe('approved')
    expect(row.approvedAt).toBe('2026-11-14T09:00:00.000Z')
  })

  it('null ve eksik accountId de "geçersiz" sayılır', async () => {
    const a = tx('t-null', { type: 'transfer', accountId: null, toAccountId: 'a2' })
    const b = tx('t-yok', { type: 'transfer', toAccountId: 'a3' })
    delete b.accountId
    await seed('transactions', a, b)
    await stuckEntry('transactions', a, UUID_ERR)
    await stuckEntry('transactions', b, UUID_ERR)

    expect((await repairInvalidAccountRefs()).fixed).toBe(2)
    expect((await tables.transactions.get('t-null'))!.accountId).toBe('a2')
    expect((await tables.transactions.get('t-yok'))!.accountId).toBe('a3')
  })

  it('hedef hesap da yoksa satır YALNIZ yerelden kaldırılır (dropped), tombstone gönderilmez', async () => {
    const bozuk = tx('t1', { accountId: '' })
    await seed('transactions', bozuk)
    await stuckEntry('transactions', bozuk, UUID_ERR)

    expect(await repairInvalidAccountRefs()).toEqual({ fixed: 0, redated: 0, dropped: 1, cleared: 0 })
    expect(tables.transactions.rows.has('t1')).toBe(false)
    expect(tables._outbox.rows.size).toBe(0)
  })

  it('satır yerelde yoksa yalnız kuyruk temizlenir (cleared)', async () => {
    await stuckEntry('transactions', tx('t1', { accountId: '' }), UUID_ERR)
    expect(await repairInvalidAccountRefs()).toEqual({ fixed: 0, redated: 0, dropped: 0, cleared: 1 })
    expect(tables._outbox.rows.size).toBe(0)
  })

  it('tombstone\'lu satır onarılırken DİRİLMEZ (deleted_at korunur)', async () => {
    const olu = tx('t1', { type: 'transfer', accountId: '', toAccountId: 'a2', deleted_at: '2026-11-01T00:00:00.000Z' })
    await seed('transactions', olu)
    await stuckEntry('transactions', olu, UUID_ERR)

    await repairInvalidAccountRefs()
    expect((await tables.transactions.get('t1'))!.deleted_at).toBe('2026-11-01T00:00:00.000Z')
    expect(snap('transactions:t1')!.deleted_at).toBe('2026-11-01T00:00:00.000Z')
  })

  it('kuyruk anlık görüntüsüne bakar: yereldeki satır sonradan düzeltilmişse bile girdi işlenir', async () => {
    // Snapshot bozuk, yerel satır (ör. başka sekmede) geçerli bir hesaba bağlanmış
    await seed('transactions', tx('t1', { type: 'transfer', accountId: 'a1', toAccountId: 'a2' }))
    await stuckEntry('transactions', tx('t1', { accountId: '' }), UUID_ERR)

    expect((await repairInvalidAccountRefs()).fixed).toBe(1)
    // Karakterizasyon: yerel transfer gelire çevrilir — kaynak hesap a1 bilgisi düşer
    expect((await tables.transactions.get('t1'))!).toMatchObject({ type: 'income', accountId: 'a2' })
  })

  // BİLİNEN HATA (#R4): hasInvalidAccountRef (repair.ts:129) lastError'a
  // BAKMIYOR; "Onar" düğmesi BAŞKA bir hata için (ör. takılı kategori)
  // görünse bile hesap referansı boş olan HER bekleyen işlem girdisi işlenir.
  // sanitize.ts push sınırında '' → null yaptığı ve kolon null kabul ettiği
  // için böyle satırlar bulutta VAR olabilir. Hedefi olmayan böyle bir satırın
  // bekleyen silmesi (tombstone) "dropped" yolunda kuyruktan atılır ve satır
  // yerelden silinir → sonraki reconcilingPull buluttaki CANLI satırı geri
  // getirir: kullanıcının sildiği işlem dirilir.
  it.fails('BİLİNEN HATA #R4: hiç hata almamış bekleyen silme (tombstone) onarımda kaybolmamalı', async () => {
    await seed('transactions', tx('t1', { accountId: null }))
    await localUpsert('transactions', { ...(await tables.transactions.get('t1'))!, deleted_at: '2026-11-14T08:59:00.000Z' })
    expect(outboxEntry('transactions:t1')!.lastError).toBe(null)    // hiç push edilmemiş, hata yok

    await repairInvalidAccountRefs()

    expect(snap('transactions:t1')?.deleted_at).toBe('2026-11-14T08:59:00.000Z')
  })
})
