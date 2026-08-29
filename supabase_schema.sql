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
--
-- ⚠️ BU DOSYA TEK BAŞINA YETERLİ DEĞİLDİR.
-- Sıfırdan bir proje kuruyorsanız (felaket kurtarma, test ortamı) bunu
-- çalıştırdıktan SONRA supabase/migrations/0001..0010'u da sırayla uygulayın.
-- Yalnızca burada olmayan, migration'lara bağlı parçalar:
--   • user_backups tablosu + RLS'i            → 0005
--   • restore_user_backup() RPC'si            → 0004, 0009 (0009 önce F1 için
--                                                düzeltilmiş olmalı)
--   • investment_transactions.asset CHECK'i   → 0003
--   • rls_auto_enable() + ensure_rls trigger  → 0010
-- Sütunlar aşağıda tutulmaya çalışılıyor ama geçmişte kaydı: `categorySplits`
-- (0007) uzun süre yalnızca migration'da kaldı. Yeni bir sütun eklerken HEM
-- migration'a HEM buraya yazın. (Güvenlik denetimi 2026-08-29 → H2.)
-- ============================================================================

-- Tables covered (Supabase/Postgres names). Keep this list in sync with the
-- Dexie schema in src/lib/db/index.ts.
--   accounts, transactions, categories, budgets, debts,
--   investment_transactions, people, recurring_transactions, workspaces

-- ── Çoklu Çalışma Alanı (Workspace) desteği ─────────────────────────────────
-- "workspaces": kullanıcının birden fazla, birbirini etkilemeyen bütçe/hesap
-- alanı arasında geçiş yapabilmesini sağlayan konteyner tablo. Kendisi bir
-- workspaceId taşımaz (diğer 8 tablonun bölümleme eksenidir). Legacy satırlar
-- (bu özellik gelmeden önce oluşturulmuş) hiçbir tabloda workspaceId taşımaz
-- ve istemci tarafında "varsayılan çalışma alanına ait" olarak okunur — bu
-- yüzden burada bilinçli olarak bir veri backfill'i YOK.
create table if not exists public.workspaces (
  id text primary key,
  user_id uuid not null,
  "name" text,
  "isDefault" boolean,
  "createdAt" text,
  deleted_at timestamptz
);

