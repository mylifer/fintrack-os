'use client'

import type { Budget, Category, CategorySplit, RecurringTransaction, Transaction } from '@/types'
import { localBatch, lastPullWasAuthoritative, type BatchOp, type SyncTable } from '@/lib/sync/engine'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { getBudgetCategoryIds } from '@/lib/utils/calculations'
import { primarySplitCategoryId } from '@/lib/utils/categorySplits'
import { toMinor, toMajor } from '@/lib/utils/money'
import { useCategoryStore, useTransactionStore, useBudgetStore, useRecurringStore } from '@/store'
import { useUndoStore } from '@/store/undo.store'

/* ── Tek seferlik kategori düzeni geçişi ──────────────────────────────────
   2026-09 kategori incelemesinde onaylanan hiyerarşiyi VAR OLAN çalışma
   alanlarına uygular (yeni çalışma alanları aynı yapıyı DEFAULT_CATEGORIES'in
   _parentName'lerinden alır):

   · TAŞIMA      — üst seviyedeki bir kategori onaylanan üst kategorinin altına
                   girer. Yalnızca hâlâ ÜST seviyedeyse: kullanıcı onu zaten
                   bir yere yerleştirdiyse o seçime dokunulmaz.
   · BİRLEŞTİRME — aynı işi gören iki kategoriden kaynak hedefe katılır:
                   işlemler (bölünmüş paylar dahil), bütçeler ve tekrarlayanlar
                   hedefe bağlanır, kaynağın alt kategorileri hedefin altına
                   geçer, kaynak ARŞİVLENİR (silinmez — geri alınabilsin ve
                   initDefaults aynı adı yeniden eklemesin).

   Bir kural yalnızca adları gider kapsamında arşivlenmemiş TEK bir kategoriye
   çözülürse uygulanır; çözülemeyen/belirsiz kural sessizce atlanır. Hiçbir
   kural derinliği 3 seviyenin (0/1/2) ötesine taşıyamaz ya da döngü kuramaz.

   Planlayıcı (planCategoryRestructure) saftır; runCategoryRestructurePass
   planı TEK bir localBatch ile atomik yazar ve "Geri al" bildirimi gösterir. */

/** [kategori, yeni üst kategori] */
export const HIERARCHY_MOVES: ReadonlyArray<readonly [string, string]> = [
  ['Yazılım',       'Abonelikler'],
  ['Kırtasiye',     'Alışveriş'],
  ['Duty Free',     'Alışveriş'],
  ['Legal',         'Çeşitli Hizmetler'],
  ['Alkol',         'Eğlence'],
  ['Night Life',    'Eğlence'],
  ['Şarj',          'Ulaşım'],
  ['Araç Kiralama', 'Ulaşım'],
  ['Araç Yıkama',   'Ulaşım'],
]

/** [kaynak, hedef] — kaynak hedefe katılır ve arşivlenir. */
export const HIERARCHY_MERGES: ReadonlyArray<readonly [string, string]> = [
  ['Household',    'Ev'],
  ['Improvements', 'Tadilat'],
  ['Kira & Konut', 'Kira'],
  ['Tech',         'Teknoloji'],
  ['Akaryakıt',    'Yakıt'],
  ['Mobil Hat',    'Telefon'],
]

const MAX_LEVEL = 2

export interface RowChange<T> {
  id: string
  patch: Partial<T>
  /** Geri alma için yamadan önceki değerler (yalnız değişen alanlar). */
  prev: Partial<T>
}

export interface RestructurePlan {
  categories:   RowChange<Category>[]
  transactions: RowChange<Transaction>[]
  budgets:      RowChange<Budget>[]
  recurring:    RowChange<RecurringTransaction>[]
  moved:  number
  merged: number
}

export interface RestructureInput {
  categories:   readonly Category[]
  transactions: readonly Transaction[]
  budgets:      readonly Budget[]
  recurring:    readonly RecurringTransaction[]
}

/* Satırların çalışma kopyası: kurallar sırayla uygulanır ve her kural bir
   öncekinin sonucunu görür (ör. Household → Ev, Improvements'ı Ev'in altına
   alır; ardından Improvements → Tadilat onu oradan birleştirir). Sonunda
   yalnız DOKUNULAN alanlar, özgün değerleriyle birlikte plana girer. */
