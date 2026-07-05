import { supabase } from './supabase'

/**
 * Cloud-first bulk replace for backup restore.
 *
 * The stores are cloud-authoritative: every load() clears Dexie and repopulates
 * it from Supabase. A restore that writes only Dexie is therefore wiped by the
 * next load(). This module pushes the restored data to Supabase in one pass so
 * the cloud becomes the restored state before any load() runs.
 *
 * No offline queue / outbox — assumes connectivity during restore.
 */

export interface BackupData {
  accounts:               unknown[]
  transactions:           unknown[]
  categories:             unknown[]
  budgets:                unknown[]
  debts:                  unknown[]
  investmentTransactions: unknown[]
  people:                 unknown[]
  recurringTransactions:  unknown[]
}

const CHUNK_SIZE = 500

// Supabase table name for each backup key
const TABLE: Record<keyof BackupData, string> = {
  accounts:               'accounts',
  transactions:           'transactions',
  categories:             'categories',
  budgets:                'budgets',
  debts:                  'debts',
  investmentTransactions: 'investment_transactions',
  people:                 'people',
  recurringTransactions:  'recurring_transactions',
}

// FK-safe ordering. Delete children before parents; insert parents before children.
// transactions → accounts/categories/people/debts; budgets → categories;
// recurring → accounts/categories; investment_transactions → accounts/transactions.
const DELETE_ORDER: (keyof BackupData)[] = [
  'investmentTransactions', 'transactions', 'budgets', 'recurringTransactions',
  'debts', 'people', 'accounts', 'categories',
]
const INSERT_ORDER: (keyof BackupData)[] = [
  'categories', 'accounts', 'people', 'debts',
  'recurringTransactions', 'budgets', 'transactions', 'investmentTransactions',
]

// categories.parentId is a self-reference; a child inserted before its parent
// would violate the FK. Emit parents before children.
function sortParentsFirst(cats: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map(cats.map(c => [c.id as string, c]))
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  const visit = (c: Record<string, unknown>) => {
    const id = c.id as string
    if (seen.has(id)) return
    const parentId = c.parentId as string | undefined
    if (parentId && byId.has(parentId)) visit(byId.get(parentId)!)
    seen.add(id)
    out.push(c)
  }
  for (const c of cats) visit(c)
  return out
}

// Mirror each store's insert shape: strip runtime-computed fields, tag user_id.
function rowsForCloud(key: keyof BackupData, rows: unknown[], userId: string): Record<string, unknown>[] {
  let list = rows as Record<string, unknown>[]
  if (key === 'categories') list = sortParentsFirst(list)
  return list.map(r => {
    const clean: Record<string, unknown> = { ...(r as Record<string, unknown>), user_id: userId }
    if (key === 'accounts') {
      delete clean.balance                         // derived at runtime, no column
    } else if (key === 'budgets') {
      delete clean.spent; delete clean.remaining
      delete clean.percentUsed; delete clean.status; delete clean.category
    } else if (key === 'debts') {
      delete clean.remainingAmount; delete clean.progressPercent
    }
    return clean
  })
}

/**
 * Replace ALL of the user's rows in Supabase with the given data.
 * Throws on the first delete/insert error so the caller can roll back.
 */
export async function cloudReplaceAll(data: BackupData, userId: string): Promise<void> {
  // 1. Clear the user's existing rows (children → parents)
  for (const key of DELETE_ORDER) {
    const { error } = await supabase.from(TABLE[key]).delete().eq('user_id', userId)
    if (error) throw new Error(`Bulut temizleme hatası (${TABLE[key]}): ${error.message}`)
  }

  // 2. Insert the backup rows (parents → children), chunked to bound payload size
  for (const key of INSERT_ORDER) {
    const rows = rowsForCloud(key, data[key] ?? [], userId)
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const { error } = await supabase.from(TABLE[key]).insert(chunk)
      if (error) throw new Error(`Bulut yükleme hatası (${TABLE[key]}): ${error.message}`)
    }
  }
}
