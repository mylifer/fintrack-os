'use client'

import type { EntityTable } from 'dexie'
import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import { isLive } from './tombstone'
import { useSyncStatusStore } from '@/store/sync-status.store'
import type { OutboxEntry } from '@/types'
import { getActiveWorkspaceId, rowInActiveWorkspace } from '@/lib/workspace-context'

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
  | 'workspaces'

// Minimal row shape every synced table shares. `workspaces` itself has no
// workspaceId (it IS the partition axis for the other 8 tables).
type Row = { id: string; deleted_at?: string | null; workspaceId?: string | null }

// Outbox row + the owner uid we tag at ENQUEUE time. `ownerId` is metadata ON
// the outbox entry (NOT inside the snapshot payload) recording which user's
// session created the mutation, so a pending write is only ever replayed into
// the account that produced it (shared-device cross-tenant leak fix). It is not
// indexed, so it needs no Dexie schema/version bump — Dexie persists the whole
// object regardless of which keys are indexed.
type OutboxRow = OutboxEntry & { ownerId?: string | null }

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
  workspaces:              db.workspaces as unknown as EntityTable<Row, 'id'>,
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
  // deleted_at is ALWAYS explicit in the payload: an entity object that simply
  // lacks the key (every fresh create) must push null, so re-creating a row
  // under a previously tombstoned id resurrects it in the cloud instead of the
  // upsert silently leaving the old tombstone in place.
  if (!('deleted_at' in out)) out.deleted_at = null
  return out
}

function now(): string {
  return new Date().toISOString()
}

