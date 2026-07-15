-- ============================================================================
-- 0005_user_backups.sql — Automatic cloud backups (snapshots)
--
-- Run this in the Supabase SQL Editor. IDEMPOTENT (safe to re-run).
--
-- A `user_backups` row is a full point-in-time snapshot of ALL of a user's
-- data, in exactly the same JSON shape as the manual export file
-- ({ version, exportedAt, data: { accounts, transactions, ... } }).
-- The app creates one automatically at most once per 24h on startup, one
-- before every backup restore ('pre-restore'), and on demand ('manual').
-- Old snapshots are pruned client-side per kind (RLS keeps it owner-scoped).
--
-- Snapshots are IMMUTABLE: there is deliberately NO update policy.
-- ============================================================================

create table if not exists public.user_backups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind       text not null default 'auto' check (kind in ('auto', 'manual', 'pre-restore')),
  -- per-table record counts, for showing list entries without pulling payloads
  counts     jsonb not null default '{}'::jsonb,
  -- the full backup file (same shape as the manual JSON export)
  payload    jsonb not null
);

-- List queries are always "newest first for one user"
create index if not exists user_backups_user_created_idx
  on public.user_backups (user_id, created_at desc);

-- ── RLS: strict owner-only, same pattern as the data tables ────────────────
alter table public.user_backups enable row level security;
alter table public.user_backups force row level security;

drop policy if exists user_backups_select_own on public.user_backups;
drop policy if exists user_backups_insert_own on public.user_backups;
drop policy if exists user_backups_delete_own on public.user_backups;

create policy user_backups_select_own on public.user_backups
  for select to authenticated using (user_id = auth.uid());
create policy user_backups_insert_own on public.user_backups
  for insert to authenticated with check (user_id = auth.uid());
create policy user_backups_delete_own on public.user_backups
  for delete to authenticated using (user_id = auth.uid());
