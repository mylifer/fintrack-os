'use client'

import { reconcilingPull, type SyncTable } from '@/lib/sync/engine'

/* ── Shared store skeleton helpers ──────────────────────────────────────────
   The data stores all repeat the same load() shape: a reconciling cloud pull
   (C2), and on failure a Dexie fallback that keeps the app working offline.
   loadEntities factors out ONLY that fetch+fallback skeleton; each store still
   owns its own set() (state-key name, `ready`/`loading` flags) and any custom
   ordering. `post` is applied to the reconciled cloud rows; the `fallback` is
   fully self-contained (it does its own filter/sort) so stores whose two
   branches order differently stay byte-identical. */
export async function loadEntities<T>(
  table: SyncTable,
  label: string,
  fallback: () => Promise<T[]>,
  post?: (rows: T[]) => T[],
): Promise<T[]> {
  try {
    const rows = await reconcilingPull<T>(table)
    return post ? post(rows) : rows
  } catch (err) {
    console.error(`[${label}:load]`, err)
    return fallback()
  }
}
