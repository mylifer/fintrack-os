-- ============================================================================
-- supabase_schema.sql — Phase 1 remediation: C3 (Tombstones) + C7 (RLS)
--
-- Run this in the Supabase SQL Editor. It is IDEMPOTENT (safe to re-run):
-- every statement uses IF NOT EXISTS / DROP ... IF EXISTS.
--
-- What it does, for EVERY user-owned table:
--   1. Adds a nullable `deleted_at timestamptz` tombstone column (C3).
--      Soft deletes are UPDATEs that set this; the client filters
--      `deleted_at is null` on read, so a deleted row never resurrects.
--   2. Adds a partial index over live rows for fast per-user reads.
--   3. Enables Row-Level Security and installs STRICT owner-only policies for
--      SELECT / INSERT / UPDATE / DELETE, all keyed on `user_id = auth.uid()` (C7).
--
-- PRECONDITION: every table already has a `user_id uuid` column referencing
-- auth.users(id). (The app writes user_id on every insert.)
--
-- DEPLOY ORDER: apply this migration BEFORE shipping the Phase-1 client build.
-- The client now issues `.is('deleted_at', null)` on every load; without the
-- column those queries error and the app silently falls back to local Dexie.
-- ============================================================================

-- Tables covered (Supabase/Postgres names). Keep this list in sync with the
-- Dexie schema in src/lib/db/index.ts.
--   accounts, transactions, categories, budgets, debts,
--   investment_transactions, people, recurring_transactions

-- ── Reusable installer ──────────────────────────────────────────────────────
-- A DO block applies the identical hardening to each table so no table can be
-- accidentally left without a policy (the classic RLS foot-gun).
do $$
declare
  t text;
  pol text;
  tables text[] := array[
    'accounts',
    'transactions',
    'categories',
    'budgets',
    'debts',
    'investment_transactions',
    'people',
    'recurring_transactions'
  ];
begin
  foreach t in array tables loop
    -- 1. Tombstone column (C3)
    execute format(
      'alter table public.%I add column if not exists deleted_at timestamptz;', t
    );

    -- 2. Partial index over live rows, scoped by owner (fast per-user reads)
    execute format(
      'create index if not exists %I on public.%I (user_id) where deleted_at is null;',
      t || '_user_live_idx', t
    );

    -- 3. Drop EVERY existing policy on the table — including legacy/permissive
    --    ones (e.g. a leftover "allow all" USING (true) from project setup) that
    --    would otherwise OR-combine with ours and defeat isolation.
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I;', pol, t);
    end loop;

    -- 4. Enable + FORCE RLS. FORCE also subjects the table owner to RLS;
    --    service_role has BYPASSRLS so backups/admin keep working, and the
    --    security-invoker restore RPC runs as the authenticated user (allowed
    --    by the owner policies below).
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    -- 5. Owner-only policies (the ONLY policies that now exist on the table).
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid());',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid());',
      t || '_insert_own', t
    );
    -- UPDATE needs BOTH: USING (which rows may be targeted) and
    -- WITH CHECK (the row may not be re-assigned to another user).
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid());',
      t || '_delete_own', t
    );
  end loop;
end $$;

-- ── Base-currency snapshot (S2/S3) ──────────────────────────────────────────
-- transactions."amountTry" stores the amount converted to base currency (TRY)
-- at write time. Analytics sum this column; a null (legacy row) is converted
-- client-side at the live rate. Quoted identifier to match the app's camelCase.
alter table public.transactions add column if not exists "amountTry" double precision;

-- ── Refund link (S4) + first-class system marker (S7) ───────────────────────
-- "refundOfId": on a refund entry, the id of the original transaction it offsets
--   (enables the cumulative-refund guard).
-- "systemKind": authoritative marker for system ghost entries (reconciliation),
--   replacing brittle tag-string matching in analytics.
alter table public.transactions add column if not exists "refundOfId" text;
alter table public.transactions add column if not exists "systemKind" text;

-- ── Category feature columns (schema-drift fix) ─────────────────────────────
-- The client Category model carries "isArchived" (soft-hide from pickers, keep
-- historical data) and "sortOrder" (manual ordering). Category tables created
-- before these features lack the columns, so upserts fail with PGRST204
-- ("Could not find the 'isArchived' column of 'categories'") → HTTP 400 and the
-- outbox retries forever. Quoted identifiers match the app's camelCase columns.
alter table public.categories add column if not exists "isArchived" boolean;
alter table public.categories add column if not exists "sortOrder" integer;

-- ── Verification helpers (optional; run manually after applying) ─────────────
-- Every table below MUST report rowsecurity = true:
--   select relname, relrowsecurity as rls_enabled
--   from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in (
--       'accounts','transactions','categories','budgets','debts',
--       'investment_transactions','people','recurring_transactions'
--     )
--   order by relname;
--
-- Every table should list exactly four policies (_select/_insert/_update/_delete_own):
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename, cmd;