-- Diğer 8 tablo Supabase Studio üzerinden oluşturulduğu için "authenticated"
-- rolüne tablo-seviyesi GRANT'i otomatik almıştı; bu tablo SQL Editor'de ham
-- DDL ile oluşturulduğundan bu grant'i otomatik almıyor — RLS politikaları
-- doğru olsa da grant yoksa "permission denied for table workspaces" hatası
-- alınır (RLS ihlalinden FARKLI bir hata; RLS engeli boş sonuç/"new row
-- violates row-level security policy" verir, bu ise tablo-seviyesi izin).
grant select, insert, update, delete on public.workspaces to authenticated;

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
    'recurring_transactions',
    'workspaces'
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

-- İade mimarisi (S4) bilinçli olarak NEGATİF tutarlı bir `expense` satırı yazar
-- (orijinal harcamayı netler). Tablo ilk kurulduğunda konan `amount > 0` tipli
-- eski CHECK kısıtı bu negatif satırları reddedip outbox'ı dead-letter yapıyordu
-- ("transactions_amount_check" ihlali). Negatif tutarlar geçerli olduğundan kısıtı
-- düşürüyoruz. Idempotent + veri-güvenli: mevcut satırlara dokunmaz.
alter table public.transactions drop constraint if exists transactions_amount_check;

-- ── Schema-drift guard: every column the client can push ────────────────────
-- The sync engine upserts the FULL row snapshot (toSnapshot() copies all entity
-- fields except user_id and the COMPUTED[table] fields). If any pushed field has
-- no matching column, PostgREST rejects the whole request with PGRST204 → HTTP
-- 400 and the outbox retries forever (this is how categories.isArchived surfaced
-- on 2026-07-14). This block adds every pushable column for all 8 synced tables.
-- Idempotent + data-safe: never touches id / user_id / deleted_at or existing
-- data. Keep in sync with src/types/index.ts as the model evolves.
-- ── Çoklu Çalışma Alanı: bölümleme kolonu ────────────────────────────────────
-- Nullable/opsiyonel: legacy satırlar (workspaceId'siz) varsayılan çalışma
-- alanına ait sayılır (istemci tarafı kuralı — bkz. src/lib/workspace-context.ts).
alter table public.accounts add column if not exists "workspaceId" text;
alter table public.transactions add column if not exists "workspaceId" text;
alter table public.categories add column if not exists "workspaceId" text;
alter table public.budgets add column if not exists "workspaceId" text;
alter table public.debts add column if not exists "workspaceId" text;
alter table public.investment_transactions add column if not exists "workspaceId" text;
alter table public.people add column if not exists "workspaceId" text;
alter table public.recurring_transactions add column if not exists "workspaceId" text;

alter table public.accounts add column if not exists "name" text;
alter table public.accounts add column if not exists "type" text;
alter table public.accounts add column if not exists "currency" text;
alter table public.accounts add column if not exists "initialBalance" double precision;
alter table public.accounts add column if not exists "color" text;
alter table public.accounts add column if not exists "icon" text;
alter table public.accounts add column if not exists "isArchived" boolean;
alter table public.accounts add column if not exists "createdAt" text;
alter table public.accounts add column if not exists "creditLimit" double precision;
alter table public.accounts add column if not exists "statementDay" double precision;
alter table public.accounts add column if not exists "dueDay" double precision;
alter table public.accounts add column if not exists "minPayPct" double precision;

alter table public.transactions add column if not exists "type" text;
alter table public.transactions add column if not exists "amount" double precision;
alter table public.transactions add column if not exists "currency" text;
alter table public.transactions add column if not exists "date" text;
alter table public.transactions add column if not exists "accountId" text;
alter table public.transactions add column if not exists "toAccountId" text;
alter table public.transactions add column if not exists "categoryId" text;
alter table public.transactions add column if not exists "icon" text;
alter table public.transactions add column if not exists "description" text;
alter table public.transactions add column if not exists "notes" text;
alter table public.transactions add column if not exists "tags" jsonb;
alter table public.transactions add column if not exists "merchant" text;
alter table public.transactions add column if not exists "familyMemberId" text;
alter table public.transactions add column if not exists "recipientId" text;
alter table public.transactions add column if not exists "isInstallment" boolean;
alter table public.transactions add column if not exists "installTotal" double precision;
alter table public.transactions add column if not exists "installIndex" double precision;
alter table public.transactions add column if not exists "installGroupId" text;
alter table public.transactions add column if not exists "debtId" text;
alter table public.transactions add column if not exists "debtPrincipalId" text;
alter table public.transactions add column if not exists "createdAt" text;
alter table public.transactions add column if not exists "updatedAt" text;

-- Çoklu kategori (0007): [{ "categoryId": "...", "amount": 123.45 }, ...].
-- null = bölünmemiş işlem. Bu dosyada EKSİKTİ — yalnızca migration'da vardı;
-- sıfırdan kurulan bir projede sütun olmadığı için sync engine'in tam satır
-- upsert'i PGRST204 alır ve HER işlem dead-letter'a düşerdi
-- (güvenlik denetimi 2026-08-29 → H2).
alter table public.transactions add column if not exists "categorySplits" jsonb;

-- ── Onay kapısı (bildirim merkezi) ───────────────────────────────────────────
-- "approvalStatus": null = legacy satır (tarihi gelince otomatik post — mevcut
-- davranış), 'pending' = kullanıcı onayı bekliyor (bakiyeye girmez),
-- 'approved' = onaylandı. Sütun adı camelCase: sync engine tam satır
-- snapshot'ını alan adlarıyla birebir push eder (bkz. "amountTry"), snake_case
-- sütun outbox'ı dead-letter yapar.
-- Çalışma alanları arası transfer (S1): kaynak alanda 'expense', hedef alanda
-- 'income' olarak iki bağımsız satır, ortak workspaceTransferId ile eşleşir.
alter table public.transactions add column if not exists "workspaceTransferId" text;
alter table public.transactions add column if not exists "peerWorkspaceId" text;

alter table public.transactions add column if not exists "approvalStatus" text;
alter table public.transactions drop constraint if exists transactions_approval_status_check;
alter table public.transactions add constraint transactions_approval_status_check
  check ("approvalStatus" is null or "approvalStatus" in ('pending', 'approved'));
alter table public.transactions add column if not exists "approvedAt" timestamptz;

alter table public.categories add column if not exists "name" text;
alter table public.categories add column if not exists "icon" text;
alter table public.categories add column if not exists "color" text;
alter table public.categories add column if not exists "scope" text;
alter table public.categories add column if not exists "parentId" text;
alter table public.categories add column if not exists "isSystem" boolean;
alter table public.categories add column if not exists "isArchived" boolean;
alter table public.categories add column if not exists "sortOrder" double precision;

alter table public.budgets add column if not exists "categoryId" text;
alter table public.budgets add column if not exists "amount" double precision;
alter table public.budgets add column if not exists "period" text;
alter table public.budgets add column if not exists "year" double precision;
alter table public.budgets add column if not exists "month" double precision;
alter table public.budgets add column if not exists "rollover" boolean;
alter table public.budgets add column if not exists "alertThreshold" double precision;
alter table public.budgets add column if not exists "categoryName" text;

alter table public.debts add column if not exists "name" text;
alter table public.debts add column if not exists "type" text;
alter table public.debts add column if not exists "direction" text;
alter table public.debts add column if not exists "totalAmount" double precision;
alter table public.debts add column if not exists "paidAmount" double precision;
alter table public.debts add column if not exists "interestRate" double precision;
alter table public.debts add column if not exists "startDate" text;
alter table public.debts add column if not exists "borrowDate" text;
alter table public.debts add column if not exists "dueDate" text;
alter table public.debts add column if not exists "monthlyPayment" double precision;
alter table public.debts add column if not exists "totalInstallments" double precision;
alter table public.debts add column if not exists "paidInstallments" double precision;
alter table public.debts add column if not exists "counterparty" text;
alter table public.debts add column if not exists "accountId" text;
alter table public.debts add column if not exists "notes" text;
alter table public.debts add column if not exists "isSettled" boolean;
alter table public.debts add column if not exists "createdAt" text;

alter table public.investment_transactions add column if not exists "type" text;
alter table public.investment_transactions add column if not exists "asset" text;
alter table public.investment_transactions add column if not exists "quantity" double precision;
alter table public.investment_transactions add column if not exists "pricePerUnit" double precision;
alter table public.investment_transactions add column if not exists "sourceAccountId" text;
alter table public.investment_transactions add column if not exists "targetAccountId" text;
alter table public.investment_transactions add column if not exists "linkedTransactionId" text;
alter table public.investment_transactions add column if not exists "pnlLinkedTransactionId" text;
alter table public.investment_transactions add column if not exists "date" text;
alter table public.investment_transactions add column if not exists "note" text;
alter table public.investment_transactions add column if not exists "createdAt" text;

alter table public.people add column if not exists "name" text;
alter table public.people add column if not exists "role" text;
alter table public.people add column if not exists "url" text;
alter table public.people add column if not exists "createdAt" text;

alter table public.recurring_transactions add column if not exists "name" text;
alter table public.recurring_transactions add column if not exists "type" text;
alter table public.recurring_transactions add column if not exists "amount" double precision;
alter table public.recurring_transactions add column if not exists "currency" text;
alter table public.recurring_transactions add column if not exists "accountId" text;
alter table public.recurring_transactions add column if not exists "toAccountId" text;
alter table public.recurring_transactions add column if not exists "categoryId" text;
alter table public.recurring_transactions add column if not exists "description" text;
alter table public.recurring_transactions add column if not exists "notes" text;
alter table public.recurring_transactions add column if not exists "frequency" text;
alter table public.recurring_transactions add column if not exists "dayOfMonth" double precision;
alter table public.recurring_transactions add column if not exists "monthOfYear" double precision;
alter table public.recurring_transactions add column if not exists "startDate" text;
alter table public.recurring_transactions add column if not exists "endDate" text;
alter table public.recurring_transactions add column if not exists "nextDueDate" text;
alter table public.recurring_transactions add column if not exists "lastGeneratedDate" text;
alter table public.recurring_transactions add column if not exists "isActive" boolean;
alter table public.recurring_transactions add column if not exists "familyMemberId" text;
alter table public.recurring_transactions add column if not exists "recipientId" text;
alter table public.recurring_transactions add column if not exists "createdAt" text;

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
