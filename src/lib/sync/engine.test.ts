import { describe, it, expect, beforeEach, vi } from 'vitest'

/* ────────────────────────────────────────────────────────────────────────
   sync/engine — dayanıklı outbox, flush ve uzlaştıran çekiş

   Denetim öncesi 527 satırlık bu modülün HİÇ testi yoktu; offline-first
   mimarinin tüm veri kaybı riski burada toplanıyor. Dexie ve Supabase
   bellek-içi sahtelerle değiştirilir; testler motorun KARARLARINI doğrular:
   ne kuyruğa girer, ne zaman silinir, çekiş neyi ezer, neyi korur.

   Not: test ortamı 'node' → `typeof window === 'undefined'`, dolayısıyla
   kickSync() erken döner ve arka plan flush'ı testlere karışmaz. Flush her
   testte açıkça çağrılır.
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

  async update(id: string, patch: Record<string, unknown>) {
    const r = this.rows.get(id)
    if (!r) return 0
    // Dexie semantiği: undefined değer anahtarı SİLER (engine bunu nullifyPatch
    // ile önlemeye çalışır — testin bu davranışı taklit etmesi şart).
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete r[k]
      else r[k] = v
    }
    return 1
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

  orderBy(field: string) {
    const rows = this.rows
    return {
      toArray: async () => [...rows.values()]
        .sort((a, b) => String(a[field]).localeCompare(String(b[field])))
        .map(r => ({ ...r })),
    }
  }
}

const tables = {
  accounts: new FakeTable(), transactions: new FakeTable(), categories: new FakeTable(),
  budgets: new FakeTable(), debts: new FakeTable(), investmentTransactions: new FakeTable(),
  people: new FakeTable(), recurringTransactions: new FakeTable(), workspaces: new FakeTable(),
  _outbox: new FakeTable(),
}

vi.mock('@/lib/db', () => ({
  db: {
    ...tables,
    // Sahte transaction: son argüman geri çağrıdır, atomiklik simüle edilmez
    // (testler tek iş parçacığında koştuğu için gerek yok).
    transaction: async (_mode: string, ...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<unknown>
      return fn()
    },
  },
}))

// ── Sahte Supabase ────────────────────────────────────────────────────────
let upsertImpl: (table: string, payload: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
let selectImpl: (table: string) => Promise<{ data: Row[] | null; error: { message: string } | null }>
const upsertCalls: { table: string; payload: Record<string, unknown> }[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>) => {
        upsertCalls.push({ table, payload })
        return upsertImpl(table, payload)
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            range: () => selectImpl(table),
          }),
        }),
      }),
    }),
  },
}))

let currentUid: string | null = 'user-1'
vi.mock('@/lib/auth', () => ({ getUserId: async () => currentUid }))

const notifications: string[] = []
vi.mock('@/store/sync-status.store', () => ({
  useSyncStatusStore: {
    getState: () => ({
      report: () => {},
      notify: (msg: string) => { notifications.push(msg) },
    }),
  },
}))

const {
  localUpsert, localPatch, localPatchMany, localBulkUpsert, localBatch,
  softDelete, flushOutbox, reconcilingPull, pendingCount, retryDeadLetters,
  MAX_SYNC_ATTEMPTS, lastPullWasAuthoritative,
} = await import('./engine')

const outbox = tables._outbox
const txTable = tables.transactions

const tx = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'expense', amount: 250, currency: 'TRY', date: '2026-03-01',
  accountId: 'a1', description: 'Alışveriş', isInstallment: false,
  createdAt: '2026-03-01', updatedAt: '2026-03-01', ...over,
})

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear()
  upsertCalls.length = 0
  notifications.length = 0
  currentUid = 'user-1'
  upsertImpl = async () => ({ error: null })
  selectImpl = async () => ({ data: [], error: null })
})

/* ── Yerel mutasyon primitive'leri ──────────────────────────────────────── */

