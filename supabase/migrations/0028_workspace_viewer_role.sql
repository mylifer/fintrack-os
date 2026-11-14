-- ============================================================================
-- 0028 — Paylaşımda salt okuma ("viewer") rolü
--
-- MODEL (0021'in üzerine)
--   • workspace_members.role: 'owner' | 'editor' | 'viewer'.
--   • Davet oluşturulurken rol seçilir (editör / salt okuma); kabul edilen
--     üyelik davetteki rolü alır. Rol workspace_invites.role'da tutulur.
--   • Sahip, üyenin rolünü sonradan değiştirebilir (set_workspace_member_role).
--
-- ASIL KİLİT SUNUCUDA
--   Paylaşılan her veri tablosuna (set_workspace_owner tetikleyicisi olan her
--   public tablo — 0021'in 11 tablosu + 0025'in transaction_rules'u + ileride
--   eklenecekler) üç RESTRICTIVE politika eklenir: INSERT / UPDATE / DELETE,
--   satırın alanında salt okuma üyesiysem reddedilir. SELECT'e dokunulmaz
--   (0021'in "üyesi olduğum alan" politikası okumayı zaten verir).
--   RESTRICTIVE seçilmesinin nedeni: 0021 / 0025 yeniden çalıştırılırsa kendi
--   PERMISSIVE politikalarını (t_select/_insert/_update/_delete) baştan yazar;
--   bu politikalar ayrı adlı oldukları için 0021'den etkilenmez. 0025 ise
--   transaction_rules'taki TÜM politikaları siler — ama hemen ardından
--   set_workspace_owner tetikleyicisini yeniden kurar; aşağıdaki olay
--   tetikleyicisi (CREATE TRIGGER) eksik salt okuma politikasını o anda geri
--   ekler. Yeni tablolar da set_workspace_owner kurulduğu anda kapsanır.
--
--   İstemcinin itişi upsert'tür (ON CONFLICT DO UPDATE): mevcut satırda UPDATE
--   USING ihlali sessiz 0 satır değil HATA (42501) verir — salt okuma üyesinin
--   kuyrukta kalmış bir yazması "başarılı" sanılmaz.
--
-- DAVET FONKSİYONU
--   create_workspace_invite(p_workspace, p_role) YENİ iki argümanlı sürüm. Tek
--   argümanlı (0021/0025) sürüm bu ikisine 'editor' ile devreden bir sarmalayıcı
--   olarak yeniden yazılır — eski istemciler bozulmaz. İlk paylaşımdaki yabancı
--   satır temizliği artık SABİT LİSTE DEĞİL: set_workspace_owner taşıyan her
--   tablo (0025'in eklediği transaction_rules kaybolmaz, yenileri de kapsanır).
--
-- 0021 YENİDEN ÇALIŞTIRILIRSA
--   0021'in accept_workspace_invite'ı her üyeyi 'editor' ekler. Bu yüzden rol
--   ayrıca workspace_invites üzerindeki bir tetikleyiciyle (davet kabul
--   edildiği anda) davetin rolüne çekilir — salt okuma daveti, fonksiyon eski
--   sürüme dönse bile editörlüğe dönüşmez.
--
-- 2FA: yeni RPC'ler mfa_satisfied() ister (0013/0021 ile aynı).
-- ÖN KOŞUL: 0013, 0021, 0025 (tablo varsa kapsanır, yoksa da çalışır).
-- Kod yayına çıkmadan ÖNCE çalıştırılmalı. Idempotent. Veriye dokunmaz.
-- ============================================================================

-- ── 1. Rol kısıtları ─────────────────────────────────────────────────────────

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'editor', 'viewer'));

alter table public.workspace_invites add column if not exists role text not null default 'editor';
alter table public.workspace_invites drop constraint if exists workspace_invites_role_check;
alter table public.workspace_invites add constraint workspace_invites_role_check
  check (role in ('editor', 'viewer'));

-- ── 2. Yardımcı: salt okuma üyesi olduğum alanlar ───────────────────────────
-- my_workspace_ids (0021) gibi yalnız workspace_members okur (RLS zorlanmaz).
create or replace function public.my_readonly_workspace_ids()
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select workspace_id from public.workspace_members
   where user_id = auth.uid() and role = 'viewer'
$$;

revoke all on function public.my_readonly_workspace_ids() from public, anon;
grant execute on function public.my_readonly_workspace_ids() to authenticated;

-- ── 3. Veri tablolarında salt okuma kilidi (RESTRICTIVE) ────────────────────
-- coalesce: "workspaceId" null (eski, kişisel satır) → NOT IN null verir;
-- o satırlar hiçbir paylaşılan alana ait değildir, kilitlenmez.
create or replace function public.ensure_workspace_viewer_policies()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n integer := 0;
  cond constant text :=
    'coalesce("workspaceId" not in (select public.my_readonly_workspace_ids()), true)';
begin
  for t in
    select distinct c.relname
      from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and g.tgname = 'set_workspace_owner' and not g.tgisinternal
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || '_viewer_no_insert') then
      execute format('create policy %I on public.%I as restrictive for insert to authenticated '
                     'with check (%s);', t || '_viewer_no_insert', t, cond);
      n := n + 1;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || '_viewer_no_update') then
      execute format('create policy %I on public.%I as restrictive for update to authenticated '
                     'using (%s) with check (%s);', t || '_viewer_no_update', t, cond, cond);
      n := n + 1;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = t || '_viewer_no_delete') then
      execute format('create policy %I on public.%I as restrictive for delete to authenticated '
                     'using (%s);', t || '_viewer_no_delete', t, cond);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.ensure_workspace_viewer_policies() from public, anon, authenticated;

