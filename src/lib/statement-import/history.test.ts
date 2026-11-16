import { describe, it, expect } from 'vitest'
import { txIdFromSeed, type DraftTx, type PlanRow, type RowOption } from './classify'
import { buildHistoryCommit, changedRows, skippedAsOf, transactionsAsOf, type CommittedBaseline } from './history'
import type { Transaction } from '@/types'

const draft = (seed: string, extra: Partial<DraftTx> = {}): DraftTx => ({
  type: 'expense', amount: 100, date: '2026-10-21', description: 'ATM', merchant: 'ATM',
  categoryId: 'c-nakit', idSeed: seed, editable: true, ...extra,
} as DraftTx)
const row = (key: string, seed: string, status: PlanRow['status'] = 'review'): PlanRow => {
  const create: RowOption = { key: 'create', label: 'Gir', actions: [{ type: 'create', draft: draft(seed) }] }
  const income: RowOption = { key: 'income', label: 'Gelir olarak gir', actions: [{ type: 'create', draft: draft(seed, { type: 'income' }) }] }
  const skip: RowOption = { key: 'skip', label: 'Girme', actions: [] }
  return {
    key, lines: [0], status, kind: 'unknown', date: '2026-10-21', amount: 100, bonus: null,
    title: 'ATM', raw: 'ATM', reason: '', options: [create, income, skip], recommended: null,
    defaultOption: status === 'new' ? 0 : null, sideEffects: [], stableKey: `s-${key}`,
  } as PlanRow
}
const tx = (id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id, type: 'expense', amount: 100, amountTry: 100, currency: 'TRY', date: '2026-10-21', accountId: 'acc',
  description: 'ATM', isInstallment: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', ...extra,
} as Transaction)

const base = (choices: Record<string, string>, ownTxIds: string[] = []): CommittedBaseline => ({
  ownTxIds: new Set(ownTxIds), committedAt: '2026-11-01T10:00:00Z', choices, edits: {},
})

const commit = (rows: PlanRow[], choices: Record<string, string>, b: CommittedBaseline, existing: Transaction[], liveMatches = new Map<string, string[]>()) =>
  buildHistoryCommit({
    rows, choices, edits: {}, accountId: 'acc', existing: new Map(existing.map(t => [t.id, t])), people: [],
    nowIso: '2026-11-16T00:00:00Z', todayStr: '2026-11-16', newId: () => 'p', base: b, liveMatches,
  })

describe('yüklenmiş ekstre: onay anındaki kayıtlar', () => {
  it('bu ekstrenin girdikleri ve onaydan sonra girilenler eşleşmeye katılmaz', () => {
    const txs = [tx('own'), tx('older', { createdAt: '2026-10-01T00:00:00Z' }), tx('later', { createdAt: '2026-11-10T00:00:00Z' })]
    expect(transactionsAsOf(txs, base({}, ['own'])).map(t => t.id)).toEqual(['older'])
  })

  it('"girme" hafızasından yalnız bu ekstrede karar verilen satırlar düşer', () => {
    const rows = [row('L0', 'a'), row('L1', 'b')]
    expect([...skippedAsOf(new Set(['s-L0', 's-L1', 'başka']), rows, { L0: 'skip' })].sort()).toEqual(['başka', 's-L1'])
  })

  it('değişen satırlar: karar ya da düzenleme farklı olanlar', () => {
    const rows = [row('L0', 'a'), row('L1', 'b'), row('L2', 'c', 'new')]
    const b = base({ L0: 'skip', L1: 'create' })
    expect(changedRows(rows, { L0: 'skip', L1: 'create' }, {}, b)).toEqual([])
    expect(changedRows(rows, { L0: 'create', L1: 'create' }, {}, b).map(r => r.key)).toEqual(['L0'])
    expect(changedRows(rows, { L0: 'skip', L1: 'create' }, { L1: { description: 'x' } }, b).map(r => r.key)).toEqual(['L1'])
    // Otomatik satırda varsayılan ile aynı seçim değişiklik sayılmaz
    expect(changedRows(rows, { L0: 'skip', L1: 'create', L2: 'create' }, {}, b)).toEqual([])
  })
})

describe('yüklenmiş ekstrede kararı değiştirip kaydetmek', () => {
  const idA = txIdFromSeed('a')
  const idB = txIdFromSeed('b')

  it('hiçbir şey değişmediyse hiçbir şey yazılmaz (sonradan düzenlenen kayda dokunulmaz)', () => {
    const rows = [row('L0', 'a'), row('L1', 'b')]
    const res = commit(rows, { L0: 'skip', L1: 'create' }, base({ L0: 'skip', L1: 'create' }, [idB]), [tx(idB, { description: 'elle düzeltildi' })])
    expect(res.ops).toEqual([])
    expect(res.changed).toBe(0)
  })

  it('"Girme" → "Gir": yalnız o satır girilir, hafızadan çıkar', () => {
    const rows = [row('L0', 'a'), row('L1', 'b')]
    const res = commit(rows, { L0: 'create', L1: 'create' }, base({ L0: 'skip', L1: 'create' }, [idB]), [tx(idB)])
    expect(res.createdTxIds).toEqual([idA])
    expect(res.unskippedKeys).toEqual(['s-L0'])
    expect(res.problems).toEqual([])
  })

  it('"Gir" → "Girme": bu ekstrenin girdiği kayıt silinir, geri almada geri gelir', () => {
    const rows = [row('L0', 'a')]
    const res = commit(rows, { L0: 'skip' }, base({ L0: 'create' }, [idA]), [tx(idA)])
    expect(res.deletedTxIds).toEqual([idA])
    expect(res.skippedKeys).toEqual(['s-L0'])
    expect(res.ops).toContainEqual({ kind: 'patchMany', table: 'transactions', ids: [idA], patch: { deleted_at: '2026-11-16T00:00:00Z' } })
    expect(res.undo).toContainEqual({ kind: 'patchMany', table: 'transactions', ids: [idA], patch: { deleted_at: null } })
  })

  it('gider → gelir: aynı kayıt yeniden yazılır, ilk giriş zamanı korunur, geri alma eski hali koyar', () => {
    const rows = [row('L0', 'a')]
    const old = tx(idA)
    const res = commit(rows, { L0: 'income' }, base({ L0: 'create' }, [idA]), [old])
    expect(res.createdTxIds).toEqual([])
    expect(res.rewrittenTxIds).toEqual([idA])
    const up = res.ops.find(o => o.kind === 'upsert') as { entity: Transaction }
    expect(up.entity.type).toBe('income')
    expect(up.entity.createdAt).toBe(old.createdAt)
    expect(res.undo).toContainEqual({ kind: 'upsert', table: 'transactions', entity: old })
    expect(res.undo.some(o => o.kind === 'patchMany' && o.ids.includes(idA))).toBe(false)
  })

  it('sonradan başka bir kayıtla girilmiş satır yeniden girilmez (mükerrer)', () => {
    const rows = [row('L0', 'a')]
    const res = commit(rows, { L0: 'create' }, base({ L0: 'skip' }), [tx('elle')], new Map([['s-L0', ['elle']]]))
    expect(res.problems.map(p => p.rowKey)).toEqual(['L0'])
  })
})