describe('localUpsert / localPatch — varlık + outbox aynı anda', () => {
  it('varlığı yazar ve tek bir outbox girdisi bırakır', async () => {
    await localUpsert('transactions', tx('t1'))
    expect((await txTable.get('t1'))!.amount).toBe(250)

    const entries = await outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('transactions:t1')
    expect(entries[0].entityId).toBe('t1')
    expect(entries[0].ownerId).toBe('user-1')
  })

  it('aynı kayda ikinci yazma girdiyi ÜZERİNE yazar (kuyruk şişmez)', async () => {
    await localUpsert('transactions', tx('t1'))
    const firstEnqueuedAt = (await outbox.get('transactions:t1'))!.enqueuedAt

    await localPatch('transactions', 't1', { amount: 999 })

    expect(await pendingCount()).toBe(1)
    const entry = (await outbox.get('transactions:t1'))!
    expect((entry.snapshot as Record<string, unknown>).amount).toBe(999)
    // İlk görülme sırası korunur (FK-güvenli flush sırası)
    expect(entry.enqueuedAt).toBe(firstEnqueuedAt)
  })

  it('snapshot hesaplanan alanları atar ve user_id taşımaz', async () => {
    await localUpsert('accounts', { id: 'a1', name: 'Vadesiz', initialBalance: 100, balance: 999, user_id: 'sizinti' })
    const snap = (await outbox.get('accounts:a1'))!.snapshot as Record<string, unknown>
    expect(snap.balance).toBeUndefined()   // COMPUTED['accounts']
    expect(snap.user_id).toBeUndefined()   // flush anında oturumdan basılır
    expect(snap.initialBalance).toBe(100)
  })

  it('deleted_at snapshot\'ta HER ZAMAN açıktır (tombstone diriltmesi için)', async () => {
    await localUpsert('transactions', tx('t1'))
    const snap = (await outbox.get('transactions:t1'))!.snapshot as Record<string, unknown>
    expect('deleted_at' in snap).toBe(true)
    expect(snap.deleted_at).toBe(null)
  })

  it('temizlenen alan undefined yerine null olarak yazılır ve push edilir', async () => {
    await localUpsert('transactions', tx('t1', { categoryId: 'c1' }))
    await localPatch('transactions', 't1', { categoryId: undefined })

    // Dexie undefined anahtarı silerdi; nullifyPatch bunu null'a çevirmeli
    expect((await txTable.get('t1'))!.categoryId).toBe(null)
    const snap = (await outbox.get('transactions:t1'))!.snapshot as Record<string, unknown>
    expect(snap.categoryId).toBe(null)
  })

  it('softDelete tombstone damgalar ve kuyruğa bir GÜNCELLEME olarak girer', async () => {
    await localUpsert('transactions', tx('t1'))
    await softDelete('transactions', 't1')

    const row = (await txTable.get('t1'))!
    expect(row.deleted_at).toBeTruthy()   // satır SİLİNMEZ, işaretlenir
    const snap = (await outbox.get('transactions:t1'))!.snapshot as Record<string, unknown>
    expect(snap.deleted_at).toBeTruthy()
  })

  it('localBulkUpsert her varlık için girdi bırakır', async () => {
    await localBulkUpsert('transactions', [tx('t1'), tx('t2'), tx('t3')])
    expect(await pendingCount()).toBe(3)
  })

  it('localPatchMany toplu tombstone\'u tek geçişte kuyruğa alır', async () => {
    await localBulkUpsert('transactions', [tx('t1'), tx('t2')])
    await localPatchMany('transactions', ['t1', 't2'], { deleted_at: '2026-03-05T00:00:00Z' })
    const entries = await outbox.toArray()
    expect(entries.every(e => (e.snapshot as Record<string, unknown>).deleted_at === '2026-03-05T00:00:00Z')).toBe(true)
  })

  it('localBatch tablolar arası işlemi tek blokta kuyruğa alır', async () => {
    await localUpsert('transactions', tx('t1'))
    await localUpsert('accounts', { id: 'a1', name: 'Vadesiz', initialBalance: 0 })

    await localBatch([
      { kind: 'patchMany', table: 'transactions', ids: ['t1'], patch: { deleted_at: 'ts' } },
      { kind: 'patch', table: 'accounts', id: 'a1', patch: { deleted_at: 'ts' } },
    ])

    expect(((await outbox.get('transactions:t1'))!.snapshot as Record<string, unknown>).deleted_at).toBe('ts')
    expect(((await outbox.get('accounts:a1'))!.snapshot as Record<string, unknown>).deleted_at).toBe('ts')
  })

  it('var olmayan kaydı patch\'lemek kuyruğa girdi eklemez', async () => {
    await localPatch('transactions', 'yok', { amount: 1 })
    expect(await pendingCount()).toBe(0)
  })
})

/* ── Flush ──────────────────────────────────────────────────────────────── */

