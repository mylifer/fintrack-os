-- ============================================================================
-- 0021 — Çalışma alanı paylaşımı (aile üyesi kendi hesabıyla ortak alanda)
--
-- MODEL
--   • workspace_members: alanın üyeleri. Paylaşım başlayınca sahibi de
--     role='owner' satırıyla eklenir; davetle katılanlar role='editor'.
--     Üyelik YALNIZ RPC'lerle eklenir (tabloya insert politikası yok).
--   • workspace_invites: tek kullanımlık davet. Tokenın kendisi saklanmaz,
--     sha256 özeti saklanır; düz token yalnız bir kez (oluşturulurken) döner.
--     7 gün geçerli.
--   • Varsayılan ("Genel") alan paylaşılamaz: eski satırlarda workspaceId yok,
--     RLS onları alana bağlayamaz. Aile için ayrı alan açılır.
--
-- SAHİPLİK
--   Paylaşılan alandaki HER satırın user_id'si alan SAHİBİDİR — üye eklese
--   de düzenlese de (set_workspace_owner tetikleyicisi). Böylece üye hesabını
--   silerse (delete_my_account user_id ile siler) ailenin verisi gitmez; üye
--   alandan çıkınca kendi user_id'siyle kalmış satır üzerinden görmeye devam
--   edemez.
--
-- ERİŞİM (12 veri tablosu)
--   görme/yazma: user_id = ben  VEYA  satırın alanı üyesi olduğum alanlardan
--   Tanımlayıcı fonksiyonlar yalnız workspace_members'ı okur; o tabloda RLS
--   ZORLANMADIĞI için fonksiyon sahibi (migration'ı çalıştıran) politikaya
--   takılmadan gerçek üyeliği görür — workspaces'teki FORCE RLS'ten bağımsız.
--
-- 2FA: 0013 ile aynı — yeni tablolara RESTRICTIVE aal2 politikası, RPC'ler
--   mfa_satisfied() ister.
--
-- Kod yayına çıkmadan ÖNCE çalıştırılmalı. Idempotent.
-- ============================================================================

-- ── 1. Tablolar ─────────────────────────────────────────────────────────────

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'editor')),
  email        text check (length(email) <= 320),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create unique index if not exists workspace_members_one_owner
  on public.workspace_members (workspace_id) where role = 'owner';

create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  token_hash   text not null unique,
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz
);

alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;

-- ── 2. Yardımcı fonksiyonlar (yalnız workspace_members okur) ────────────────

-- Üyesi olduğum (sahibi ya da editörü) alanlar
create or replace function public.my_workspace_ids()
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid()
$$;

-- Paylaşılan bir alanın sahibi (paylaşılmamış alan için null)
create or replace function public.workspace_owner(ws text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select user_id from public.workspace_members where workspace_id = ws and role = 'owner'
$$;

revoke all on function public.my_workspace_ids() from public, anon;
revoke all on function public.workspace_owner(text) from public, anon;
grant execute on function public.my_workspace_ids() to authenticated;
grant execute on function public.workspace_owner(text) to authenticated;

-- ── 3. Sahiplik tetikleyicisi ───────────────────────────────────────────────

create or replace function public.set_workspace_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  if new."workspaceId" is not null then
    owner := public.workspace_owner(new."workspaceId");
    if owner is not null then
      new.user_id := owner;
      return new;
    end if;
  end if;
  -- Paylaşılmamış alan: sahiplik güncellemeyle el değiştirmez
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.set_workspace_owner() from public, anon, authenticated;

-- ── 4. Veri tablolarının politikaları ───────────────────────────────────────

do $$
declare
  t text;
  pol text;
  data_tables text[] := array[
    'accounts', 'transactions', 'categories', 'budgets', 'debts',
    'investment_transactions', 'people', 'recurring_transactions',
    'payment_plans', 'payment_occurrences', 'savings_goals'
  ];
begin
  foreach t in array data_tables loop
    execute format('drop trigger if exists set_workspace_owner on public.%I;', t);
    execute format(
      'create trigger set_workspace_owner before insert or update on public.%I '
      'for each row execute function public.set_workspace_owner();', t);
  end loop;

  foreach t in array data_tables || array['workspaces'] loop
    -- Eski sahip-yalnız politikalar (supabase_schema.sql / 0015) ve bu
    -- migration'ın önceki çalıştırması
    foreach pol in array array['_select_own', '_insert_own', '_update_own', '_delete_own',
                               '_select', '_insert', '_update', '_delete'] loop
      execute format('drop policy if exists %I on public.%I;', t || pol, t);
    end loop;
  end loop;

  foreach t in array data_tables loop
    execute format(
      'create policy %I on public.%I for select to authenticated using '
      '(user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check '
      '(user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids())) '
      'with check (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using '
      '(user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));',
      t || '_delete', t);
  end loop;
end $$;

-- workspaces: üye görür; yalnız sahip oluşturur/düzenler/siler
create policy workspaces_select on public.workspaces for select to authenticated
  using (user_id = (select auth.uid()) or id in (select public.my_workspace_ids()));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 5. Üyelik ve davet politikaları ─────────────────────────────────────────

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (workspace_id in (select public.my_workspace_ids()));

-- Üye ayrılabilir; sahip üyeyi çıkarabilir. Sahip satırı silinmez.
drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid())
                              or public.workspace_owner(workspace_id) = (select auth.uid())));

-- Sahip satırı ve davet YALNIZ kendi, varsayılan olmayan, silinmemiş alanım
-- için eklenebilir (create_workspace_invite çağıranın yetkisiyle çalışır —
-- bkz. §6). Alt sorgu workspaces'i çağıranın RLS'iyle okur.
drop policy if exists workspace_members_insert_owner on public.workspace_members;
create policy workspace_members_insert_owner on public.workspace_members for insert to authenticated
  with check (role = 'owner' and user_id = (select auth.uid()) and exists (
    select 1 from public.workspaces w
     where w.id = workspace_id and w.user_id = (select auth.uid())
       and w.deleted_at is null and not coalesce(w."isDefault", false)));

