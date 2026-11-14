'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Transaction, TransactionRule } from '@/types'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, localBatch, softDelete, type BatchOp } from '@/lib/sync/engine'
import { rowInActiveWorkspace } from '@/lib/workspace-context'
import { sortRules, type RuleHistoryChange } from '@/lib/utils/transaction-rules'
import { loadEntities } from './entity-helpers'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { useTransactionStore } from './transactions.store'

/* İşlem kuralları store'u (transaction_rules, 0025). Eşleştirme mantığı SAF
   modülde: lib/utils/transaction-rules.ts. Liste her zaman değerlendirme
   sırasında (sortOrder) tutulur. Tablo bulutta henüz yoksa (migration
   uygulanmamış) kurallar yalnız bu cihazda çalışır — bkz. engine.ts
   tablesMissingInCloud. */

export type RulePatch = Partial<Omit<TransactionRule, 'id' | 'createdAt' | 'updatedAt'>>

interface RulesState {
  rules: TransactionRule[]
  ready: boolean
  load: () => Promise<void>
  add: (rule: TransactionRule) => Promise<void>
  update: (id: string, patch: RulePatch) => Promise<void>
  /** Kuralı listede bir yukarı (-1) ya da aşağı (+1) taşır. */
  move: (id: string, dir: -1 | 1) => Promise<void>
  remove: (id: string, opts?: RemoveOptions) => Promise<void>
  /** Onaylanan geçmiş işlem değişikliklerini yazar; geri alınabilir. */
  applyToHistory: (changes: RuleHistoryChange[]) => Promise<number>
  /** Yeni kural için sıradaki sortOrder (listenin sonu). */
  nextSortOrder: () => number
}

// Engine yama anahtarlarındaki undefined'ı null yazar (nullifyPatch); bellekteki
// kopya da aynı değeri taşısın (goals.store ile aynı gerekçe).
function nullify<T extends object>(patch: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v
  return out as T
}

export const useRulesStore = create<RulesState>()((set, get) => ({
  rules: [],
  ready: false,

  load: async () => {
    const rules = await loadEntities<TransactionRule>(
      'transaction_rules', 'transaction-rules',
      async () => (await db.transactionRules.toArray()).filter(isLive).filter(rowInActiveWorkspace),
    )
    set({ rules: sortRules(rules), ready: true })
  },

  nextSortOrder: () => get().rules.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1,

  add: async (rule) => {
    await localUpsert('transaction_rules', rule)
    set(s => ({ rules: sortRules([...s.rules, rule]) }))
  },

  update: async (id, patch) => {
    const full = nullify({ ...patch, updatedAt: new Date().toISOString() })
    await localPatch('transaction_rules', id, full as Record<string, unknown>)
    set(s => ({ rules: sortRules(s.rules.map(r => (r.id === id ? { ...r, ...full } : r))) }))
  },

  move: async (id, dir) => {
    const list = sortRules(get().rules)
    const i = list.findIndex(r => r.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    // Sıra numaraları yeniden yazılır (1..n): eşit/boşluklu eski değerler de
    // düzelir. Yalnız değişen satırlar yazılır.
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    const now = new Date().toISOString()
    const ops: BatchOp[] = []
    const updated = next.map((r, k) => {
      if (r.sortOrder === k + 1) return r
      ops.push({ kind: 'patch', table: 'transaction_rules', id: r.id, patch: { sortOrder: k + 1, updatedAt: now } })
      return { ...r, sortOrder: k + 1, updatedAt: now }
    })
    await localBatch(ops)
    set({ rules: updated })
  },

  remove: async (id, opts) => {
    const rule = get().rules.find(r => r.id === id)
    await softDelete('transaction_rules', id)
    set(s => ({ rules: s.rules.filter(r => r.id !== id) }))
    if (rule && opts?.undoable !== false) {
      useUndoStore.getState().pushUndo('Kural silindi', async () => {
        await localPatch('transaction_rules', id, { deleted_at: null })
        set(s => ({ rules: sortRules([...s.rules, rule]) }))
      })
    }
  },

  applyToHistory: async (changes) => {
    if (changes.length === 0) return 0
    const now = new Date().toISOString()
    const forward: BatchOp[] = []
    const back: BatchOp[] = []
    const nextById = new Map<string, Transaction>()
    const prevById = new Map<string, Transaction>()
    for (const c of changes) {
      forward.push({ kind: 'patch', table: 'transactions', id: c.tx.id, patch: { ...c.patch, updatedAt: now } })
      back.push({ kind: 'patch', table: 'transactions', id: c.tx.id, patch: { ...c.revert } })
      nextById.set(c.tx.id, { ...c.tx, ...c.patch, updatedAt: now })
      prevById.set(c.tx.id, c.tx)
    }
    await localBatch(forward)
    const txStore = useTransactionStore
    txStore.setState(s => ({ transactions: s.transactions.map(t => nextById.get(t.id) ?? t) }))

    useUndoStore.getState().pushUndo(`Kural ${changes.length} işleme uygulandı`, async () => {
      // Geri alma damgası (updatedAt) localBatch'te yeniden atılır — keep_newer_row
      // geri almayı "eski yazma" sayıp reddetmez.
      await localBatch(back)
      txStore.setState(s => ({
        transactions: s.transactions.map(t => {
          const prev = prevById.get(t.id)
          return prev ? { ...prev, updatedAt: new Date().toISOString() } : t
        }),
      }))
    }, 10_000)
    return changes.length
  },
}))