select public.ensure_workspace_viewer_policies();

-- set_workspace_owner bir tabloya kurulduğunda (yeni tablo ya da 0021/0025'in
-- yeniden çalıştırılması) eksik salt okuma politikası kendiliğinden gelir.
-- Kendi CREATE POLICY'leri bu etikete girmediği için özyineleme yok.
create or replace function public.workspace_viewer_policies_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- schema_name tetikleyicilerde NULL döner (tetikleyici şemaya değil tabloya
  -- bağlıdır); kapsamı ensure_* zaten public + set_workspace_owner'la sınırlar.
  if exists (select 1 from pg_event_trigger_ddl_commands()
              where command_tag = 'CREATE TRIGGER') then
    begin
      perform public.ensure_workspace_viewer_policies();
    exception when others then
      raise warning 'salt okuma politikaları kurulamadı (%) — public tablolarını elle kontrol edin', sqlerrm;
    end;
  end if;
end;
$$;

revoke all on function public.workspace_viewer_policies_ddl() from public, anon, authenticated;

drop event trigger if exists ensure_workspace_viewer_policies;
create event trigger ensure_workspace_viewer_policies
  on ddl_command_end
  when tag in ('CREATE TRIGGER')
  execute function public.workspace_viewer_policies_ddl();

-- ── 4. Davet: rol seçimi ────────────────────────────────────────────────────
-- 0021/0025 gövdesinin aynısı; farklar: p_role ve türetilen temizlik listesi.
create or replace function public.create_workspace_invite(p_workspace text, p_role text)
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
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'geçersiz rol' using errcode = '22023';
  end if;
  select "isDefault" into ws_default from public.workspaces
   where id = p_workspace and user_id = uid and deleted_at is null;
  if not found then
    raise exception 'alan bulunamadı' using errcode = '42501';
  end if;
  if coalesce(ws_default, false) then
    raise exception 'varsayılan alan paylaşılamaz' using errcode = '22023';
  end if;

  -- İlk paylaşım: sahip satırı + başka hesabın alana önceden yerleştirdiği
  -- satırların temizliği (0021 gerekçesi). Kapsam: paylaşılan HER tablo.
  if public.workspace_owner(p_workspace) is null then
    insert into public.workspace_members (workspace_id, user_id, role, email)
    values (p_workspace, uid, 'owner', auth.jwt() ->> 'email');
    for t in
      select distinct c.relname
        from pg_catalog.pg_trigger g
        join pg_catalog.pg_class c on c.oid = g.tgrelid
        join pg_catalog.pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and g.tgname = 'set_workspace_owner' and not g.tgisinternal
    loop
      execute format('delete from public.%I where "workspaceId" = $1 and user_id <> $2', t)
        using p_workspace, uid;
    end loop;
  end if;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites (workspace_id, token_hash, created_by, role)
  values (p_workspace, encode(sha256(convert_to(token, 'UTF8')), 'hex'), uid, p_role);
  return token;