// Yeni oluşturulan her varlık, hangi çalışma alanı aktifse ona damgalanır.
// `workspaces` tablosu bunun İSTİSNASIdır — o, diğerlerinin bölümleme
// eksenidir, kendi başına bir workspaceId taşımaz. Tek çağrı noktası: bu
// modüldeki 3 yaratma primitive'i (localUpsert/localBulkUpsert/localBatch) —
// store'ların hiçbiri workspaceId'yi kendisi set etmek ZORUNDA değildir.
function stampWorkspace<T extends { id: string }>(table: SyncTable, entity: T): T {
  if (table === 'workspaces') return entity
  return { ...entity, workspaceId: getActiveWorkspaceId() }
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

// Resolve the current session uid to tag onto an outbox entry. MUST be called
// BEFORE opening the Dexie transaction (getUserId hits supabase.auth, and
// awaiting a non-Dexie promise inside a Dexie tx would leak the transaction
// zone — same reason localBatch avoids nested async-helper awaits).
async function currentOwnerId(): Promise<string | null> {
  return (await getUserId()) ?? null
}

async function putOutbox(table: SyncTable, row: { id: string }, ownerId: string | null): Promise<void> {
  const id = `${table}:${row.id}`
  const existing = await db._outbox.get(id)
  const ts = now()
  const entry: OutboxRow = {
    id,
    table,
    entityId: row.id,
    ownerId,                                       // owner tagged at enqueue time (cross-tenant guard)
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
  const stamped = stampWorkspace(table, entity)
  const ownerId = await currentOwnerId()   // capture before the tx (see currentOwnerId)
  await db.transaction('rw', t, db._outbox, async () => {
    await t.put(stamped)
    await putOutbox(table, stamped, ownerId)
  })
  kickSync()
}

/** Insert-or-replace many entities in one transaction (installments, defaults). */
export async function localBulkUpsert<T extends { id: string }>(table: SyncTable, entities: T[]): Promise<void> {
  if (entities.length === 0) return
  const t = DEXIE[table]
  const stamped = entities.map(e => stampWorkspace(table, e))
  const ownerId = await currentOwnerId()
  await db.transaction('rw', t, db._outbox, async () => {
    await t.bulkPut(stamped)
    for (const e of stamped) await putOutbox(table, e, ownerId)
  })
  kickSync()
}

/** Apply a partial patch, then enqueue the resulting FULL row snapshot. */
export async function localPatch(table: SyncTable, id: string, patch: Record<string, unknown>): Promise<void> {
  const t = DEXIE[table]
  const norm = nullifyPatch(patch)
  const ownerId = await currentOwnerId()
  await db.transaction('rw', t, db._outbox, async () => {
    await t.update(id, norm)
    const full = await t.get(id)
    if (full) await putOutbox(table, full, ownerId)
  })
  kickSync()
}

/** Patch many rows (cascade soft-deletes), enqueuing each resulting snapshot. */
export async function localPatchMany(table: SyncTable, ids: string[], patch: Record<string, unknown>): Promise<void> {
  if (ids.length === 0) return
  const t = DEXIE[table]
  const norm = nullifyPatch(patch)
  const ownerId = await currentOwnerId()
  await db.transaction('rw', t, db._outbox, async () => {
    await t.where('id').anyOf(ids).modify(norm)
    const rows = await t.where('id').anyOf(ids).toArray()
    for (const r of rows) await putOutbox(table, r, ownerId)
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

  const ownerId = await currentOwnerId()   // capture before the tx (see currentOwnerId)
  await db.transaction('rw', [...involved], async () => {
    for (const op of ops) {
      const t = DEXIE[op.table]
      if (op.kind === 'upsert') {
        const stamped = stampWorkspace(op.table, op.entity)
        await t.put(stamped)
        await putOutbox(op.table, stamped, ownerId)
      } else if (op.kind === 'patch') {
        await t.update(op.id, nullifyPatch(op.patch))
        const full = await t.get(op.id)
        if (full) await putOutbox(op.table, full, ownerId)
      } else {
        if (op.ids.length === 0) continue
        await t.where('id').anyOf(op.ids).modify(nullifyPatch(op.patch))
        const rows = await t.where('id').anyOf(op.ids).toArray()
        for (const r of rows) await putOutbox(op.table, r, ownerId)
      }
    }
  })
  kickSync()
}

/* ── Background flusher (C1) ────────────────────────────────────────────── */

export const MAX_SYNC_ATTEMPTS = 12 // ~ back-to-back retries before an entry is dead-lettered (repair.ts de kullanır)
const MAX_ATTEMPTS = MAX_SYNC_ATTEMPTS
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
        // Cross-tenant guard (shared-device leak): an entry created by a
        // DIFFERENT user's session must NEVER be replayed into the current
        // account — flush re-stamps user_id from the current session, so
        // pushing it would write user A's mutation into user B's data. Drop it.
        // LEGACY entries predating owner-tagging have ownerId null/undefined:
        // preserve the old behavior (stamp with current uid) so in-flight
        // writes are not lost on upgrade.
        const owner = (e as OutboxRow).ownerId
        if (owner != null && owner !== userId) {
          await db._outbox.delete(e.id)
          continue
        }

        // Dead-letter: a poison payload (permanent 4xx) must not retry forever
        // and block the whole outbox. Past MAX_ATTEMPTS we keep the row durable
        // (for inspection/manual fix) but stop auto-retrying it.
        if (e.attempts >= MAX_ATTEMPTS) continue

        const payload = { ...e.snapshot, user_id: userId }
        const { error } = await supabase.from(e.table).upsert(payload, { onConflict: 'id' })
        if (error) {
          failed++
          const attempts = e.attempts + 1
          if (attempts >= MAX_ATTEMPTS) {
            console.error(`[sync:dead-letter] ${e.table}/${e.entityId} giving up after ${attempts} attempts:`, error.message)
          }
          await db._outbox.update(e.id, { attempts, lastError: error.message, updatedAt: now() })
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
    void refreshSyncStatus()
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

/** Publish outbox health to the UI store (SyncStatusBanner). Best-effort. */
async function refreshSyncStatus(): Promise<void> {
  try {
    const entries = await db._outbox.toArray()
    const stuck = entries.filter(e => e.attempts >= MAX_ATTEMPTS)
    useSyncStatusStore.getState().report({
      pending: entries.length,
      stuck: stuck.length,
      lastError: stuck[0]?.lastError ?? entries.find(e => e.lastError)?.lastError ?? null,
    })
  } catch {
    // durum rozeti kritik değil — sync'in kendisini asla bloklamasın
  }
}

/** Give dead-lettered entries a fresh attempt budget and drain the outbox.
 *  Called on every app start (a permanent 4xx cause — schema drift, a stale
 *  CHECK constraint — may have been fixed since) and from the banner's
 *  "Yeniden dene" button. `lastError` is kept until the next attempt so the
 *  UI can still show WHY the entry was stuck. */
export async function retryDeadLetters(): Promise<void> {
  const entries = await db._outbox.toArray()
  const stuck = entries.filter(e => e.attempts >= MAX_ATTEMPTS)
  for (const e of stuck) {
    await db._outbox.update(e.id, { attempts: 0, updatedAt: now() })
  }
  failStreak = 0
  await flushOutbox()
}

/* ── Hesap değişimi koruması ──────────────────────────────────────────────
   IndexedDB oturuma değil ORIGIN'e bağlıdır: aynı tarayıcıda farklı bir
   hesapla giriş yapılırsa önceki kullanıcının satırları yerelde kalır.
   reconcilingPull bu satırları "bulutta yok" diye YENİ hesaba itmeye çalışır —
   ID bulutta eski sahibindeyse push sonsuza dek RLS'e takılır, değilse yabancı
   veri yeni hesaba SIZAR (cross-tenant leak). Çözüm: kullanıcı değişimi tespit
   edilince yerel entity tabloları temizlenir (yeni kullanıcının verisi zaten
   bulutta; ilk pull geri getirir) ve başka sahibin outbox girdileri düşürülür. */

const LAST_UID_KEY = 'fintrack.lastSyncUserId'

export async function guardUserSwitch(): Promise<void> {
  if (typeof window === 'undefined') return
  const uid = await getUserId()
  if (!uid) return // oturum yokken karar verme — marker'a dokunma

  let prev: string | null = null
  try { prev = localStorage.getItem(LAST_UID_KEY) } catch { /* storage kapalı */ }

  if (prev && prev !== uid) {
    console.warn('[sync:user-switch] farklı hesap girişi — önceki hesabın yerel kalıntıları temizleniyor')
    for (const t of Object.values(DEXIE)) await t.clear()
    const entries = (await db._outbox.toArray()) as OutboxRow[]
    for (const e of entries) {
      if (e.ownerId !== uid) await db._outbox.delete(e.id)
    }
  }

  try { localStorage.setItem(LAST_UID_KEY, uid) } catch { /* storage kapalı */ }
}

/** Wire up automatic draining: flush now + whenever connectivity returns. */
export function startAutoSync(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => { failStreak = 0; void flushOutbox() })
  void retryDeadLetters()
}

/* ── Reconciling pull (C2) + pagination (C6) ───────────────────────────── */

const PAGE = 1000

// Tombstones ARE fetched (no deleted_at filter): a remote deletion must arrive
// as a positive `deleted_at` row, never be inferred from absence — absence can
// also mean "this row's push failed", and treating that as a deletion is how
// unsynced data used to get destroyed (GOLD_BRACELET incident, 2026-07).
async function fetchAllRows(
  table: SyncTable,
  userId: string,
): Promise<{ rows: Record<string, unknown>[]; complete: boolean }> {
  const acc: Record<string, unknown>[] = []
  let from = 0
  for (;;) {
    // Defense-in-depth: scope the read to the current user. RLS already
    // enforces this server-side; the explicit filter is belt-and-suspenders
    // against a future RLS misconfiguration and is a no-op when RLS is correct.
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
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
 * Fetch the full cloud set (paginated, tombstones included) and reconcile it
 * into Dexie without destroying local state:
 *   • cloud rows upsert into Dexie, EXCEPT rows with a pending outbox entry
 *     (a local mutation not yet pushed must win),
 *   • remote deletions arrive as tombstone rows (`deleted_at` set) and are
 *     upserted like any other update — they vanish from the UI via isLive,
 *   • a local row ABSENT from a complete cloud set is NEVER deleted: absence
 *     means its push failed or never ran, so it is RE-ENQUEUED for push
 *     instead. (Deletion-by-absence destroyed exactly the rows that most
 *     needed protecting — the not-yet-synced ones.)
 *   • with no signed-in user the pull is skipped entirely: an anon/expired-
 *     session query returns an EMPTY set with HTTP 200 (RLS filters silently),
 *     which is indistinguishable from "user has no data".
 * On a partial/failed fetch nothing is touched — we return the current local
 * live rows so the UI keeps working offline.
 *
 * Returns the merged live rows for the store to hold in memory.
 */
export async function reconcilingPull<T>(table: SyncTable): Promise<T[]> {
  const t = DEXIE[table]

  // `workspaces` is the partition axis itself — never filtered by workspace.
  const scoped = (rows: Row[]): Row[] => table === 'workspaces' ? rows : rows.filter(rowInActiveWorkspace)

  const userId = await getUserId()
  if (!userId) {
    return scoped((await t.toArray()).filter(isLive)) as unknown as T[]
  }

  const { rows: cloudRows, complete } = await fetchAllRows(table, userId)

  if (!complete) {
    return scoped((await t.toArray()).filter(isLive)) as unknown as T[]
  }

  const cloudIds = new Set(cloudRows.map(r => r.id as string))
  const ownerId: string | null = userId   // outbox owner tag (captured pre-tx)
  let requeued = 0

  await db.transaction('rw', t, db._outbox, async () => {
    // pending MUST be read inside this tx: localUpsert commits entity+outbox
    // atomically, so a row created while the pull was in flight either isn't
    // in localRows yet, or its outbox entry is visible here. Reading pending
    // BEFORE the tx left a window where a just-created row appeared local-only
    // and got re-enqueued/overwritten incorrectly.
    const pending = new Set(
      (await db._outbox.where('table').equals(table).toArray()).map(e => e.entityId),
    )
    const localRows = await t.toArray()
    for (const row of cloudRows) {
      if (pending.has(row.id as string)) continue       // don't clobber unsynced local write
      await t.put(row as unknown as { id: string })
    }
    for (const lr of localRows) {
      if (!cloudIds.has(lr.id) && !pending.has(lr.id)) {
        await putOutbox(table, lr, ownerId)              // push failed/never ran — retry it
        requeued++
      }
    }
  })

  if (requeued > 0) {
    console.warn(`[sync:requeue] ${table}: ${requeued} local row(s) missing from cloud — re-enqueued for push`)
    // Görünürlük şartı: motorun kendi başına buluta veri geri yüklemesi
    // kullanıcıya bildirilir. Bu sessiz kaldığında, bu cihazda/oturumda ne
    // varsa (eski oturum kalıntıları dahil) fark edilmeden canlı veriye
    // karışabiliyor (Temmuz 2026 vakası).
    useSyncStatusStore.getState().notify(
      `${requeued} yerel kayıt (${table}) bulutta yoktu ve buluta geri yüklendi. ` +
      'Bu kayıtları siz oluşturmadıysanız verilerinizi kontrol edin.',
    )
    kickSync()
  }

  return scoped((await t.toArray()).filter(isLive)) as unknown as T[]
}
