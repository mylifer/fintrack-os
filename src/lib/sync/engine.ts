'use client'

import type { EntityTable } from 'dexie'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import { isLive } from './tombstone'
import type { OutboxEntry } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Sync Engine — P0 remediation for offline data-loss (C1 / C2 / C6)

   Replaces the old "write Dexie + fire-and-forget Supabase" + "clear() then
   bulkAdd() from cloud" model, which lost any write that never reached the
   cloud and truncated local data at the 1,000-row PostgREST cap.

   • C1 (Durable outbox): every local mutation writes the entity table AND the
     `_outbox` in ONE IndexedDB transaction. A background flusher pushes the
     outbox to Supabase with retry/backoff and deletes an entry only on ACK.
   • C2 (Reconciling pull): load() no longer clears Dexie. Cloud rows upsert
     into Dexie, but rows with a pending outbox entry are never overwritten,
     and cloud-side deletions only apply after a COMPLETE fetch.
   • C6 (Pagination): reads page through `.range()` past the 1,000-row cap; a
     partial/failed fetch never triggers the destructive merge.

   Mutations are modelled as idempotent UPSERTS of the current row snapshot
   (soft-deletes included — they are just rows carrying `deleted_at`). This
   makes the outbox order-independent per entity and safe to replay.
──────────────────────────────────────────────────────────────────────── */

export type SyncTable =
  | 'accounts'
  | 'transactions'
  | 'categories'
  | 'budgets'
  | 'debts'
  | 'investment_transactions'
  | 'people'
  | 'recurring_transactions'

// Minimal row shape every synced table shares.
type Row = { id: string; deleted_at?: string | null }

// Supabase table name → Dexie table.
const DEXIE: Record<SyncTable, EntityTable<Row, 'id'>> = {
  accounts:                db.accounts as unknown as EntityTable<Row, 'id'>,
  transactions:            db.transactions as unknown as EntityTable<Row, 'id'>,
  categories:              db.categories as unknown as EntityTable<Row, 'id'>,
  budgets:                 db.budgets as unknown as EntityTable<Row, 'id'>,
  debts:                   db.debts as unknown as EntityTable<Row, 'id'>,
  investment_transactions: db.investmentTransactions as unknown as EntityTable<Row, 'id'>,
  people:                  db.people as unknown as EntityTable<Row, 'id'>,
  recurring_transactions:  db.recurringTransactions as unknown as EntityTable<Row, 'id'>,
}

// Runtime-computed fields that are NOT Supabase columns and must be stripped
// before a row is pushed. `user_id` is stripped everywhere and re-attached at
// flush time from the current session.
const COMPUTED: Partial<Record<SyncTable, string[]>> = {
  accounts: ['balance'],
  budgets:  ['spent', 'remaining', 'percentUsed', 'status', 'category'],
  debts:    ['remainingAmount', 'progressPercent'],
}

function toSnapshot(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  const strip = COMPUTED[table] ?? []
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id' || strip.includes(k)) continue
    out[k] = v === undefined ? null : v   // undefined → null so cleared fields propagate
  }
  return out
}

function now(): string {
  return new Date().toISOString()
}

// Dexie's update() DELETES keys whose value is undefined, so a "clear this
// field" patch would vanish before we snapshot it and never reach the cloud
// (the classic field-resurrection bug). Normalise undefined → null so the
// cleared value is stored locally AND pushed.
function nullifyPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v
  return out
}

/* ── Enqueue (must run inside an active Dexie rw transaction) ───────────── */

async function putOutbox(table: SyncTable, row: { id: string }): Promise<void> {
  const id = `${table}:${row.id}`
  const existing = await db._outbox.get(id)
  const ts = now()
  const entry: OutboxEntry = {
    id,
    table,
    entityId: row.id,
    snapshot: toSnapshot(table, row as Record<string, unknown>),
    attempts: 0,                                   // fresh payload → fresh attempts
    lastError: null,
    enqueuedAt: existing?.enqueuedAt ?? ts,        // preserve first-seen order
    updatedAt: ts,
  }
  await db._outbox.put(entry)
}

/* ── Local mutation primitives (entity + outbox, one transaction) ──────── */

