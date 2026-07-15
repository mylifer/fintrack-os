-- ============================================================================
-- 0004 — restore_user_backup: hard delete → tombstone + upsert
--
-- reconcilingPull artık silmeyi YALNIZCA buluttan gelen `deleted_at`
-- satırından öğrenir (yokluğa göre silme kaldırıldı — GOLD_BRACELET vakası).
-- Eski RPC geri yüklemede satırları HARD DELETE ettiği için, yedekte olmayan
-- bir kaydın kopyası başka bir cihazda kaldıysa o cihaz kaydı "buluta hiç
-- ulaşmamış" sanıp yeniden push ederdi (restore sonrası diriltme).
--
-- Yeni akış, aynı tek transaction içinde:
--   1. Kullanıcının TÜM satırları tombstone'lanır (deleted_at = now()).
--   2. Yedekteki satırlar id üzerinden UPSERT edilir ve deleted_at = null ile
--      diriltilir. Yedekte olmayanlar tombstone kalır → diğer cihazlar
--      silinmeyi pozitif kanıtla öğrenir.
--
-- FK notu: satırlar silinmediği için çocuk→ebeveyn silme sırası ve
-- ON DELETE CASCADE zincirleri artık devreye girmez; upsert sırası yine
-- ebeveyn→çocuk tutulur (yedekten İLK KEZ gelen satırların FK'ları için).
--
-- Idempotent (create or replace). Supabase SQL Editor'de çalıştırın.
-- ============================================================================

create or replace function public.restore_user_backup(payload jsonb, target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ts timestamptz := now();
begin
  -- A user may only restore into their own account.
  if uid is null or target_user_id is null or target_user_id <> uid then
    raise exception 'unauthorized: target_user_id must match the authenticated user';
  end if;

  -- ── 1. Tombstone every existing row (no hard delete) ──────────────────────
  update public.investment_transactions set deleted_at = ts where user_id = target_user_id;
  update public.transactions            set deleted_at = ts where user_id = target_user_id;
  update public.budgets                 set deleted_at = ts where user_id = target_user_id;
  update public.recurring_transactions  set deleted_at = ts where user_id = target_user_id;
  update public.debts                   set deleted_at = ts where user_id = target_user_id;
  update public.people                  set deleted_at = ts where user_id = target_user_id;
  update public.accounts                set deleted_at = ts where user_id = target_user_id;
  update public.categories              set deleted_at = ts where user_id = target_user_id;

  -- ── 2. Upsert backup rows (parents → children), resurrecting each ─────────
  -- jsonb_populate_recordset casts each JSON element to the table's row type
  -- (unknown keys such as accounts.balance are ignored); user_id is forced to
  -- the caller. `on conflict (id) do update` revives rows tombstoned in step 1;
  -- rows new to the cloud take the plain-insert path (deleted_at defaults null).

  insert into public.categories
    (id, name, icon, color, scope, "parentId", "isSystem", "isArchived", "sortOrder", user_id)
  select r.id, r.name, r.icon, r.color, r.scope, r."parentId", r."isSystem", r."isArchived", r."sortOrder", target_user_id
  from jsonb_populate_recordset(null::public.categories, payload->'categories') as r
  on conflict (id) do update set
    name = excluded.name, icon = excluded.icon, color = excluded.color, scope = excluded.scope,
    "parentId" = excluded."parentId", "isSystem" = excluded."isSystem", "isArchived" = excluded."isArchived",
    "sortOrder" = excluded."sortOrder", user_id = excluded.user_id, deleted_at = null;

  insert into public.accounts
    (id, name, type, currency, "initialBalance", color, icon, "isArchived", "createdAt",
     "creditLimit", "statementDay", "dueDay", "minPayPct", user_id)
  select r.id, r.name, r.type, r.currency, r."initialBalance", r.color, r.icon, r."isArchived", r."createdAt",
         r."creditLimit", r."statementDay", r."dueDay", r."minPayPct", target_user_id
  from jsonb_populate_recordset(null::public.accounts, payload->'accounts') as r
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, currency = excluded.currency,
    "initialBalance" = excluded."initialBalance", color = excluded.color, icon = excluded.icon,
    "isArchived" = excluded."isArchived", "createdAt" = excluded."createdAt",
    "creditLimit" = excluded."creditLimit", "statementDay" = excluded."statementDay",
    "dueDay" = excluded."dueDay", "minPayPct" = excluded."minPayPct",
    user_id = excluded.user_id, deleted_at = null;

  insert into public.people
    (id, name, role, url, "createdAt", user_id)
  select r.id, r.name, r.role, r.url, r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.people, payload->'people') as r
  on conflict (id) do update set
    name = excluded.name, role = excluded.role, url = excluded.url,
    "createdAt" = excluded."createdAt", user_id = excluded.user_id, deleted_at = null;

  insert into public.debts
    (id, name, type, direction, "totalAmount", "paidAmount", "interestRate", "startDate", "dueDate",
     "monthlyPayment", "totalInstallments", "paidInstallments", counterparty, "accountId", notes, "isSettled", "createdAt", user_id)
  select r.id, r.name, r.type, r.direction, r."totalAmount", r."paidAmount", r."interestRate", r."startDate", r."dueDate",
         r."monthlyPayment", r."totalInstallments", r."paidInstallments", r.counterparty, r."accountId", r.notes, r."isSettled", r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.debts, payload->'debts') as r
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, direction = excluded.direction,
    "totalAmount" = excluded."totalAmount", "paidAmount" = excluded."paidAmount",
    "interestRate" = excluded."interestRate", "startDate" = excluded."startDate", "dueDate" = excluded."dueDate",
    "monthlyPayment" = excluded."monthlyPayment", "totalInstallments" = excluded."totalInstallments",
    "paidInstallments" = excluded."paidInstallments", counterparty = excluded.counterparty,
    "accountId" = excluded."accountId", notes = excluded.notes, "isSettled" = excluded."isSettled",
    "createdAt" = excluded."createdAt", user_id = excluded.user_id, deleted_at = null;

  insert into public.recurring_transactions
    (id, name, type, amount, currency, "accountId", "toAccountId", "categoryId", description, notes, frequency,
     "dayOfMonth", "monthOfYear", "startDate", "endDate", "nextDueDate", "lastGeneratedDate", "isActive",
     "familyMemberId", "recipientId", "createdAt", user_id)
  select r.id, r.name, r.type, r.amount, r.currency, r."accountId", r."toAccountId", r."categoryId", r.description, r.notes, r.frequency,
         r."dayOfMonth", r."monthOfYear", r."startDate", r."endDate", r."nextDueDate", r."lastGeneratedDate", r."isActive",
         r."familyMemberId", r."recipientId", r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.recurring_transactions, payload->'recurringTransactions') as r
  on conflict (id) do update set
    name = excluded.name, type = excluded.type, amount = excluded.amount, currency = excluded.currency,
    "accountId" = excluded."accountId", "toAccountId" = excluded."toAccountId", "categoryId" = excluded."categoryId",
    description = excluded.description, notes = excluded.notes, frequency = excluded.frequency,
    "dayOfMonth" = excluded."dayOfMonth", "monthOfYear" = excluded."monthOfYear",
    "startDate" = excluded."startDate", "endDate" = excluded."endDate", "nextDueDate" = excluded."nextDueDate",
    "lastGeneratedDate" = excluded."lastGeneratedDate", "isActive" = excluded."isActive",
    "familyMemberId" = excluded."familyMemberId", "recipientId" = excluded."recipientId",
    "createdAt" = excluded."createdAt", user_id = excluded.user_id, deleted_at = null;

  insert into public.budgets
    (id, "categoryId", amount, period, year, month, rollover, "alertThreshold", user_id)
  select r.id, r."categoryId", r.amount, r.period, r.year, r.month, r.rollover, r."alertThreshold", target_user_id
  from jsonb_populate_recordset(null::public.budgets, payload->'budgets') as r
  on conflict (id) do update set
    "categoryId" = excluded."categoryId", amount = excluded.amount, period = excluded.period,
    year = excluded.year, month = excluded.month, rollover = excluded.rollover,
    "alertThreshold" = excluded."alertThreshold", user_id = excluded.user_id, deleted_at = null;

  insert into public.transactions
    (id, type, amount, "amountTry", currency, date, "accountId", "toAccountId", "categoryId", icon, description, notes, tags, merchant,
     "familyMemberId", "recipientId", "isInstallment", "installTotal", "installIndex", "installGroupId", "debtId", "refundOfId", "systemKind",
     "createdAt", "updatedAt", user_id)
  select r.id, r.type, r.amount, r."amountTry", r.currency, r.date, r."accountId", r."toAccountId", r."categoryId", r.icon, r.description, r.notes, r.tags, r.merchant,
         r."familyMemberId", r."recipientId", r."isInstallment", r."installTotal", r."installIndex", r."installGroupId", r."debtId", r."refundOfId", r."systemKind",
         r."createdAt", r."updatedAt", target_user_id
  from jsonb_populate_recordset(null::public.transactions, payload->'transactions') as r
  on conflict (id) do update set
    type = excluded.type, amount = excluded.amount, "amountTry" = excluded."amountTry", currency = excluded.currency,
    date = excluded.date, "accountId" = excluded."accountId", "toAccountId" = excluded."toAccountId",
    "categoryId" = excluded."categoryId", icon = excluded.icon, description = excluded.description,
    notes = excluded.notes, tags = excluded.tags, merchant = excluded.merchant,
    "familyMemberId" = excluded."familyMemberId", "recipientId" = excluded."recipientId",
    "isInstallment" = excluded."isInstallment", "installTotal" = excluded."installTotal",
    "installIndex" = excluded."installIndex", "installGroupId" = excluded."installGroupId",
    "debtId" = excluded."debtId", "refundOfId" = excluded."refundOfId", "systemKind" = excluded."systemKind",
    "createdAt" = excluded."createdAt", "updatedAt" = excluded."updatedAt",
    user_id = excluded.user_id, deleted_at = null;

  insert into public.investment_transactions
    (id, type, asset, quantity, "pricePerUnit", "sourceAccountId", "targetAccountId", "linkedTransactionId", date, note, "createdAt", user_id)
  select r.id, r.type, r.asset, r.quantity, r."pricePerUnit", r."sourceAccountId", r."targetAccountId", r."linkedTransactionId", r.date, r.note, r."createdAt", target_user_id
  from jsonb_populate_recordset(null::public.investment_transactions, payload->'investmentTransactions') as r
  on conflict (id) do update set
    type = excluded.type, asset = excluded.asset, quantity = excluded.quantity,
    "pricePerUnit" = excluded."pricePerUnit", "sourceAccountId" = excluded."sourceAccountId",
    "targetAccountId" = excluded."targetAccountId", "linkedTransactionId" = excluded."linkedTransactionId",
    date = excluded.date, note = excluded.note, "createdAt" = excluded."createdAt",
    user_id = excluded.user_id, deleted_at = null;
end;
$$;

-- Allow signed-in users to call it (RLS still applies inside — security invoker).
grant execute on function public.restore_user_backup(jsonb, uuid) to authenticated;
