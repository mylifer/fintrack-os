-- ============================================================================
-- Fresh-install doğrulaması: kurulum zincirinden SONRA çalışır. Her kontrol
-- başarısızlıkta hata fırlatır (ON_ERROR_STOP ile betik kırmızı biter).
-- ============================================================================
\set ON_ERROR_STOP 1

-- 1. Her public tablo: RLS açık, giriş yapmış kullanıcı erişebiliyor, girişsiz
--    (anon) hiçbir şey yapamıyor. İzni unutulmuş yeni tablo burada yakalanır.
do $$
declare r record;
begin
  for r in
    select c.oid, c.relname, c.relrowsecurity
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    if not r.relrowsecurity then
      raise exception 'RLS kapalı: public.%', r.relname;
    end if;
    if not has_table_privilege('authenticated', r.oid, 'insert') then
      raise exception 'authenticated rolünün izni yok (GRANT eksik): public.%', r.relname;
    end if;
    -- error_logs bilerek yalnız ekleme alır; diğerleri okunabilmeli
    if r.relname <> 'error_logs' and not has_table_privilege('authenticated', r.oid, 'select') then
      raise exception 'authenticated okuyamıyor (GRANT eksik): public.%', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'select') or has_table_privilege('anon', r.oid, 'insert') then
      raise exception 'anon (girişsiz) erişebiliyor: public.%', r.relname;
    end if;
  end loop;
end $$;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'sahip@test'),
  ('22222222-2222-2222-2222-222222222222', 'es@test');

-- 2. Sahip: uygulamanın sync upsert'i (tam satır, camelCase sütunlar), hata
--    kaydı ve davet oluşturma
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"email":"sahip@test","aal":"aal1"}', true);
insert into workspaces (id, user_id, name, "isDefault", "createdAt", "updatedAt")
  values ('ws-genel', auth.uid(), 'Genel', true, '2026-01-01', '2026-01-01T00:00:00.000Z'),
         ('ws-aile',  auth.uid(), 'Aile',  false, '2026-01-01', '2026-01-01T00:00:00.000Z');
insert into accounts (id, user_id, name, type, currency, "initialBalance", color, "isArchived", "createdAt", "updatedAt", "workspaceId")
  values ('a1', auth.uid(), 'Banka', 'checking', 'TRY', 1000, '#000', false, '2026-01-01', '2026-01-01T00:00:00.000Z', 'ws-aile')
  on conflict (id) do update set name = excluded.name;
insert into transactions (id, user_id, type, amount, "amountTry", currency, date, "accountId", description,
                          "isInstallment", "createdAt", "updatedAt", "workspaceId", "categorySplits", tags, "approvalStatus")
  values ('t1', auth.uid(), 'expense', -50, -50, 'TRY', '2026-10-01', 'a1', 'İade', false, '2026-10-01',
          '2026-10-01T00:00:00.000Z', 'ws-aile', '[{"categoryId":"c","amount":-50}]', '["x"]', 'approved');
insert into error_logs (kind, message, path, user_agent, release) values ('error', 'test', '/x', 'ua', 'local');
select public.create_workspace_invite('ws-aile') as token \gset
commit;

-- 3. Eş: katılmadan önce hiçbir şey görmez; davetle katılınca görür, düzenler
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"email":"es@test","aal":"aal1"}', true);
do $$ begin
  if (select count(*) from transactions) <> 0 then raise exception 'eş katılmadan sahibin verisini görüyor'; end if;
end $$;
select public.accept_workspace_invite(:'token');
do $$ begin
  if (select count(*) from transactions) <> 1 then raise exception 'eş katıldıktan sonra paylaşılan veriyi görmüyor'; end if;
end $$;
update transactions set description = 'eş düzenledi' where id = 't1';
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "workspaceId")
  values ('t2', auth.uid(), 'expense', 10, 'TRY', '2026-10-03', 'a1', 'eşin harcaması', false, '2026-10-03', 'ws-aile');
commit;

-- Paylaşılan alanın satırları sahibinde kalır (set_workspace_owner)
do $$ begin
  if exists (select 1 from transactions where user_id <> '11111111-1111-1111-1111-111111111111') then
    raise exception 'paylaşılan alandaki satırın sahipliği eşe geçti';
  end if;
end $$;

-- 4. Yedekten geri yükleme RPC'si (security invoker — kullanıcının izniyle)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select public.restore_user_backup(jsonb_build_object(
  'workspaces', jsonb_build_array(jsonb_build_object('id', 'ws-genel', 'name', 'Genel', 'isDefault', true, 'createdAt', '2026-01-01')),
  'accounts', jsonb_build_array(jsonb_build_object('id', 'a9', 'name', 'Yedek', 'type', 'cash', 'currency', 'TRY',
                                                   'initialBalance', 5, 'color', '#fff', 'createdAt', '2026-01-01', 'workspaceId', 'ws-genel')),
  'transactions', '[]'::jsonb, 'categories', '[]'::jsonb, 'budgets', '[]'::jsonb, 'debts', '[]'::jsonb,
  'investmentTransactions', '[]'::jsonb, 'people', '[]'::jsonb, 'recurringTransactions', '[]'::jsonb),
  '11111111-1111-1111-1111-111111111111');