/** Insert-or-replace a full entity locally and enqueue it for push. */
export async function localUpsert<T extends { id: string }>(table: SyncTable, entity: T): Promise<void> {
  const t = DEXIE[table]
  await db.transaction('rw', t, db._outbox, async () => {
    await t.put(entity)
    await putOutbox(table, entity)
  })
  kickSync()
}

/** Insert-or-replace many entities in one transaction (installments, defaults). */
export async function localBulkUpsert<T extends { id: string }>(table: SyncTable, entities: T[]): Promise<void> {
  if (entities.length === 0) return
  const t = DEXIE[table]
  await db.transaction('rw', t, db._outbox, async () => {
    await t.bulkPut(entities)
    for (const e of entities) await putOutbox(table, e)
  })
  kickSync()
}

/** Apply a partial patch, then enqueue the resulting FULL row snapshot. */
export async function localPatch(table: SyncTable, id: string, patch: Record<string, unknown>): Promise<void> {
  const t = DEXIE[table]
  const norm = nullifyPatch(patch)
  await db.transaction('rw', t, db._outbox, async () => {
    await t.update(id, norm)
    const full = await t.get(id)
    if (full) await putOutbox(table, full)
  })
  kickSync()
}

/** Patch many rows (cascade soft-deletes), enqueuing each resulting snapshot. */
export async function localPatchMany(table: SyncTable, ids: string[], patch: Record<string, unknown>): Promise<void> {
  if (ids.length === 0) return
  const t = DEXIE[table]
  const norm = nullifyPatch(patch)
  await db.transaction('rw', t, db._outbox, async () => {
    await t.where('id').anyOf(ids).modify(norm)
    const rows = await t.where('id').anyOf(ids).toArray()
    for (const r of rows) await putOutbox(table, r)
  })
  kickSync()
}

/** Soft delete (tombstone) — durable via the outbox, syncs as an UPDATE. */
export async function softDelete(table: SyncTable, id: string): Promise<void> {
  await localPatch(table, id, { deleted_at: now() })
}

export async function softDeleteMany(table: SyncTable, ids: string[]): Promise<void> {
  await localPatchMany(table, ids, { deleted_at: now() })
}

/* ── Atomic multi-table batch (C5) ─────────────────────────────────────────
   Cross-table operations (e.g. deleting an account and its transactions) must
   not half-commit: a crash between two separate writes leaves orphaned rows.
   localBatch applies every op — entity writes AND their outbox entries — inside
   ONE IndexedDB transaction spanning all involved tables, so it is all-or-
   nothing locally; the durable outbox then carries the whole set to the cloud.
   Uses only raw Dexie ops (same proven pattern as localPatchMany) — no nested
   async-helper awaits, which would risk leaking the transaction zone. */
export type BatchOp =
  | { kind: 'upsert'; table: SyncTable; entity: { id: string } }
  | { kind: 'patch'; table: SyncTable; id: string; patch: Record<string, unknown> }
  | { kind: 'patchMany'; table: SyncTable; ids: string[]; patch: Record<string, unknown> }

export async function localBatch(ops: BatchOp[]): Promise<void> {
  if (ops.length === 0) return
  // Dexie needs every table named up front; de-dupe the involved tables.
  const involved = new Set<EntityTable<Row, 'id'>>([db._outbox as unknown as EntityTable<Row, 'id'>])
  for (const op of ops) involved.add(DEXIE[op.table])

  await db.transaction('rw', [...involved], async () => {
    for (const op of ops) {
      const t = DEXIE[op.table]
      if (op.kind === 'upsert') {
        await t.put(op.entity)
        await putOutbox(op.table, op.entity)
      } else if (op.kind === 'patch') {
        await t.update(op.id, nullifyPatch(op.patch))
        const full = await t.get(op.id)
        if (full) await putOutbox(op.table, full)
      } else {
        if (op.ids.length === 0) continue
        await t.where('id').anyOf(op.ids).modify(nullifyPatch(op.patch))
        const rows = await t.where('id').anyOf(op.ids).toArray()
        for (const r of rows) await putOutbox(op.table, r)
      }
    }
  })
  kickSync()
}

/* ── Background flusher (C1) ────────────────────────────────────────────── */

let flushing = false
let rerun = false
let kickTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failStreak = 0