function tracker<T extends { id: string }>(rows: readonly T[]) {
  const orig = new Map(rows.map(r => [r.id, r]))
  const work = new Map(rows.map(r => [r.id, { ...r }]))
  const touched = new Map<string, Set<keyof T>>()
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

  return {
    all: () => [...work.values()],
    get: (id: string) => work.get(id),
    set(id: string, patch: Partial<T>) {
      const row = work.get(id)
      if (!row) return
      Object.assign(row, patch)
      const keys = touched.get(id) ?? new Set<keyof T>()
      for (const k of Object.keys(patch) as (keyof T)[]) keys.add(k)
      touched.set(id, keys)
    },
    changes(): RowChange<T>[] {
      const out: RowChange<T>[] = []
      for (const [id, keys] of touched) {
        const o = orig.get(id)!, w = work.get(id)!
        const patch: Partial<T> = {}, prev: Partial<T> = {}
        for (const k of keys) {
          if (same(o[k], w[k])) continue
          patch[k] = w[k]
          prev[k] = o[k]
        }
        if (Object.keys(patch).length > 0) out.push({ id, patch, prev })
      }
      return out
    },
  }
}

/** Kaynak payı hedefe çevirir; hedef zaten bir paysa tutarlar birleşir. */
function mergeSplits(splits: readonly CategorySplit[], from: string, to: string): CategorySplit[] {
  const out: CategorySplit[] = []
  for (const s of splits) {
    const categoryId = s.categoryId === from ? to : s.categoryId
    const hit = out.find(o => o.categoryId === categoryId)
    if (hit) hit.amount = toMajor(toMinor(hit.amount) + toMinor(s.amount))
    else out.push({ ...s, categoryId })
  }
  return out
}

function retargetTransaction(tx: Transaction, from: string, to: string): Partial<Transaction> | null {
  if (tx.categorySplits?.some(s => s.categoryId === from)) {
    const splits = mergeSplits(tx.categorySplits, from, to)
    // 2'den az pay = bölünmemiş işlem; alan hiç yazılmaz (categorySplits değişmezi).
    if (splits.length < 2) return { categorySplits: undefined, categoryId: splits[0]?.categoryId ?? to }
    return { categorySplits: splits, categoryId: primarySplitCategoryId(splits) }
  }
  return tx.categoryId === from ? { categoryId: to } : null
}

function retargetBudget(
  budget: Budget, from: string, to: string, nameOf: (id: string) => string | undefined,
): Partial<Budget> | null {
  const ids = getBudgetCategoryIds(budget)
  if (!ids.includes(from)) return null
  const next = [...new Set(ids.map(id => id === from ? to : id))]
  // Çoklu kategori bütçesi categoryId'de JSON dizi olarak saklanır — biçim korunur.
  const isList = budget.categoryId.trimStart().startsWith('[')
  const categoryName = next.map(nameOf).filter(Boolean).join(', ')
  return { categoryId: isList ? JSON.stringify(next) : next[0], ...(categoryName && { categoryName }) }
}

export function planCategoryRestructure(input: RestructureInput): RestructurePlan {
  const cats = tracker(input.categories)
  const txs  = tracker(input.transactions)
  const buds = tracker(input.budgets)
  const recs = tracker(input.recurring)

  const resolve = (name: string): Category | undefined => {
    const hits = cats.all().filter(c => c.scope === 'expense' && !c.isArchived && c.name === name)
    return hits.length === 1 ? hits[0] : undefined
  }
  // Seviye/soy hesapları arşivlileri de kapsar (CategoryEditModal ile aynı kural).
  const childrenOf = (id: string) => cats.all().filter(c => c.parentId === id)
  const levelOf = (id: string): number => {
    let level = 0
    const seen = new Set([id])
    for (let p = cats.get(id)?.parentId; p && !seen.has(p); p = cats.get(p)?.parentId) {
      seen.add(p)
      level++
    }
    return level
  }
  const heightOf = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    const kids = childrenOf(id)
    return kids.length === 0 ? 0 : 1 + Math.max(...kids.map(k => heightOf(k.id, seen)))
  }
  const isUnder = (id: string, ancestorId: string): boolean => {
    const seen = new Set<string>()
    for (let p = cats.get(id)?.parentId; p && !seen.has(p); p = cats.get(p)?.parentId) {
      if (p === ancestorId) return true
      seen.add(p)
    }
    return false
  }

  let merged = 0
  for (const [fromName, toName] of HIERARCHY_MERGES) {
    const src = resolve(fromName)
    const dst = resolve(toName)
    if (!src || !dst || src.id === dst.id) continue
    if (isUnder(dst.id, src.id)) continue   // alt kategorileri hedefe taşımak döngü kurardı
    const kids = childrenOf(src.id)
    if (kids.some(k => levelOf(dst.id) + 1 + heightOf(k.id) > MAX_LEVEL)) continue

    for (const k of kids) cats.set(k.id, { parentId: dst.id })
    cats.set(src.id, { isArchived: true })

    for (const tx of txs.all()) {
      const patch = retargetTransaction(tx, src.id, dst.id)
      if (patch) txs.set(tx.id, patch)
    }
    const nameOf = (id: string) => cats.get(id)?.name
    for (const b of buds.all()) {
      const patch = retargetBudget(b, src.id, dst.id, nameOf)
      if (patch) buds.set(b.id, patch)
    }
    for (const r of recs.all()) {
      if (r.categoryId === src.id) recs.set(r.id, { categoryId: dst.id })
    }
    merged++
  }

  let moved = 0
  for (const [name, parentName] of HIERARCHY_MOVES) {
    const cat = resolve(name)
    const parent = resolve(parentName)
    if (!cat || !parent || cat.id === parent.id) continue
    if (cat.parentId) continue   // kullanıcı zaten bir yere yerleştirmiş
    if (isUnder(parent.id, cat.id)) continue
    if (levelOf(parent.id) + 1 + heightOf(cat.id) > MAX_LEVEL) continue
    cats.set(cat.id, { parentId: parent.id })
    moved++
  }

  return {
    categories:   cats.changes(),
    transactions: txs.changes(),
    budgets:      buds.changes(),
    recurring:    recs.changes(),
    moved,
    merged,
  }
}

