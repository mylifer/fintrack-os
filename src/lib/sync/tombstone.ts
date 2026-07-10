import type { OutboxEntry } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Tombstones — Deletion Integrity (C3)

   Soft deletes stamp `deleted_at` and keep the row so the deletion propagates
   as an ordinary UPDATE instead of a DELETE (which a fire-and-forget sync would
   lose, resurrecting the row on the next reconciling pull).

   The soft-delete WRITE path (softDelete/softDeleteMany) lives in the sync
   engine so it goes through the durable outbox (see src/lib/sync/engine.ts).
   This module keeps only the read-side predicate, shared by every load()
   fallback and the reconciling pull.
──────────────────────────────────────────────────────────────────────── */

/** Keep only live (non-tombstoned) rows. */
export function isLive<T extends { deleted_at?: string | null }>(row: T): boolean {
  return !row.deleted_at
}

// Re-export so callers that only need the type don't reach into engine internals.
export type { OutboxEntry }