/** Debounced, fire-and-forget trigger to drain the outbox. */
export function kickSync(): void {
  if (typeof window === 'undefined') return
  if (kickTimer) return
  kickTimer = setTimeout(() => { kickTimer = null; void flushOutbox() }, 200)
}

/** Drain the outbox to Supabase. Entries are removed only on a successful ACK;
 *  failures are kept, counted, and retried with exponential backoff. */
export async function flushOutbox(): Promise<void> {
  if (flushing) { rerun = true; return }
  flushing = true
  try {
    do {
      rerun = false
      const entries = await db._outbox.orderBy('enqueuedAt').toArray()
      if (entries.length === 0) { failStreak = 0; break }

      const userId = await getUserId()
      if (!userId) break // not signed in — keep entries durable for a later session

      let failed = 0
      for (const e of entries) {
        const payload = { ...e.snapshot, user_id: userId }
        const { error } = await supabase.from(e.table).upsert(payload, { onConflict: 'id' })
        if (error) {
          failed++
          await db._outbox.update(e.id, {
            attempts: e.attempts + 1,
            lastError: error.message,
            updatedAt: now(),
          })
        } else {
          await db._outbox.delete(e.id)  // ACK
        }
      }

      if (failed > 0) { failStreak++; scheduleRetry(); break }
      failStreak = 0
    } while (rerun)
  } catch (err) {
    console.error('[sync:flush]', err)
    scheduleRetry()
  } finally {
    flushing = false
  }
}

function scheduleRetry(): void {
  if (retryTimer) return
  const delay = Math.min(60_000, 1_000 * 2 ** Math.min(failStreak, 6))
  retryTimer = setTimeout(() => { retryTimer = null; void flushOutbox() }, delay)
}

/** Number of unsynced mutations still queued (for status surfaces). */
export async function pendingCount(): Promise<number> {
  return db._outbox.count()
}

/** Wire up automatic draining: flush now + whenever connectivity returns. */
export function startAutoSync(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => { failStreak = 0; void flushOutbox() })
  void flushOutbox()
}

/* ── Reconciling pull (C2) + pagination (C6) ───────────────────────────── */

const PAGE = 1000

async function fetchAllLive(
  table: SyncTable,
): Promise<{ rows: Record<string, unknown>[]; complete: boolean }> {
  const acc: Record<string, unknown>[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .is('deleted_at', null)
      .order('id', { ascending: true })   // stable order across pages
      .range(from, from + PAGE - 1)
    if (error) {
      console.error(`[sync:pull:${table}]`, error)
      return { rows: acc, complete: false }
    }
    const batch = (data ?? []) as Record<string, unknown>[]
    acc.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  return { rows: acc, complete: true }
}

/**
 * Fetch the full live cloud set (paginated) and reconcile it into Dexie without
 * destroying local state:
 *   • cloud rows upsert into Dexie, EXCEPT rows with a pending outbox entry
 *     (a local mutation not yet pushed must win),
 *   • local rows absent from the cloud set are deleted ONLY when the fetch was
 *     complete and the row is not pending (a genuine remote deletion).
 * On a partial/failed fetch nothing is cleared — we return the current local
 * live rows so the UI keeps working offline.
 *
 * Returns the merged live rows for the store to hold in memory.
 */
export async function reconcilingPull<T>(table: SyncTable): Promise<T[]> {
  const t = DEXIE[table]
  const { rows: cloudRows, complete } = await fetchAllLive(table)

  if (!complete) {
    return (await t.toArray()).filter(isLive) as unknown as T[]
  }

  const pending = new Set(
    (await db._outbox.where('table').equals(table).toArray()).map(e => e.entityId),
  )
  const cloudIds = new Set(cloudRows.map(r => r.id as string))

  await db.transaction('rw', t, async () => {
    const localRows = await t.toArray()
    for (const row of cloudRows) {
      if (pending.has(row.id as string)) continue       // don't clobber unsynced local write
      await t.put(row as unknown as { id: string })
    }
    for (const lr of localRows) {
      if (!cloudIds.has(lr.id) && !pending.has(lr.id)) {
        await t.delete(lr.id)                            // deleted on another device
      }
    }
  })

  return (await t.toArray()).filter(isLive) as unknown as T[]
}
