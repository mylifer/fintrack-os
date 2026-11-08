import { describe, it, expect } from 'vitest'
import { buildCommit, chosenIndex, selectedOption } from './commit'
import type { DraftTx, PlanRow, RowOption } from './classify'

const draft: DraftTx = {
  type: 'expense', amount: 100, date: '2026-10-21', description: 'ATM', merchant: 'ATM',
  categoryId: 'c-nakit', idSeed: 'seed-1', editable: true,
} as DraftTx
const create: RowOption = { key: 'create', label: 'Gir', actions: [{ type: 'create', draft }] }
const skip: RowOption = { key: 'skip', label: 'Girme', actions: [] }
const row = (options: RowOption[]): PlanRow => ({
  key: 'l0', lines: [0], status: 'review', kind: 'unknown', date: '2026-10-21', amount: 100, bonus: null,
  title: 'ATM', raw: 'ATM', reason: '', options, recommended: null, defaultOption: null, sideEffects: [], stableKey: 's0',
} as PlanRow)
const commit = (r: PlanRow, choices: Record<string, string>) => buildCommit({
  rows: [r], choices, edits: {}, accountId: 'acc', existing: new Map(), people: [],
  nowIso: '2026-11-03T00:00:00Z', todayStr: '2026-11-03', newId: () => 'p',
})

describe('kararlar seçenek anahtarıyla saklanır', () => {
  it('seçenekler yeniden sıralansa da aynı karar uygulanır', () => {
    const r = row([skip, create])
    expect(chosenIndex(r, { l0: 'create' })).toBe(1)
    expect(selectedOption(r, { l0: 'create' })).toBe(1)
    expect(commit(r, { l0: 'create' }).createdTxIds).toHaveLength(1)
  })

  it('planda artık olmayan seçenek "karar verilmedi" sayılır (sessizce atlanmaz)', () => {
    const r = row([skip])
    expect(chosenIndex(r, { l0: 'create' })).toBeNull()
    expect(selectedOption(r, { l0: 'create' })).toBeNull()
    const res = commit(r, { l0: 'create' })
    expect(res.problems).toEqual([{ rowKey: 'l0', message: 'Karar verilmedi' }])
    expect(res.skippedKeys).toEqual([])
  })

  it('geçersiz varsayılan seçenek de karar sayılmaz', () => {
    const r = { ...row([create]), defaultOption: 3 }
    expect(commit(r, {}).problems).toEqual([{ rowKey: 'l0', message: 'Karar verilmedi' }])
  })
})
