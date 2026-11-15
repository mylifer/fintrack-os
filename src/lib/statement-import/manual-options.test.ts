import { describe, it, expect } from 'vitest'
import { buildCommit, type RowEdit } from './commit'
import { manualOptionsFor, MANUAL_KEYS, withManualOptions } from './manual-options'
import { txIdFromSeed, type ImportPlan, type PlanRow, type RowOption } from './classify'
import type { Transaction } from '@/types'

const skip: RowOption = { key: 'skip', label: 'Girme', actions: [] }
const row = (over: Partial<PlanRow> = {}): PlanRow => ({
  key: 'l0', lines: [0], status: 'review', kind: 'transfer-out', date: '2026-11-13', amount: 11000, bonus: null,
  title: 'Damla Baytur · Akbank', raw: 'Damla Baytur', reason: '', options: [skip], recommended: null, defaultOption: null,
  sideEffects: [], stableKey: 'seed-x', ...over,
} as PlanRow)

const commit = (r: PlanRow, choice: string, edit?: RowEdit, workspaceId: string | null = 'ws-a') => {
  const withOpts = withManualOptions({ rows: [r] } as ImportPlan).rows[0]
  return buildCommit({
    rows: [withOpts], choices: { l0: choice }, edits: edit ? { l0: edit } : {}, accountId: 'acc', existing: new Map(), people: [],
    nowIso: '2026-11-15T00:00:00Z', todayStr: '2026-11-15', newId: () => 'p', workspaceId,
  })
}
const txs = (res: ReturnType<typeof buildCommit>) => res.ops.filter(o => o.kind === 'upsert' && o.table === 'transactions')
  .map(o => (o as unknown as { entity: Transaction }).entity)