drop policy if exists workspace_invites_insert on public.workspace_invites;
create policy workspace_invites_insert on public.workspace_invites for insert to authenticated
  with check (created_by = (select auth.uid())
              and accepted_by is null and accepted_at is null
              and expires_at <= now() + interval '8 days'
              and public.workspace_owner(workspace_id) = (select auth.uid()));

drop policy if exists workspace_invites_select on public.workspace_invites;
create policy workspace_invites_select on public.workspace_invites for select to authenticated
  using (created_by = (select auth.uid()));
drop policy if exists workspace_invites_delete on public.workspace_invites;
create policy workspace_invites_delete on public.workspace_invites for delete to authenticated
  using (created_by = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['workspace_members', 'workspace_invites'] loop
    execute format('drop policy if exists %I on public.%I;', t || '_mfa_required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));',
      t || '_mfa_required', t);
  end loop;
end $$;

-- ── 6. RPC'ler ──────────────────────────────────────────────────────────────

-- İki RPC de tanımlayıcı fonksiyonun RLS ATLAMA yetkisine (BYPASSRLS)
-- DAYANMAZ: FORCE RLS'li tablolarda (workspaces, veri tabloları) politikalar
-- yalnız `authenticated` rolüne tanımlı olduğundan, bu yetki olmadan fonksiyon
-- sahibi o tablolarda hiçbir satır göremez.
--   • create_workspace_invite ÇAĞIRANIN yetkisiyle (invoker) çalışır: alanı
--     kendi RLS'iyle okur, sahip satırını/daveti §5'teki ekleme politikaları
--     üzerinden yazar.
--   • accept_workspace_invite tanımlayıcıdır (davetli henüz hiçbir şeye
--     erişemez) ama YALNIZ RLS'i zorlanmayan workspace_invites /
--     workspace_members tablolarına dokunur; alan adını istemci üye olduktan
--     sonra normal sorguyla okur.

-- Davet bağlantısı oluşturur; düz tokenı YALNIZ burada döner.
create or replace function public.create_workspace_invite(p_workspace text)
returns text
language plpgsql security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ws_default boolean;
  token text;
  t text;
begin
  if uid is null or not public.mfa_satisfied() then
    raise exception 'yetki yok' using errcode = '42501';
  end if;
  select "isDefault" into ws_default from public.workspaces
   where id = p_workspace and user_id = uid and deleted_at is null;
  if not found then
    raise exception 'alan bulunamadı' using errcode = '42501';
  end if;
  if coalesce(ws_default, false) then
    raise exception 'varsayılan alan paylaşılamaz' using errcode = '22023';
  end if;

  -- İlk paylaşım: sahip satırı. Alanın sahibine ait OLMAYAN satırlar bu
  -- noktada meşru olamaz (alan paylaşılmamıştı) — başka hesabın, alanın
  -- kimliğini bilerek önceden yerleştirdiği satır üyelere görünmesin diye silinir.
  if public.workspace_owner(p_workspace) is null then
    insert into public.workspace_members (workspace_id, user_id, role, email)
    values (p_workspace, uid, 'owner', auth.jwt() ->> 'email');
    foreach t in array array[
      'accounts', 'transactions', 'categories', 'budgets', 'debts',
      'investment_transactions', 'people', 'recurring_transactions',
      'payment_plans', 'payment_occurrences', 'savings_goals'
    ] loop
      execute format('delete from public.%I where "workspaceId" = $1 and user_id <> $2', t)
        using p_workspace, uid;
    end loop;
  end if;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites (workspace_id, token_hash, created_by)
  values (p_workspace, encode(sha256(convert_to(token, 'UTF8')), 'hex'), uid);
  return token;
end;
$$;

-- Daveti kabul eder: üye olunur, alan kimliği döner.
drop function if exists public.accept_workspace_invite(text);
create or replace function public.accept_workspace_invite(p_token text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.workspace_invites%rowtype;
begin
  if uid is null or not public.mfa_satisfied() then
    raise exception 'yetki yok' using errcode = '42501';
  end if;
  select * into inv from public.workspace_invites
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'davet geçersiz ya da süresi dolmuş' using errcode = '22023';
  end if;
  if public.workspace_owner(inv.workspace_id) = uid then
    raise exception 'kendi alanınıza katılamazsınız' using errcode = '22023';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, email)
  values (inv.workspace_id, uid, 'editor', auth.jwt() ->> 'email')
  on conflict on constraint workspace_members_pkey do nothing;
  update public.workspace_invites set accepted_by = uid, accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke all on function public.create_workspace_invite(text) from public, anon;
revoke all on function public.accept_workspace_invite(text) from public, anon;
grant execute on function public.create_workspace_invite(text) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;

grant select, insert, delete on public.workspace_members to authenticated;
grant select, insert, delete on public.workspace_invites to authenticated;

-- ============================================================================
-- DOĞRULAMA
--   select tablename, policyname, permissive, cmd from pg_policies
--    where schemaname = 'public' and policyname ~ '_(select|insert|update|delete)$'
--    order by 1, 2;                     → 12 tablo × 4 + members/invites
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'set_workspace_owner';   → 11 satır
-- GERİ ALMA (acil): 0021 öncesi sahip-yalnız politikalara dönmek için
--   supabase_schema.sql'in RLS bloğunu ve 0015'in politika bloğunu yeniden
--   çalıştırın, ardından 0013'ü (MFA) — paylaşılan alanlar erişilmez olur.
-- ============================================================================
