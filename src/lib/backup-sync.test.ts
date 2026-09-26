import { describe, it, expect, beforeEach, vi } from 'vitest'

/* ────────────────────────────────────────────────────────────────────────
   backup-sync — Ödeme Takibi tablolarının geri yüklenmesi

   restore_user_backup RPC'si payment_plans / payment_occurrences'ı bilmiyor;
   eskiden bu tablolar yedeğe hiç girmiyordu ve geri yükleme onları olduğu gibi
   (geri yüklenen işlemlerle tutarsız) bırakıyordu. replaceOutboxTables bu iki
   tabloyu outbox üzerinden değiştirir. Testler kararı (hangi op'lar) sabitler.
──────────────────────────────────────────────────────────────────────── */

type Row = { id: string; deleted_at?: string | null }

const tables = {
  paymentPlans:       { rows: [] as Row[], toArray: async () => tables.paymentPlans.rows },
  paymentOccurrences: { rows: [] as Row[], toArray: async () => tables.paymentOccurrences.rows },
  savingsGoals:       { rows: [] as Row[], toArray: async () => tables.savingsGoals.rows },
}
const batches: unknown[][] = []

vi.mock('@/lib/db', () => ({ db: tables }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/sync/engine', () => ({
  localBatch: async (ops: unknown[]) => { batches.push(ops) },
}))

const { replaceOutboxTables } = await import('./backup-sync')

const base = {
  accounts: [], transactions: [], categories: [], budgets: [], debts: [],
  investmentTransactions: [], people: [], recurringTransactions: [],
}

beforeEach(() => {
  batches.length = 0
  tables.paymentPlans.rows = []
  tables.paymentOccurrences.rows = []
  tables.savingsGoals.rows = []
})

describe('replaceOutboxTables', () => {
  it('eski yedek (anahtar yok) mevcut kayıtlara dokunmaz', async () => {
    tables.paymentPlans.rows = [{ id: 'p1' }]
    tables.paymentOccurrences.rows = [{ id: 'o1' }]

    await replaceOutboxTables(base)

    expect(batches).toEqual([[]])
  })

  it('yedekte olmayan canlı kaydı tombstone\'lar, yedektekileri upsert eder', async () => {
    tables.paymentPlans.rows = [{ id: 'p-keep' }, { id: 'p-gone' }, { id: 'p-dead', deleted_at: '2026-09-01T00:00:00Z' }]

    await replaceOutboxTables({ ...base, paymentPlans: [{ id: 'p-keep' }, { id: 'p-new' }] as never })

    const ops = batches[0] as Array<Record<string, unknown>>
    expect(ops.filter(o => o.kind === 'patch').map(o => o.id)).toEqual(['p-gone'])
    expect(ops.filter(o => o.kind === 'upsert').map(o => (o.entity as Row).id)).toEqual(['p-keep', 'p-new'])
    expect(ops.every(o => o.table === 'payment_plans')).toBe(true)
  })

  it('boş dizi "hiç kayıt yoktu" demektir — hepsi tombstone\'lanır', async () => {
    tables.paymentOccurrences.rows = [{ id: 'o1' }, { id: 'o2' }]

    await replaceOutboxTables({ ...base, paymentOccurrences: [] })

    const ops = batches[0] as Array<Record<string, unknown>>
    expect(ops.map(o => [o.kind, o.table, o.id])).toEqual([
      ['patch', 'payment_occurrences', 'o1'],
      ['patch', 'payment_occurrences', 'o2'],
    ])
  })

  it('iki tablo tek batch\'te (yerelde ya hep ya hiç)', async () => {
    await replaceOutboxTables({ ...base, paymentPlans: [{ id: 'p1' }] as never, paymentOccurrences: [{ id: 'o1' }] as never })
    expect(batches).toHaveLength(1)
    expect((batches[0] as Array<Record<string, unknown>>).map(o => o.table)).toEqual(['payment_plans', 'payment_occurrences'])
  })

  it('birikim hedefleri de aynı kuralla değişir; anahtar yoksa dokunulmaz', async () => {
    tables.savingsGoals.rows = [{ id: 'g-keep' }, { id: 'g-gone' }]

    await replaceOutboxTables(base)
    expect(batches[0]).toEqual([])

    await replaceOutboxTables({ ...base, savingsGoals: [{ id: 'g-keep' }] as never })
    const ops = batches[1] as Array<Record<string, unknown>>
    expect(ops.map(o => [o.kind, o.table, o.id ?? (o.entity as Row).id])).toEqual([
      ['patch', 'savings_goals', 'g-gone'],
      ['upsert', 'savings_goals', 'g-keep'],
    ])
  })
})

describe('dış ikon adresleri (F6)', () => {
  it('http(s) ikonların alan adları bulunur ve ayıklanır; data: ikon ve emoji kalır', async () => {
    const { externalIconHosts, stripExternalIcons } = await import('./backup-sync')
    const data = {
      accounts: [
        { id: 'a', icon: 'https://evil.example/px.png?u=1' },
        { id: 'b', icon: 'HTTP://Other.example/x' },
        { id: 'c', icon: 'data:image/png;base64,AAAA' },
        { id: 'd', icon: '🏦' },
        { id: 'e' },
      ],
    } as never
    expect(externalIconHosts(data).sort()).toEqual(['evil.example', 'other.example'])
    const stripped = stripExternalIcons(data) as { accounts: { id: string; icon?: string }[] }
    expect(stripped.accounts.map(a => a.icon)).toEqual([undefined, undefined, 'data:image/png;base64,AAAA', '🏦', undefined])
  })
})