do $$ begin
  if (select string_agg(id, ',') from accounts where deleted_at is null) is distinct from 'a9' then
    raise exception 'geri yükleme hesapları doğru değiştirmedi';
  end if;
  if (select string_agg(id, ',') from workspaces where deleted_at is null) is distinct from 'ws-genel' then
    raise exception 'geri yükleme çalışma alanlarını doğru değiştirmedi';
  end if;
end $$;
commit;

-- 5. Yarım kalan ekstre taslakları kişiseldir (0024)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
insert into statement_drafts (id, "workspaceId", data, "updatedAt")
  values ('d1', 'ws-aile', '{"fileName":"x.pdf"}', '2026-11-14T00:00:00.000Z')
  on conflict (user_id, id) do update set data = excluded.data, "updatedAt" = excluded."updatedAt";
update statement_drafts set data = null, deleted_at = now() where id = 'd1';
do $$ begin
  if (select count(*) from statement_drafts where id = 'd1' and deleted_at is not null) <> 1 then
    raise exception 'taslak sahibi kendi taslağını yazıp silemiyor';
  end if;
end $$;
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin
  if (select count(*) from statement_drafts) <> 0 then raise exception 'başkasının taslağı görünüyor (paylaşılan alanda bile)'; end if;
end $$;
update statement_drafts set data = '{}' where id = 'd1';
-- Aynı ekstre id'si başka kullanıcıda ayrı satırdır (birincil anahtar user_id + id)
insert into statement_drafts (id, data) values ('d1', '{"fileName":"y.pdf"}');
commit;
do $$ begin
  if (select count(*) from statement_drafts where id = 'd1') <> 2 then raise exception 'taslak kimliği kullanıcılar arasında çakışıyor'; end if;
  if (select data from statement_drafts where id = 'd1' and user_id = '11111111-1111-1111-1111-111111111111') is not null then
    raise exception 'başka kullanıcı taslağı değiştirebildi';
  end if;
end $$;

-- 6. İşlem kuralları (0025): paylaşılan alanda üye görür/düzenler, sahiplik
--    alan sahibinde kalır, eski damgalı yazma yeniyi ezemez
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"email":"sahip@test","aal":"aal1"}', true);
insert into transaction_rules (id, user_id, pattern, "matchKind", "accountId", "minAmount", "maxAmount",
                               "categoryId", tags, "recipientId", "sortOrder", "isActive", "createdAt", "updatedAt", "workspaceId")
  values ('r1', auth.uid(), 'migros', 'contains', 'a1', null, 500, null, '["market"]', null, 1, true,
          '2026-11-14T00:00:00.000Z', '2026-11-14T10:00:00.000Z', 'ws-aile')
  on conflict (id) do update set pattern = excluded.pattern;
insert into transaction_rules (id, user_id, pattern, "matchKind", "sortOrder", "isActive", "createdAt", "updatedAt")
  values ('r-ozel', auth.uid(), 'kira', 'equals', 2, true, '2026-11-14', '2026-11-14T10:00:00.000Z');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"email":"es@test","aal":"aal1"}', true);
do $$ begin
  if (select string_agg(id, ',') from transaction_rules) is distinct from 'r1' then
    raise exception 'eş paylaşılan kuralı görmüyor ya da kişisel alandaki kuralı görüyor';
  end if;
end $$;
update transaction_rules set pattern = 'eski', "updatedAt" = '2026-11-14T09:00:00.000Z' where id = 'r1';
update transaction_rules set "isActive" = false, "updatedAt" = '2026-11-14T11:00:00.000Z' where id = 'r1';
commit;
do $$ begin
  if (select pattern from transaction_rules where id = 'r1') <> 'migros' then
    raise exception 'eski damgalı kural yazması yeniyi ezdi (keep_newer_row)';
  end if;
  if (select "isActive" from transaction_rules where id = 'r1') then
    raise exception 'eşin yeni kural düzenlemesi yazılmadı';
  end if;
  if exists (select 1 from transaction_rules where user_id <> '11111111-1111-1111-1111-111111111111') then
    raise exception 'paylaşılan alandaki kuralın sahipliği eşe geçti';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transaction_rules') then
    raise exception 'transaction_rules Realtime yayınında değil';
  end if;
  if (select relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'transaction_rules') is not true then
    raise exception 'transaction_rules FORCE RLS değil';
  end if;
  if position('transaction_rules' in pg_get_functiondef('public.create_workspace_invite(text)'::regprocedure)) = 0 then
    raise exception 'create_workspace_invite transaction_rules temizliğini kapsamıyor (0021 sonrası 0025 yeniden çalıştırılmalı)';
  end if;
end $$;

-- 7. Girişsiz erişim reddedilir
begin;
set local role anon;
do $$ begin
  perform count(*) from accounts;
  raise exception 'anon accounts tablosunu okuyabildi';
exception when insufficient_privilege then null;
end $$;
rollback;