describe('elle gir seçenekleri', () => {
  it('çıkışta Gider + Transfer, girişte Gelir + Transfer eklenir', () => {
    expect(manualOptionsFor(row()).map(o => o.key)).toEqual([MANUAL_KEYS.expense, MANUAL_KEYS.transfer])
    expect(manualOptionsFor(row({ amount: -500 })).map(o => o.key)).toEqual([MANUAL_KEYS.income, MANUAL_KEYS.transfer])
  })

  it('sistemde olan, satırsız ya da tutarsız satıra eklenmez', () => {
    expect(manualOptionsFor(row({ status: 'exists' }))).toEqual([])
    expect(manualOptionsFor(row({ lines: [] }))).toEqual([])
    expect(manualOptionsFor(row({ amount: null }))).toEqual([])
  })

  it('satırda zaten gider seçeneği varsa elle gider eklenmez (transfer yine eklenir)', () => {
    const r = commit(row(), 'skip')
    expect(r.problems).toEqual([])
    const existing: RowOption = { key: 'c', label: 'Gider', actions: [{ type: 'create', draft: { type: 'expense', amount: 1, date: '', description: '', idSeed: 's', editable: true } }] }
    expect(manualOptionsFor(row({ options: [existing, skip] })).map(o => o.key)).toEqual([MANUAL_KEYS.transfer])
  })

  it('elle gider: kategori zorunlu, kimlik satırın sabit anahtarından', () => {
    expect(commit(row(), MANUAL_KEYS.expense).problems[0].message).toBe('Kategori seçilmedi')
    const res = commit(row(), MANUAL_KEYS.expense, { categoryId: 'cat' })
    expect(res.problems).toEqual([])
    expect(txs(res)).toEqual([expect.objectContaining({ id: txIdFromSeed('seed-x'), type: 'expense', amount: 11000, categoryId: 'cat', accountId: 'acc' })])
  })

  it('elle transfer → hesap', () => {
    expect(commit(row(), MANUAL_KEYS.transfer).problems[0].message).toBe('Transfer hesabı seçilmedi')
    const res = commit(row(), MANUAL_KEYS.transfer, { toAccountId: 'other' })
    expect(txs(res)).toEqual([expect.objectContaining({ type: 'transfer', accountId: 'acc', toAccountId: 'other', amount: 11000 })])
    expect(res.debtPayments).toEqual([])
  })

  it('gelen elle transfer → kaynak hesap', () => {
    const res = commit(row({ amount: -500 }), MANUAL_KEYS.transfer, { fromAccountId: 'src' })
    expect(txs(res)).toEqual([expect.objectContaining({ type: 'transfer', accountId: 'src', toAccountId: 'acc', amount: 500 })])
  })

  it('elle transfer → bu alandaki borç: debtId\'li transfer + borç ödemesi', () => {
    expect(commit(row(), MANUAL_KEYS.transfer, { transferMode: 'debt' }).problems[0].message).toBe('Ödenecek borç seçilmedi')
    const res = commit(row(), MANUAL_KEYS.transfer, { transferMode: 'debt', debtId: 'd1', toAccountId: 'ignored' })
    expect(txs(res)).toEqual([expect.objectContaining({ type: 'transfer', accountId: 'acc', debtId: 'd1' })])
    expect(txs(res)[0].toAccountId).toBeUndefined()
    expect(res.debtPayments).toEqual([{ debtId: 'd1', amount: 11000 }])
  })

  it('elle transfer → diğer alanın hesabı: gider + karşı alanda gelir, ortak bağ', () => {
    expect(commit(row(), MANUAL_KEYS.transfer, { transferMode: 'workspace' }).problems[0].message).toBe('Hedef çalışma alanı seçilmedi')
    expect(commit(row(), MANUAL_KEYS.transfer, { transferMode: 'workspace', crossWs: { workspaceId: 'ws-b' } }).problems[0].message).toBe('Hedef hesap seçilmedi')
    const res = commit(row(), MANUAL_KEYS.transfer, { transferMode: 'workspace', crossWs: { workspaceId: 'ws-b', accountId: 'b-acc' } })
    const [out, inc] = txs(res)
    expect(out).toEqual(expect.objectContaining({ id: txIdFromSeed('seed-x'), type: 'expense', accountId: 'acc', workspaceId: 'ws-a', peerWorkspaceId: 'ws-b', icon: '⇄' }))
    expect(inc).toEqual(expect.objectContaining({ type: 'income', accountId: 'b-acc', workspaceId: 'ws-b', peerWorkspaceId: 'ws-a', amount: 11000 }))
    expect(out.workspaceTransferId).toBeTruthy()
    expect(inc.workspaceTransferId).toBe(out.workspaceTransferId)
    expect(res.debtPayments).toEqual([])
  })

  it('elle transfer → diğer alandaki borcu öde: gider + gelir + o hesaptan borç ödemesi', () => {
    expect(commit(row(), MANUAL_KEYS.transfer, { transferMode: 'workspace', crossWs: { workspaceId: 'ws-b', payDebt: true, accountId: 'b-acc' } }).problems[0].message)
      .toBe('Ödenecek borç seçilmedi')
    const res = commit(row(), MANUAL_KEYS.transfer, { transferMode: 'workspace', crossWs: { workspaceId: 'ws-b', payDebt: true, debtId: 'd9', accountId: 'b-acc' } })
    const all = txs(res)
    expect(all).toHaveLength(3)
    const pay = all[2]
    expect(pay).toEqual(expect.objectContaining({ type: 'transfer', accountId: 'b-acc', debtId: 'd9', workspaceId: 'ws-b', amount: 11000 }))
    expect(pay.icon).toBeUndefined()
    expect(new Set(all.map(t => t.workspaceTransferId)).size).toBe(1)
    expect(res.debtPayments).toEqual([{ debtId: 'd9', amount: 11000 }])
    // Geri alma oluşturulan üç satırı da siler
    expect(res.undo).toEqual([expect.objectContaining({ kind: 'patchMany', ids: all.map(t => t.id) })])
  })
})
