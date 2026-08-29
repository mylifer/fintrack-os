import { describe, it, expect, beforeEach, vi } from 'vitest'

/* ────────────────────────────────────────────────────────────────────────
   auto-backup — readSnapshot tombstone filtresi

   Yedek dosyaları Dexie'nin TÜM satırlarını içeriyordu; Dexie ise silinmiş
   satırların mezar taşlarını da tutar. Geri yükleme RPC'si yükteki her satırı
   canlandırdığı için kullanıcının sildiği kayıtlar diriliyor ve bakiyeler
   sessizce şişiyordu (2026-08-29 güvenlik denetimi: gerçek bir yedekte 785
   satırın 57'si tombstone).

   Bu testler snapshot'ın YALNIZCA canlı satırları taşıdığını sabitler.
──────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown> & { id: string }

class FakeTable {
  rows: Row[] = []
  async toArray() { return this.rows.map(r => ({ ...r })) }
}

const tables = {
  accounts:               new FakeTable(),
  transactions:           new FakeTable(),
  categories:             new FakeTable(),
  budgets:                new FakeTable(),
  debts:                  new FakeTable(),
  investmentTransactions: new FakeTable(),
  people:                 new FakeTable(),
  recurringTransactions:  new FakeTable(),
}

vi.mock('@/lib/db', () => ({ db: tables }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('@/lib/auth', () => ({ getUserId: async () => 'user-1' }))

const { readSnapshot, totalRecords } = await import('./auto-backup')

const live = (id: string): Row => ({ id, amount: 100 })
const dead = (id: string): Row => ({ id, amount: 100, deleted_at: '2026-08-01T00:00:00.000Z' })

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows = []
})

describe('readSnapshot — tombstone filtresi', () => {
  it('silinmiş satırları dışarıda bırakır, canlıları tutar', async () => {
    tables.transactions.rows = [live('t1'), dead('t2'), live('t3'), dead('t4')]

    const snap = await readSnapshot()

    expect(snap.transactions.map(t => t.id)).toEqual(['t1', 't3'])
  })

  it('filtreyi TÜM tablolara uygular — biri bile atlanmamalı', async () => {
    for (const t of Object.values(tables)) t.rows = [live('canli'), dead('olu')]

    const snap = await readSnapshot()

    for (const [table, rows] of Object.entries(snap) as [string, { id: string }[]][]) {
      expect(rows.map(r => r.id), `${table} tombstone sızdırdı`).toEqual(['canli'])
    }
  })

  it('deleted_at null ise satır CANLIDIR (bulut null döndürebilir)', async () => {
    tables.accounts.rows = [{ id: 'a1', deleted_at: null }, { id: 'a2' }]

    const snap = await readSnapshot()

    expect(snap.accounts.map(a => a.id)).toEqual(['a1', 'a2'])
  })

  it('hepsi silinmişse boş snapshot döner → createCloudBackup anlamsız yedek almaz', async () => {
    tables.transactions.rows = [dead('t1'), dead('t2')]
    tables.accounts.rows     = [dead('a1')]

    const snap = await readSnapshot()

    expect(totalRecords(
      Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, v.length])),
    )).toBe(0)
  })

  it('canlı satırların alanlarını değiştirmez', async () => {
    tables.transactions.rows = [{ id: 't1', amount: 42, description: 'Market', tags: ['a'] }]

    const snap = await readSnapshot()

    expect(snap.transactions[0]).toMatchObject({ id: 't1', amount: 42, description: 'Market', tags: ['a'] })
  })
})