/* ── Geçişin çalıştırılması ───────────────────────────────────────────────
   Otomatik ikon geçişiyle (categories.store AUTO_ICON_KEY) aynı sözleşme:
   çalışma alanı başına bir kez, bayrak localStorage'da (lib/auth.ts
   clearLocalData() çıkışta temizler) ve yalnız YETKİLİ çekişlerden sonra —
   burada kategori + işlem + bütçe + tekrarlayan tablolarının HEPSİ için.
   Aksi halde yeni bir cihazda işlemler henüz inmeden kaynak kategoriler
   arşivlenir ve işlemler arşivli kategoriye bağlı kalırdı. Bu yüzden
   reloadAllStores Faz 2'den SONRA çağrılır. */
const HIERARCHY_KEY = 'fintrack.categoryHierarchy.v1'

const REQUIRED_PULLS: SyncTable[] = ['categories', 'transactions', 'budgets', 'recurring_transactions']

function hierarchyFlagKey(): string {
  return `${HIERARCHY_KEY}:${getActiveWorkspaceId() ?? 'default'}`
}

function hierarchyPassDone(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(hierarchyFlagKey()) === '1'
  } catch {
    return true   // storage kapalıysa geçişi hiç denemeyiz (tekrar tekrar yazmasın)
  }
}

function markHierarchyPassDone(): void {
  try {
    localStorage.setItem(hierarchyFlagKey(), '1')
  } catch { /* storage kapalı */ }
}

function planOps(plan: RestructurePlan, side: 'patch' | 'prev'): BatchOp[] {
  const ops: BatchOp[] = []
  const push = (table: SyncTable, rows: RowChange<unknown>[]) => {
    for (const r of rows) ops.push({ kind: 'patch', table, id: r.id, patch: r[side] as Record<string, unknown> })
  }
  push('categories', plan.categories)
  push('transactions', plan.transactions)
  push('budgets', plan.budgets)
  push('recurring_transactions', plan.recurring)
  return ops
}

function applyToStores(plan: RestructurePlan, side: 'patch' | 'prev'): void {
  const merge = <T extends { id: string }>(rows: T[], changes: RowChange<T>[]): T[] => {
    const byId = new Map(changes.map(c => [c.id, c[side]]))
    return rows.map(r => byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r)
  }
  if (plan.categories.length)   useCategoryStore.setState(s => ({ categories: merge(s.categories, plan.categories) }))
  if (plan.transactions.length) useTransactionStore.setState(s => ({ transactions: merge(s.transactions, plan.transactions) }))
  if (plan.budgets.length)      useBudgetStore.setState(s => ({ budgets: merge(s.budgets, plan.budgets) }))
  if (plan.recurring.length)    useRecurringStore.setState(s => ({ recurring: merge(s.recurring, plan.recurring) }))
}

export async function runCategoryRestructurePass(): Promise<void> {
  if (hierarchyPassDone()) return
  if (!REQUIRED_PULLS.every(t => lastPullWasAuthoritative(t))) return

  const plan = planCategoryRestructure({
    categories:   useCategoryStore.getState().categories,
    transactions: useTransactionStore.getState().transactions,
    budgets:      useBudgetStore.getState().budgets,
    recurring:    useRecurringStore.getState().recurring,
  })

  if (plan.categories.length > 0) {
    await localBatch(planOps(plan, 'patch'))
    applyToStores(plan, 'patch')
  }
  markHierarchyPassDone()
  if (plan.categories.length === 0) return

  const parts = [
    plan.moved  > 0 && `${plan.moved} kategori taşındı`,
    plan.merged > 0 && `${plan.merged} kategori birleştirildi`,
  ].filter(Boolean)
  useUndoStore.getState().pushUndo(
    `Kategori düzeni güncellendi: ${parts.join(', ')}`,
    async () => {
      await localBatch(planOps(plan, 'prev'))
      applyToStores(plan, 'prev')
    },
    20_000,
  )
}
