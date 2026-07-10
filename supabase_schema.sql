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

    -- 3. Enable RLS (C7). No FORCE: the security-invoker restore RPC and the
    --    service_role key continue to operate; anon/authenticated are gated.
    execute format('alter table public.%I enable row level security;', t);

    -- 4. Owner-only policies. Drop first so re-runs don't error on duplicates.
    execute format('drop policy if exists %I on public.%I;', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete_own', t);

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
