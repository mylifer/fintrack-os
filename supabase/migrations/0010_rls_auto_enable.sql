-- ============================================================================
-- 0010 — rls_auto_enable: yeni tablolara otomatik RLS (event trigger)
--
-- ⚠️  BU MIGRATION ÜRETİMDE ZATEN UYGULANMIŞ DURUMDA.
--     Fonksiyon ve trigger canlı veritabanında mevcut ama depoda hiçbir izi
--     yoktu; 2026-08-29 güvenlik denetiminde canlı katalog sorgulanınca ortaya
--     çıktı (audit/security-audit-2026-08-29.md → H11). Bu dosya var olanı
--     KAYDA GEÇİRİR — üretimde çalıştırmak idempotenttir ve hiçbir şeyi
--     değiştirmez. Asıl amacı felaket kurtarma: sıfırdan kurulan bir proje bu
--     korumayı yoksa sessizce kaybederdi.
--
-- NE İŞE YARIYOR
-- --------------
-- `public` şemasında oluşturulan HER yeni tabloya otomatik olarak
-- `enable row level security` uygular. supabase_schema.sql'deki DO bloğu
-- yalnızca BİLİNEN 9 tabloyu sertleştiriyor; Studio'dan ya da elle eklenen
-- yeni bir tablo o listeye girmezse RLS'siz kalırdı — klasik foot-gun. Bu
-- trigger ağı fail-closed yapar: politika yazılmamış bir tabloda RLS açık
-- olduğu için `authenticated` hiçbir satır göremez (deny-all), yani unutulan
-- tablo veri SIZDIRMAK yerine ERİŞİLEMEZ olur.
--
-- `force row level security` bilinçli olarak UYGULANMAZ: tablo sahibi
-- (postgres) ve service_role yönetim/yedek işleri için erişebilmeli.
-- Politika da OLUŞTURULMAZ — hangi sütunun sahiplik ekseni olduğunu trigger
-- bilemez; owner-only politikalar supabase_schema.sql'de elle yazılır.
--
-- GÜVENLİK NOTLARI (denetimde tek tek doğrulandı)
-- -----------------------------------------------
--   • `security definer` + sahibi postgres → RLS'i atlayarak çalışır, bu YÜZDEN
--     `set search_path to 'pg_catalog'` ŞART: sabitlenmemiş search_path,
--     security definer fonksiyonlarda klasik yetki yükseltme vektörüdür.
--   • Varsayılan EXECUTE yetkisi PUBLIC'tedir ama sömürülebilir değil:
--     `returns event_trigger` olan bir fonksiyon PostgreSQL tarafından doğrudan
--     çağrılamaz, ayrıca pg_event_trigger_ddl_commands() trigger bağlamı
--     dışında hata verir.
--   • `format('%s', cmd.object_identity)` — burada `%s` DOĞRU olan. object_identity
--     PostgreSQL'in ürettiği, zaten tırnaklanmış tam nitelikli addır; `%I` onu
--     ikinci kez tırnaklayıp bozardı. Değerini etkilemek tablo yaratmayı
--     gerektirir, `authenticated` ise `public` şemasında yalnızca USAGE'a sahip
--     (CREATE yok) — enjeksiyon yolu kapalı.
--
-- BİLİNEN ÖDÜNÇ
-- -------------
-- `exception when others then raise log` — RLS açma başarısız olursa tablo
-- RLS'SİZ oluşur ve yalnızca Postgres log'una yazılır; istemci hiçbir şey
-- görmez. Exception fırlatmak CREATE TABLE'ı komple bozacağı için bilinçli bir
-- tercih, ama sessizlik risklidir: bu yüzden aşağıda `raise warning`a
-- yükseltildi — DDL yine bozulmaz, ama başarısızlık SQL Editor'de görünür.
-- (Canlı fonksiyondan tek farkı budur.)
--
-- Idempotent (create or replace + drop/create trigger).
-- ============================================================================

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%'
    then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          -- Canlı sürümde bu `raise log`du: hata yalnızca sunucu log'una düşüyor,
          -- tablo RLS'siz kalıyor ve kimse fark etmiyordu. WARNING istemciye de
          -- gösterilir ve DDL'i yine bozmaz.
          raise warning 'rls_auto_enable: % üzerinde RLS AÇILAMADI (%) — tablo KORUMASIZ, elle kontrol edin',
            cmd.object_identity, sqlerrm;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  execute function public.rls_auto_enable();

-- ============================================================================
-- DOĞRULAMA
-- ============================================================================
-- 1. Trigger yerinde ve etkin mi ('O' = enabled/origin):
--      select evtname, evtevent, evtowner::regrole, evtfoid::regprocedure, evtenabled
--      from pg_event_trigger where evtname = 'ensure_rls';
--
-- 2. search_path sabit mi (["search_path=pg_catalog"] dönmeli):
--      select proconfig from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'rls_auto_enable';
--
-- 3. Canlı test (geçici tablo — sonunda düşürülür):
--      create table public._rls_probe (id int);
--      select relrowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace and relname = '_rls_probe';  -- true olmalı
--      drop table public._rls_probe;
--
-- 4. RLS'siz kalmış tablo var mı (her zaman BOŞ dönmeli):
--      select relname from pg_class
--       where relnamespace = 'public'::regnamespace and relkind = 'r'
--         and not relrowsecurity;
-- ============================================================================
