import { describe, it, expect } from 'vitest'
import type { Category, Person, TransactionRule } from '@/types'
import type { DraftTx, PlanRow } from './classify'
import { applyUserRulesToRows } from './user-rules'

type Row = Omit<PlanRow, 'stableKey'>

const rule = (over: Partial<TransactionRule> = {}): TransactionRule => ({
  id: 'r1', pattern: 'migros', matchKind: 'contains', sortOrder: 1, isActive: true,
  categoryId: 'c-market', createdAt: '2026-11-01', updatedAt: '2026-11-01', ...over,
})

const categories: Category[] = [
  { id: 'c-market', name: 'Market', icon: 'x', color: '#000', scope: 'expense', isSystem: false, sortOrder: 0 },
  { id: 'c-yemek', name: 'Yemek', icon: 'x', color: '#000', scope: 'expense', isSystem: false, sortOrder: 0 },
]
const people: Person[] = [{ id: 'p-m', name: 'Migros', role: 'recipient', createdAt: '2026-01-01' }]

const draft = (over: Partial<DraftTx> = {}): DraftTx => ({
  type: 'expense', amount: 120, date: '2026-10-01', description: 'Migros Kadikoy',
  recipientId: null, categoryId: 'c-yemek', idSeed: 's', editable: true, ...over,
})

const row = (over: Partial<Row> = {}, d: DraftTx = draft()): Row => ({
  key: 'L1', lines: [1], status: 'review', kind: 'unknown', date: '2026-10-01', amount: 120, bonus: null,
  title: 'Migros', raw: 'MIGROS KADIKOY ISTANBUL', categoryId: d.categoryId, categoryGuess: true, reason: 'Öneri.',
  options: [
    { key: 'create-new', label: 'Yeni alıcıyla gir', actions: [{ type: 'create', draft: { ...d, newRecipient: 'Migros Kadikoy' } }] },
    { key: 'create', label: 'Alıcısız gir', actions: [{ type: 'create', draft: d }] },
    { key: 'skip', label: 'Girme', actions: [] },
  ],
  recommended: null, defaultOption: null, sideEffects: [], ...over,
})

const ctx = (rules: TransactionRule[]) => ({ rules, accountId: 'a1', categories, people })
const drafts = (r: Row) => r.options.flatMap(o => o.actions).filter(a => a.type === 'create').map(a => (a as { draft: DraftTx }).draft)

describe('applyUserRulesToRows', () => {
  it('kural öğrenilmiş kategori önerisini ezer (önce gelir) ve nedeni yazar', () => {
    const [r] = applyUserRulesToRows([row()], ctx([rule()]))
    expect(drafts(r).map(d => d.categoryId)).toEqual(['c-market', 'c-market'])
    expect(r.categoryId).toBe('c-market')
    expect(r.categoryGuess).toBe(false)
    expect(r.reason).toContain('“migros” kuralın uygulandı')
  })

  it('etiket eklenir; alıcı atanır ama "Yeni alıcıyla gir" seçeneğinin alıcısı korunur', () => {
    const [r] = applyUserRulesToRows([row({}, draft({ tags: ['kart'], needsRecipient: true }))], ctx([rule({ tags: ['Ev'], recipientId: 'p-m' })]))
    const [explicitNew, plain] = drafts(r)
    expect(plain.tags).toEqual(['kart', 'Ev'])
    expect(plain.recipientId).toBe('p-m')
    expect(plain.needsRecipient).toBe(false)
    expect(explicitNew.newRecipient).toBe('Migros Kadikoy')
    expect(explicitNew.recipientId).toBeNull()
    expect(r.recipientId).toBe('p-m')
    expect(r.recipientName).toBe('Migros')
  })

  it('ham metin tutmazsa taslak açıklaması denenir', () => {
    const [r] = applyUserRulesToRows([row({ raw: 'POS 1234' })], ctx([rule({ pattern: 'migros kadıköy', matchKind: 'equals' })]))
    expect(drafts(r)[1].categoryId).toBe('c-market')
  })

  it('hesap ve tutar koşulları taslağa göre değerlendirilir', () => {
    expect(drafts(applyUserRulesToRows([row()], ctx([rule({ accountId: 'a2' })]))[0])[1].categoryId).toBe('c-yemek')
    expect(drafts(applyUserRulesToRows([row()], ctx([rule({ maxAmount: 100 })]))[0])[1].categoryId).toBe('c-yemek')
    expect(drafts(applyUserRulesToRows([row()], ctx([rule({ accountId: 'a1', minAmount: 100 })]))[0])[1].categoryId).toBe('c-market')
  })

  it('sistemde olan, ters kontrol, transfer, iade bağı ve var olan taksit satırlarına dokunulmaz', () => {
    const rules = [rule()]
    const exists = row({ status: 'exists' })
    const orphan = row({ kind: 'orphan', lines: [] })
    const transfer = row({}, draft({ type: 'transfer', categoryId: undefined }))
    const refund = row({}, draft({ refundOfId: 't9' }))
    const inst = row({}, draft({ installmentOf: { groupId: 'g', index: 2, count: 3 } }))
    const out = applyUserRulesToRows([exists, orphan, transfer, refund, inst], ctx(rules))
    expect(out[0]).toBe(exists)
    expect(out[1]).toBe(orphan)
    expect(out[2]).toBe(transfer)
    expect(out[3]).toBe(refund)
    expect(out[4]).toBe(inst)
  })

  it('etkin kural yoksa dizi aynen döner', () => {
    const rows = [row()]
    expect(applyUserRulesToRows(rows, ctx([]))).toBe(rows)
    expect(applyUserRulesToRows(rows, ctx([rule({ isActive: false })]))).toBe(rows)
  })
})