end;
$$;

-- Eski istemciler (tek argüman) editör daveti üretmeye devam eder
create or replace function public.create_workspace_invite(p_workspace text)
returns text
language sql security invoker
set search_path = ''
as $$
  select public.create_workspace_invite(p_workspace, 'editor')
$$;

revoke all on function public.create_workspace_invite(text, text) from public, anon;
revoke all on function public.create_workspace_invite(text) from public, anon;
grant execute on function public.create_workspace_invite(text, text) to authenticated;
grant execute on function public.create_workspace_invite(text) to authenticated;

-- Daveti kabul eder: üyelik davetteki rolle açılır. Zaten üyeyse (ör. editör
-- yeni bir salt okuma davetini açtı) rol davetinkine çekilir — davet sahibin
-- güncel kararıdır. Sahip kendi alanına katılamaz (değişmedi).
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
  values (inv.workspace_id, uid, coalesce(inv.role, 'editor'), auth.jwt() ->> 'email')
  on conflict on constraint workspace_members_pkey
    do update set role = excluded.role where public.workspace_members.role <> 'owner';
  update public.workspace_invites set accepted_by = uid, accepted_at = now() where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invite(text) from public, anon;
grant execute on function public.accept_workspace_invite(text) to authenticated;

-- Emniyet: davet kabul edildiği anda üyelik davetin rolüne çekilir. 0021
-- yeniden çalıştırılıp accept_workspace_invite her üyeyi 'editor' eklese bile
-- salt okuma daveti salt okuma kalır.
create or replace function public.apply_invite_role()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.accepted_by is not null and old.accepted_by is null then
    update public.workspace_members
       set role = coalesce(new.role, 'editor')
     where workspace_id = new.workspace_id and user_id = new.accepted_by
       and role <> 'owner' and role is distinct from coalesce(new.role, 'editor');
  end if;
  return new;
end;
$$;

revoke all on function public.apply_invite_role() from public, anon, authenticated;

drop trigger if exists apply_invite_role on public.workspace_invites;
create trigger apply_invite_role after update of accepted_by on public.workspace_invites
  for each row execute function public.apply_invite_role();

-- ── 5. Sahip üyenin rolünü değiştirir ───────────────────────────────────────
-- Tanımlayıcı: workspace_members'a güncelleme politikası/yetkisi bilerek
-- açılmaz; tek yol bu RPC. Yalnız alanın sahibi, yalnız editör↔salt okuma.
create or replace function public.set_workspace_member_role(p_workspace text, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.mfa_satisfied() then
    raise exception 'yetki yok' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'geçersiz rol' using errcode = '22023';
  end if;
  if public.workspace_owner(p_workspace) is distinct from uid then
    raise exception 'yetki yok' using errcode = '42501';
  end if;
  update public.workspace_members set role = p_role
   where workspace_id = p_workspace and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'üye bulunamadı' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_workspace_member_role(text, uuid, text) from public, anon;
grant execute on function public.set_workspace_member_role(text, uuid, text) to authenticated;

-- ============================================================================
-- DOĞRULAMA
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' and policyname like '%\_viewer\_no\_%' order by 1, 2;
--     → set_workspace_owner taşıyan her tablo × 3 (insert/update/delete)
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'workspace_members_role_check';
-- GERİ ALMA (acil): salt okuma üyelerini editöre çevirip politikaları silin:
--   update workspace_members set role = 'editor' where role = 'viewer';
--   ve her tablo için drop policy <t>_viewer_no_insert/_update/_delete.
-- ============================================================================
