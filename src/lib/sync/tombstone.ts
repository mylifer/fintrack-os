import type { Table } from 'dexie'
import { supabase } from '@/lib/supabase'

/* ────────────────────────────────────────────────────────────────────────
   Tombstones — Deletion Integrity (C3)

   Instead of physically removing a row, we stamp `deleted_at` and KEEP the row
   so the deletion propagates to Supabase (and thereby other devices) as an
   ordinary UPDATE rather than a DELETE. A hard DELETE performed while offline
   is silently lost by the fire-and-forget sync and the row resurrects on the
   next cloud-authoritative load(); a tombstone survives as data and is replayed
   like any other change.

   Contract:
   • Every synced table carries a nullable `deleted_at` (ISO 8601 | null).
   • `remove()` in every store writes the tombstone via these helpers and drops
     the row from the in-memory (visible) array.
   • Every `load()` filters `deleted_at is not null` out of both the Supabase
     fetch (`.is('deleted_at', null)`) and the Dexie fallback.

   NOTE: the Supabase push is fire-and-forget, matching the rest of the codebase.
   Durable retry of an unsynced tombstone across an offline window is the job of
   the Phase-2 outbox; this module only establishes the soft-delete contract.
──────────────────────────────────────────────────────────────────────── */

function stamp(): string {
  return new Date().toISOString()
}

/** Soft-delete a single row: tombstone locally (Dexie) + push as an UPDATE. */
export async function softDelete(
  local: Table,
  remoteTable: string,
  id: string,
): Promise<string> {
  const deleted_at = stamp()
  await local.update(id, { deleted_at })
  supabase.from(remoteTable).update({ deleted_at }).eq('id', id).then(({ error }) => {
    if (error) console.error(`[supabase:${remoteTable}:soft-delete]`, error)
  })
  return deleted_at
}

/** Soft-delete many rows in one shot (used by cascade deletes). */
export async function softDeleteMany(
  local: Table,
  remoteTable: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const deleted_at = stamp()
  await local.where('id').anyOf(ids).modify({ deleted_at })
  supabase.from(remoteTable).update({ deleted_at }).in('id', ids).then(({ error }) => {
    if (error) console.error(`[supabase:${remoteTable}:soft-delete-many]`, error)
  })
}

/** Predicate for the Dexie fallback path: keep only live (non-tombstoned) rows. */
export function isLive<T extends { deleted_at?: string | null }>(row: T): boolean {
  return !row.deleted_at
}
