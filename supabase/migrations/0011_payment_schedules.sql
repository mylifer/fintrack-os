-- ============================================================================
-- 0011_payment_schedules.sql — Ödeme Takvimi (bank loan / credit card due days)
--
-- Run this in the Supabase SQL Editor. IDEMPOTENT (safe to re-run).
--
-- A `payment_schedules` row is a lightweight reminder: a name (e.g. "Ziraat
-- Kredi Kartı"), a type, a default day-of-month (`dueDay`), an optional JSON
-- map of per-month overrides ("YYYY-MM" -> ISO date) for the months the due
-- date shifts (weekend/holiday), and a JSON map of paid periods ("YYYY-MM" ->
-- ISO date paid) that closes a month's reminder. It does NOT touch account balances or
-- debt payment plans — same "reminder, not schedule anchor" role as
-- Debt.dueDate (see src/types/index.ts).
--
-- Same shape/hardening pattern as the other synced tables (see
-- supabase_schema.sql's reusable DO block): text id (client-generated uuid),
-- user_id ownership column, deleted_at tombstone (C3), workspaceId
-- partitioning. rls_auto_enable (0010) already enables RLS the instant this
-- table is created (fail-closed deny-all); the explicit owner policies below
-- are what actually let the app read/write it.
-- ============================================================================

create table if not exists public.payment_schedules (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  "name"       text not null,
  "type"       text not null check ("type" in ('credit_card', 'loan', 'other')),
  "dueDay"     integer not null check ("dueDay" between 1 and 31),
  amount       numeric,
  "accountId"  text,
  notes        text,
  "isActive"   boolean not null default true,
  overrides    jsonb,
  "paidMonths" jsonb,
  "createdAt"  text not null,
  deleted_at   timestamptz,
  "workspaceId" text
);

-- Bu dosyanın "paidMonths"tan ÖNCEKİ hâlini çalıştırmış projeler için
-- (create table if not exists mevcut tabloya sütun eklemez). Sütun yoksa istemci
-- push'u PGRST204 ile reddedilir ve outbox'ta takılır.
alter table public.payment_schedules add column if not exists "paidMonths" jsonb;

-- ── Table-level grant ───────────────────────────────────────────────────────
-- Some projects lack the default-privilege grants for newly created tables,
-- which surfaces as "permission denied for table payment_schedules" despite
-- correct RLS policies (grants and RLS are separate layers).
grant select, insert, update, delete on table public.payment_schedules to authenticated;

-- ── Partial index over live rows, scoped by owner (fast per-user reads) ────
create index if not exists payment_schedules_user_live_idx
  on public.payment_schedules (user_id) where deleted_at is null;

-- ── RLS: strict owner-only, same pattern as the data tables ────────────────
alter table public.payment_schedules enable row level security;
alter table public.payment_schedules force row level security;

drop policy if exists payment_schedules_select_own on public.payment_schedules;
drop policy if exists payment_schedules_insert_own on public.payment_schedules;
drop policy if exists payment_schedules_update_own on public.payment_schedules;
drop policy if exists payment_schedules_delete_own on public.payment_schedules;

create policy payment_schedules_select_own on public.payment_schedules
  for select to authenticated using (user_id = auth.uid());
create policy payment_schedules_insert_own on public.payment_schedules
  for insert to authenticated with check (user_id = auth.uid());
create policy payment_schedules_update_own on public.payment_schedules
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy payment_schedules_delete_own on public.payment_schedules
  for delete to authenticated using (user_id = auth.uid());