describe('flushOutbox — ACK, hata ve kimlik koruması', () => {
  it('başarılı push girdiyi siler ve user_id\'yi oturumdan basar', async () => {
    await localUpsert('transactions', tx('t1'))
    await flushOutbox()

    expect(await pendingCount()).toBe(0)
    expect(upsertCalls[0].payload.user_id).toBe('user-1')
  })

  it('hata girdiyi KORUR ve deneme sayacını artırır', async () => {
    upsertImpl = async () => ({ error: { message: 'network down' } })
    await localUpsert('transactions', tx('t1'))
    await flushOutbox()

    const entry = (await outbox.get('transactions:t1'))!
    expect(entry.attempts).toBe(1)
    expect(entry.lastError).toBe('network down')
  })

  it('oturum yokken hiçbir şey push etmez, kuyruğu dayanıklı bırakır', async () => {
    await localUpsert('transactions', tx('t1'))
    currentUid = null
    await flushOutbox()

    expect(upsertCalls).toHaveLength(0)
    expect(await pendingCount()).toBe(1)
  })

  it('BAŞKA kullanıcının girdisini asla oynatmaz — düşürür (kiracılar arası sızıntı)', async () => {
    await localUpsert('transactions', tx('t1'))   // ownerId: user-1
    currentUid = 'user-2'
    await flushOutbox()

    expect(upsertCalls).toHaveLength(0)
    expect(await pendingCount()).toBe(0)          // girdi düşürüldü, push EDİLMEDİ
  })

  it('MAX_SYNC_ATTEMPTS sonrası otomatik denemeyi bırakır (dead-letter)', async () => {
    await localUpsert('transactions', tx('t1'))
    await outbox.update('transactions:t1', { attempts: MAX_SYNC_ATTEMPTS })

    await flushOutbox()
    expect(upsertCalls).toHaveLength(0)
    expect(await pendingCount()).toBe(1)          // dayanıklı kalır (inceleme için)
  })

  it('retryDeadLetters sayaçları sıfırlar ve yeniden dener', async () => {
    await localUpsert('transactions', tx('t1'))
    await outbox.update('transactions:t1', { attempts: MAX_SYNC_ATTEMPTS })

    await retryDeadLetters()
    expect(upsertCalls).toHaveLength(1)
    expect(await pendingCount()).toBe(0)
  })

  it('boş string kimlik referanslarını PUSH SINIRINDA temizler (kuyruk takılmasın)', async () => {
    // Kuyrukta ZATEN bozuk olan satır da kendiliğinden düzelmeli
    await localUpsert('transactions', tx('t1', { accountId: '', categoryId: '', toAccountId: '' }))
    await flushOutbox()

    const payload = upsertCalls[0].payload
    expect(payload.accountId).toBe(null)
    expect(payload.categoryId).toBe(null)
    expect(payload.toAccountId).toBe(null)
    expect(payload.id).toBe('t1')   // birincil anahtar ASLA null'a çevrilmez
  })

  it('bir girdinin hatası diğerlerinin push edilmesini engellemez', async () => {
    upsertImpl = async (_t, payload) =>
      payload.id === 't1' ? ({ error: { message: 'poison' } }) : ({ error: null })

    await localUpsert('transactions', tx('t1'))
    await localUpsert('transactions', tx('t2'))
    await flushOutbox()

    expect(await outbox.get('transactions:t1')).toBeDefined()   // takılı kalan
    expect(await outbox.get('transactions:t2')).toBeUndefined() // ACK'lenen
  })
})

/* ── Uzlaştıran çekiş ───────────────────────────────────────────────────── */

