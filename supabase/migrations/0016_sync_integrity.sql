-- ============================================================================
-- 0016 — Senkron bütünlüğü: "updatedAt" her tabloda, eski yazma yeniyi ezemez,
--        canlı senkron (Realtime)
--
-- SORUN (denetim #3): istemci her yazmada satırın TAMAMINI upsert eder ve
-- sunucu gelen sırayla yazar. İki cihaz aynı kaydı düzenlerse SONRA VARAN
-- kazanır: çevrimdışı kalıp saatler sonra bağlanan cihazın eski kopyası, öteki
-- cihazdaki yeni düzenlemeyi sessizce siler.
--
-- ÇÖZÜM
--   1. Eksik 8 tabloya "updatedAt" (ISO metin — transactions/payment_*/
--      savings_goals'ta zaten var). İstemci her yerel yazmada damgalar
--      (src/lib/sync/engine.ts → stampTime).
--   2. keep_newer_row() BEFORE UPDATE tetikleyicisi: gelen satırın damgası
--      mevcut satırınkinden ESKİYSE güncelleme uygulanmaz (OLD döner, hata
--      YOK — istemci outbox girdisini siler, sonraki çekiş yeni sürümü getirir).
--      Damgalardan biri yoksa (eski satır) davranış değişmez.
--      Soft delete de bir UPDATE'tir ve damgalanır → silme ile düzenleme
--      arasında da "sonra YAPILAN kazanır".
--   3. İSTİSNA — yedekten geri yükleme: restore_user_backup (0009) adım 1'de
--      tüm satırları `deleted_at = now()` ile işaretler, adım 2'de yedekteki
--      (ESKİ damgalı) sürümleri yazar. Tetikleyici "bu satır AYNI işlemde az
--      önce işaretlendi" durumunu satırın xmin'i ile tanır ve geçirir:
--      mevcut sürümü yazan işlem şu anki işlemse — ayrı bir PostgREST isteği
--      bunu üretemez. Böylece üretimdeki RPC'ye DOKUNULMAZ.
--   4. Tablolar `supabase_realtime` yayınına eklenir: başka cihazdaki değişiklik
--      sayfa yenilenmeden gelir (src/lib/sync/realtime.ts). RLS Realtime'da da
--      geçerlidir — kullanıcı yalnız kendi satırlarının olayını alır.
--
-- DEPLOY SIRASI: istemciden önce ya da sonra çalıştırılabilir. İstemci
-- "updatedAt" sütunu olmayan tabloda alanı atıp yeniden gönderir (PGRST204
-- geri dönüşü), yani sıra hataya yol açmaz; koruma ancak bu dosya çalışınca
-- devreye girer.
--
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- ── 1. "updatedAt" sütunları ────────────────────────────────────────────────
alter table public.accounts               add column if not exists "updatedAt" text;
alter table public.categories             add column if not exists "updatedAt" text;
alter table public.budgets                add column if not exists "updatedAt" text;
alter table public.debts                  add column if not exists "updatedAt" text;
alter table public.investment_transactions add column if not exists "updatedAt" text;
alter table public.people                 add column if not exists "updatedAt" text;
alter table public.recurring_transactions add column if not exists "updatedAt" text;
alter table public.workspaces             add column if not exists "updatedAt" text;

-- ── 2–3. Eski yazma yeni satırı ezemez ──────────────────────────────────────
create or replace function public.keep_newer_row()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  same_tx boolean;
begin
  -- Yedekten geri yükleme: satır BU işlemde (restore_user_backup adım 1)
  -- tombstone'landıysa yedekteki sürüm eski damgalı olsa da yazılır. "Bu
  -- işlemde" = satırın görünen sürümünü yazan işlem (xmin) şu anki işlem.
  -- Zaman eşitliği (deleted_at = now()) yetmez: saat çözünürlüğü kaba olan
  -- ortamlarda art arda iki ayrı işlem aynı now()'u alabiliyor (PGlite'ta
  -- ölçüldü). Ayrı bir PostgREST isteği bu koşulu üretemez.
  if old.deleted_at is not null then
    execute format('select xmin = pg_current_xact_id()::xid from %I.%I where id = $1',
                   tg_table_schema, tg_table_name)
      into same_tx using old.id;
    if same_tx then
      return new;
    end if;
  end if;

  -- ISO-8601 UTC metinleri ("2026-09-26T10:00:00.000Z") sözlük sırasıyla
  -- zaman sırasındadır.
  if new."updatedAt" is not null
     and old."updatedAt" is not null
     and new."updatedAt" < old."updatedAt" then
    return old;   -- gelen sürüm eski: mevcut (daha yeni) satır korunur
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'transactions', 'categories', 'budgets', 'debts',
    'investment_transactions', 'people', 'recurring_transactions', 'workspaces',
    'payment_plans', 'payment_occurrences', 'savings_goals'
  ] loop
    execute format('drop trigger if exists keep_newer_row on public.%I;', t);
    execute format(
      'create trigger keep_newer_row before update on public.%I '
      'for each row execute function public.keep_newer_row();', t);
  end loop;
end $$;

-- ── 4. Realtime yayını ──────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok — canlı senkron atlandı';
    return;
  end if;
  foreach t in array array[
    'accounts', 'transactions', 'categories', 'budgets', 'debts',
    'investment_transactions', 'people', 'recurring_transactions', 'workspaces',
    'payment_plans', 'payment_occurrences', 'savings_goals'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. 12 tetikleyici:
--      select event_object_table from information_schema.triggers
--       where trigger_name = 'keep_newer_row' order by 1;
--
-- 2. 12 tablo Realtime yayınında:
--      select tablename from pg_publication_tables
--       where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
--
-- 3. Tetikleyici davranışı (geçici tablo, sonunda düşürülür):
--      create temp table _kn (id int primary key, "updatedAt" text, deleted_at timestamptz);
--      create trigger kn before update on _kn for each row execute function public.keep_newer_row();
--      insert into _kn values (1, '2026-09-26T10:00:00.000Z', null);
--      update _kn set "updatedAt" = '2026-09-26T09:00:00.000Z' where id = 1;  -- eski → yok sayılır
--      select "updatedAt" from _kn;                                           -- 10:00 kalmalı
--      update _kn set "updatedAt" = '2026-09-26T11:00:00.000Z' where id = 1;  -- yeni → yazılır
--      select "updatedAt" from _kn;                                           -- 11:00
--      drop table _kn;
-- ============================================================================
