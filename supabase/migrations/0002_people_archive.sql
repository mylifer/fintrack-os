-- ============================================================================
-- 0002_people_archive.sql — Kişi silme → arşivleme
--
-- Kişiler (alıcı / aile üyesi) artık tombstone'lanmak yerine arşivlenir:
-- bağlı işlemler HİÇBİR ZAMAN etkilenmez ve geçmiş işlemlerdeki isim bağı
-- korunur. Bu migration:
--   1. public.people tablosuna "isArchived" sütununu ekler.
--   2. restore_user_backup RPC'sini, people satırlarında "isArchived"
--      alanını da taşıyacak şekilde günceller.
--
-- Supabase SQL Editor'de çalıştırın. IDEMPOTENT (tekrar çalıştırılabilir).
-- DEPLOY SIRASI: Bu migration'ı yeni istemci build'inden ÖNCE uygulayın —
-- sütun yokken kişi arşivleme yazmaları push'ta hata alır.
-- ============================================================================

alter table public.people
  add column if not exists "isArchived" boolean not null default false;

-- ── restore_user_backup: people insert'ine "isArchived" eklendi ─────────────
create or replace function public.restore_user_backup(payload jsonb, target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  -- A user may only restore into their own account.
  if uid is null or target_user_id is null or target_user_id <> uid then
    raise exception 'unauthorized: target_user_id must match the authenticated user';
  end if;

  -- ── 1. Delete existing rows, children → parents ───────────────────────────
  delete from public.investment_transactions where user_id = target_user_id;
  delete from public.transactions            where user_id = target_user_id;
  delete from public.budgets                 where user_id = target_user_id;
  delete from public.recurring_transactions  where user_id = target_user_id;
  delete from public.debts                   where user_id = target_user_id;
  delete from public.people                  where user_id = target_user_id;
  delete from public.accounts                where user_id = target_user_id;
  delete from public.categories              where user_id = target_user_id;

  -- ── 2. Insert backup rows, parents → children ─────────────────────────────
  insert into public.categories
    (id, name, icon, color, scope, "parentId", "isSystem", "isArchived", "sortOrder", user_id)
  select r.id, r.name, r.icon, r.color, r.scope, r."parentId", r."isSystem", r."isArchived", r."sortOrder", target_user_id
  from jsonb_populate_recordset(null::public.categories, payload->'categories') as r;

  insert into public.accounts
    (id, name, type, currency, "initialBalance", color, icon, "isArchived", "createdAt",
     "creditLimit", "statementDay", "dueDay", "minPayPct", user_id)
  select r.id, r.name, r.type, r.currency, r."initialBalance", r.color, r.icon, r."isArchived", r."createdAt",
         r."creditLimit", r."statementDay", r."dueDay", r."minPayPct", target_user_id
  from jsonb_populate_recordset(null::public.accounts, payload->'accounts') as r;

  insert into public.people
    (id, name, role, url, "createdAt", "isArchived", user_id)
  select r.id, r.name, r.role, r.url, r."createdAt", coalesce(r."isArchived", false), target_user_id
  from jsonb_populate_recordset(null::public.people, payload->'people') as r;

  insert into public.debts
    (id, name, type, direction, "totalAmount", "paidAmount", "interestRate", "startDate", "dueDate",
     "monthlyPayment", "totalInstallments", "paidInstallments", counterparty, "accountId", notes, "isSettled", "createdAt", user_id)
  select r.id, r.name, r.type, r.direction, r."totalAmount", r."paidAmount", r."interestRate", r."startDate", r."dueDate",
         r."monthlyPayment", r."totalInstallments", r."paidInstallments", r.counterparty, r."accountId", r.notes, r."isSettled", r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.debts, payload->'debts') as r;

  insert into public.recurring_transactions
    (id, name, type, amount, currency, "accountId", "toAccountId", "categoryId", description, notes, frequency,
     "dayOfMonth", "monthOfYear", "startDate", "endDate", "nextDueDate", "lastGeneratedDate", "isActive",
     "familyMemberId", "recipientId", "createdAt", user_id)
  select r.id, r.name, r.type, r.amount, r.currency, r."accountId", r."toAccountId", r."categoryId", r.description, r.notes, r.frequency,
         r."dayOfMonth", r."monthOfYear", r."startDate", r."endDate", r."nextDueDate", r."lastGeneratedDate", r."isActive",
         r."familyMemberId", r."recipientId", r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.recurring_transactions, payload->'recurringTransactions') as r;

  insert into public.budgets
    (id, "categoryId", amount, period, year, month, rollover, "alertThreshold", user_id)
  select r.id, r."categoryId", r.amount, r.period, r.year, r.month, r.rollover, r."alertThreshold", target_user_id
  from jsonb_populate_recordset(null::public.budgets, payload->'budgets') as r;

  insert into public.transactions
    (id, type, amount, "amountTry", currency, date, "accountId", "toAccountId", "categoryId", icon, description, notes, tags, merchant,
     "familyMemberId", "recipientId", "isInstallment", "installTotal", "installIndex", "installGroupId", "debtId", "refundOfId", "systemKind",
     "createdAt", "updatedAt", user_id)
  select r.id, r.type, r.amount, r."amountTry", r.currency, r.date, r."accountId", r."toAccountId", r."categoryId", r.icon, r.description, r.notes, r.tags, r.merchant,
         r."familyMemberId", r."recipientId", r."isInstallment", r."installTotal", r."installIndex", r."installGroupId", r."debtId", r."refundOfId", r."systemKind",
         r."createdAt", r."updatedAt", target_user_id
  from jsonb_populate_recordset(null::public.transactions, payload->'transactions') as r;

  insert into public.investment_transactions
    (id, type, asset, quantity, "pricePerUnit", "sourceAccountId", "targetAccountId", "linkedTransactionId", date, note, "createdAt", user_id)
  select r.id, r.type, r.asset, r.quantity, r."pricePerUnit", r."sourceAccountId", r."targetAccountId", r."linkedTransactionId", r.date, r.note, r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.investment_transactions, payload->'investmentTransactions') as r;
end;
$$;

grant execute on function public.restore_user_backup(jsonb, uuid) to authenticated;
