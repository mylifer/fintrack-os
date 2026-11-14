-- ============================================================================
-- 0026 — Çalışma alanı taşıması sahipliği değiştiremez
--
-- SORUN (supabase/fresh-install/sync-rules.sql, #R1)
--   0021'in politikaları bir UPDATE'te yalnız "yeni satırın alanına yazabilir
--   miyim" diye bakar; set_workspace_owner da user_id'yi YENİ alanın sahibine
--   çevirir. İki paylaşılan alanın editörü (A'nın "Aile"si ve C'nin "Ortak"ı)
--   A'nın satırının "workspaceId"'sini C'nin alanına çevirdiğinde satır
--   sessizce C'nin hesabına geçer: A onu bir daha göremez, C'nin hesabı
--   silinirse satır da gider.
--
-- KURAL (en az müdahale)
--   Bir UPDATE "workspaceId"'yi değiştiriyorsa, satırın SON user_id'si (bu
--   tetikleyici set_workspace_owner'dan SONRA çalışır) eskisiyle aynı olmalı.
--   Yani taşıma serbest, ama satırı başka bir hesaba devretmek yasak.
--     • Sahip kendi alanları arasında (paylaşılan ya da değil) taşıyabilir.
--     • Aynı sahibin iki paylaşılan alanı arasında editör de taşıyabilir.
--     • Başka sahibin alanına taşıma reddedilir (42501).
--   INSERT'e dokunulmaz: editörün paylaşılan alana yeni satır eklemesi
--   (sahiplik alan sahibine geçer) 0021'in meşru akışıdır.
--
-- İSTEMCİ ETKİSİ: uygulamada mevcut bir satırı başka alana taşıyan akış yok —
--   alanlar arası transfer/borç ödemesi her alana YENİ satır yazar
--   (src/store/transactions.store.ts → addCrossWorkspaceTransfer). Eski
--   (workspaceId'siz) satırın ilk damgalanması null → kendi alanı olduğundan
--   sahiplik değişmez. restore_user_backup user_id'yi çağırana zorlar;
--   kendi alanlarına geri yüklemede sahiplik değişmez.
--
-- Tetikleyici adı bilinçli: aynı olaydaki BEFORE tetikleyicileri ada göre
-- sırayla çalışır — keep_newer_row < set_workspace_owner < workspace_move_guard.
-- keep_newer_row eski yazmayı OLD döndürerek yok saydıysa alan değişmemiştir.
--
-- Idempotent: tekrar çalıştırmak güvenlidir. Veriye dokunmaz.
-- ============================================================================

create or replace function public.workspace_move_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new."workspaceId" is distinct from old."workspaceId"
     and new.user_id is distinct from old.user_id then
    raise exception 'çalışma alanı taşıması satırın sahipliğini değiştiremez (%: % → %)',
      tg_table_name, old."workspaceId", new."workspaceId"
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.workspace_move_guard() from public, anon, authenticated;

-- Kapsam SABİT LİSTE DEĞİL, türetilir: public şemasında hem "workspaceId"
-- hem user_id sütunu olan HER tablo (0009'daki information_schema kalıbı).
-- Böylece 0025'teki transaction_rules ve gelecekteki tablolar da kapsanır.
-- Sahipliği hiç değişmeyen tabloda (ör. statement_drafts — set_workspace_owner
-- yok) tetikleyici zararsızdır: user_id değişmez, koşul hiç tutmaz.
create or replace function public.ensure_workspace_move_guards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n integer := 0;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'workspaceId'
       and exists (select 1 from information_schema.columns u
                    where u.table_schema = 'public' and u.table_name = c.table_name and u.column_name = 'user_id')
       and not exists (select 1 from pg_trigger g
                        where g.tgrelid = format('public.%I', c.table_name)::regclass
                          and g.tgname = 'workspace_move_guard' and not g.tgisinternal)
  loop
    execute format(
      'create trigger workspace_move_guard before update on public.%I '
      'for each row execute function public.workspace_move_guard();', t);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.ensure_workspace_move_guards() from public, anon, authenticated;

-- Mevcut tablolar (idempotent: tetikleyicisi olan atlanır)
select public.ensure_workspace_move_guards();

-- Gelecekteki tablolar: 0010'daki ensure_rls ile aynı kalıp — bir tablo
-- oluşturulduğunda ya da sütun eklendiğinde ("workspaceId" sonradan gelebilir)
-- eksik tetikleyici kendiliğinden kurulur. Kendi CREATE TRIGGER'ı bu olay
-- etiketlerine girmediği için özyineleme yok.
create or replace function public.workspace_move_guard_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from pg_event_trigger_ddl_commands()
              where command_tag in ('CREATE TABLE', 'ALTER TABLE') and schema_name = 'public') then
    begin
      perform public.ensure_workspace_move_guards();
    exception when others then
      -- DDL'i bozma; ama görünür kıl (0010'daki gerekçe)
      raise warning 'workspace_move_guard kurulamadı (%) — public tablolarını elle kontrol edin', sqlerrm;
    end;
  end if;
end;
$$;

revoke all on function public.workspace_move_guard_ddl() from public, anon, authenticated;

drop event trigger if exists ensure_workspace_move_guard;
create event trigger ensure_workspace_move_guard
  on ddl_command_end
  when tag in ('CREATE TABLE', 'ALTER TABLE')
  execute function public.workspace_move_guard_ddl();

-- ============================================================================
-- DOĞRULAMA
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'workspace_move_guard' order by 1;
--   → workspaceId + user_id taşıyan her public tablo (0026 anında 13: 11 veri
--     tablosu + statement_drafts + transaction_rules)
-- ============================================================================