describe('reconcilingPull — yerel veriyi yok etmeden birleştirme', () => {
  it('bulut satırlarını yerele yazar ve canlı olanları döndürür', async () => {
    selectImpl = async () => ({ data: [tx('c1') as Row, tx('c2') as Row], error: null })
    const rows = await reconcilingPull<{ id: string }>('transactions')
    expect(rows.map(r => r.id).sort()).toEqual(['c1', 'c2'])
    expect(await txTable.get('c1')).toBeDefined()
  })

  it('tombstone\'lu bulut satırını yazar ama SONUÇTAN eler', async () => {
    selectImpl = async () => ({ data: [tx('c1', { deleted_at: '2026-03-02T00:00:00Z' }) as Row], error: null })
    const rows = await reconcilingPull<{ id: string }>('transactions')

    expect(rows).toHaveLength(0)                          // UI'da görünmez
    expect((await txTable.get('c1'))!.deleted_at).toBeTruthy()  // ama yerelde DURUR
  })

  it('bekleyen yerel yazmayı bulut sürümüyle EZMEZ', async () => {
    await localUpsert('transactions', tx('t1', { amount: 999 }))   // henüz push edilmedi
    selectImpl = async () => ({ data: [tx('t1', { amount: 250 }) as Row], error: null })

    await reconcilingPull('transactions')
    expect((await txTable.get('t1'))!.amount).toBe(999)   // yerel kazanır
  })

  it('bulutta olmayan yerel satırı SİLMEZ — yeniden kuyruğa alır ve kullanıcıyı uyarır', async () => {
    await txTable.put(tx('orphan') as Row)   // outbox girdisi olmadan (push kaybolmuş)
    selectImpl = async () => ({ data: [], error: null })

    const rows = await reconcilingPull<{ id: string }>('transactions')
    expect(rows.map(r => r.id)).toEqual(['orphan'])       // yok edilmedi
    expect(await outbox.get('transactions:orphan')).toBeDefined()
    expect(notifications[0]).toContain('bulutta yoktu')
  })

  it('EKSİK çekişte yerel duruma HİÇ dokunmaz (çevrimdışı güvenliği)', async () => {
    await txTable.put(tx('local') as Row)
    selectImpl = async () => ({ data: null, error: { message: 'offline' } })

    const rows = await reconcilingPull<{ id: string }>('transactions')
    expect(rows.map(r => r.id)).toEqual(['local'])
    expect(await pendingCount()).toBe(0)   // yeniden kuyruğa alma YOK
  })

  it('oturum yokken çekişi tamamen atlar (boş RLS sonucu silme sanılmasın)', async () => {
    await txTable.put(tx('local') as Row)
    currentUid = null

    const rows = await reconcilingPull<{ id: string }>('transactions')
    expect(rows.map(r => r.id)).toEqual(['local'])
    expect(await pendingCount()).toBe(0)
  })

  it('başka cihazda silinen kayıt, bekleyen düzenleme yüzünden DİRİLİR', async () => {
    // Denetim bulgusu #22 — karakterizasyon testi (hata değil, ÇÖZÜLMEMİŞ çakışma).
    // Cihaz A kaydı sildi (bulutta tombstone). Cihaz B'de aynı kayda ait
    // gönderilmemiş bir düzenleme var. Çekişteki `pending` koruması bulut
    // satırını TÜMÜYLE atlıyor — silme bilgisi de atlanıyor. B'nin snapshot'ı
    // `deleted_at: null` taşıdığı için push kaydı buluta geri diriltir.
    //
    // "Doğru" davranış bir ÜRÜN kararıdır (silme mi kazanmalı, kullanıcıya mı
    // sorulmalı), bu yüzden test `it.fails` değil: mevcut davranışı kayda
    // geçirir. Politika değişirse bu test bilinçli olarak güncellenmelidir.
    await localUpsert('transactions', tx('t1', { amount: 2500 }))   // B'nin bekleyen düzenlemesi
    selectImpl = async () => ({ data: [tx('t1', { deleted_at: '2026-03-02T00:00:00Z' }) as Row], error: null })

    const rows = await reconcilingPull<{ id: string }>('transactions')

    expect(rows.map(r => r.id)).toEqual(['t1'])                    // silme UYGULANMADI
    expect((await txTable.get('t1'))!.deleted_at).toBeUndefined()
    const snap = (await outbox.get('transactions:t1'))!.snapshot as Record<string, unknown>
    expect(snap.deleted_at).toBe(null)                             // push kaydı diriltecek
  })

  it('bekleyen girdisi OLAN satır yeniden kuyruğa alınmaz (sayaç korunur)', async () => {
    // Denetim bulgusu #12'nin ikinci mekanizması bu testle ÇÜRÜTÜLDÜ:
    // dead-letter'daki satır hâlâ `pending` kümesindedir, dolayısıyla
    // reconcilingPull onu putOutbox'tan geçirmez ve attempts sıfırlanmaz.
    await localUpsert('transactions', tx('t1'))
    await outbox.update('transactions:t1', { attempts: MAX_SYNC_ATTEMPTS })
    selectImpl = async () => ({ data: [], error: null })

    await reconcilingPull('transactions')

    expect((await outbox.get('transactions:t1'))!.attempts).toBe(MAX_SYNC_ATTEMPTS)
    expect(notifications).toHaveLength(0)   // yanlış "bulutta yoktu" uyarısı da yok
  })
})

/* ── Çekişin yetkisi: boş sonuç "kayıt yok" mu? ──────────────────────────
   Eksik çekiş yerel satırları döndürür; çıkış sonrası yerel boştur. Varsayılan
   çalışma alanı/kategori üreten akışlar boş sonucu ancak yetkili çekişte
   "hiç kayıt yok" sayabilir (ikinci "Genel" alanı vakası). */
describe('lastPullWasAuthoritative', () => {
  it('eksiksiz çekişten sonra yetkilidir', async () => {
    await reconcilingPull('workspaces')
    expect(lastPullWasAuthoritative('workspaces')).toBe(true)
  })

  it('çekiş hatasında yetkisizdir — önceki başarılı çekişin bayrağını taşımaz', async () => {
    await reconcilingPull('workspaces')
    selectImpl = async () => ({ data: null, error: { message: 'network' } })

    const rows = await reconcilingPull('workspaces')

    expect(rows).toEqual([])
    expect(lastPullWasAuthoritative('workspaces')).toBe(false)
  })

  it('oturum yokken yalnız yerel mod yetkili sayılır', async () => {
    currentUid = null
    await reconcilingPull('categories')
    expect(lastPullWasAuthoritative('categories')).toBe(true)
  })
})

/* ── Push sırasında düzenleme: kayıp yazma ────────────────────────────────
   Denetim bulgusu #2. Outbox girdi kimliği sabittir (`table:id`), dolayısıyla
   push devam ederken yapılan bir düzenleme AYNI girdinin üzerine yazar. ACK
   döndüğünde flush `delete(e.id)` çağırıyor ve sürüm kıyası yapmadığı için
   TAZE girdiyi siliyor: düzenleme kuyruktan yok oluyor, buluta hiç gitmiyor.

   Aşağıdaki test DOĞRU davranışı iddia ediyor ve şu an başarısız (`it.fails`).
   Düzeltme: ACK'te `updatedAt` kıyaslı koşullu silme.
──────────────────────────────────────────────────────────────────────── */
describe('push sırasında düzenleme — düzeltilen hata #2', () => {
  /** Bir push'u askıya alıp o sırada kaydı düzenler; ilk isteği serbest bırakır. */
  async function editDuringPush(onFirstPush: () => { error: { message: string } | null }) {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let first = true

    upsertImpl = async () => {
      if (!first) return { error: null }
      first = false
      await gate
      return onFirstPush()
    }

    await localUpsert('transactions', tx('t1', { amount: 250 }))
    const flushing = flushOutbox()
    await Promise.resolve()                                    // flush upsert await'ine ulaşsın
    await localPatch('transactions', 't1', { amount: 2500 })   // kullanıcı düzeltiyor
    release()
    await flushing
  }

  it('düzenleme KAYBOLMAZ — taze tutar buluta ulaşır', async () => {
    await editDuringPush(() => ({ error: null }))

    // Düzeltme öncesi: ACK, taze girdiyi silerdi ve 2500 buluta hiç gitmezdi.
    expect(upsertCalls).toHaveLength(2)
    expect(upsertCalls[0].payload.amount).toBe(250)
    expect(upsertCalls[1].payload.amount).toBe(2500)
    expect(await pendingCount()).toBe(0)                 // ikinci push da ACK'lendi
    expect((await txTable.get('t1'))!.amount).toBe(2500)
  })

  it('yeniden push başarısız olursa düzenleme kuyrukta KALIR (kayıp yok)', async () => {
    // Taze girdi gönderilemese bile silinmemeli — dayanıklılık şartı.
    let first = true
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    upsertImpl = async () => {
      if (!first) return { error: { message: 'offline' } }
      first = false
      await gate
      return { error: null }
    }

    await localUpsert('transactions', tx('t1', { amount: 250 }))
    const flushing = flushOutbox()
    await Promise.resolve()
    await localPatch('transactions', 't1', { amount: 2500 })
    release()
    await flushing

    const entry = await outbox.get('transactions:t1')
    expect(entry).toBeDefined()
    expect((entry!.snapshot as Record<string, unknown>).amount).toBe(2500)
  })

  it('kuyrukta bekleyen düzenleme varken çekiş yerel değeri EZMEZ', async () => {
    // `pending` koruması: gönderilememiş yerel yazma bulut sürümünden üstündür.
    upsertImpl = async () => ({ error: { message: 'offline' } })
    await localUpsert('transactions', tx('t1', { amount: 2500 }))
    await flushOutbox()
    expect(await pendingCount()).toBe(1)

    selectImpl = async () => ({ data: [tx('t1', { amount: 250 }) as Row], error: null })
    await reconcilingPull('transactions')

    expect((await txTable.get('t1'))!.amount).toBe(2500)
  })

  it('taze girdinin deneme sayacı eski isteğin hatasıyla kirlenmez', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    upsertImpl = async () => { await gate; return { error: { message: 'network down' } } }

    await localUpsert('transactions', tx('t1', { amount: 250 }))
    const flushing = flushOutbox()
    await Promise.resolve()
    await localPatch('transactions', 't1', { amount: 2500 })   // taze yük → yeni bütçe
    release()
    await flushing

    const entry = (await outbox.get('transactions:t1'))!
    expect(entry.attempts).toBe(0)
    expect((entry.snapshot as Record<string, unknown>).amount).toBe(2500)
  })
})
