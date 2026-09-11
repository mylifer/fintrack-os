-- ============================================================================
-- 0011 — Ödeme Takibi: payment_plans + payment_occurrences
--
-- Kredi kartı ve borçların aylık ödemelerini takip eden modülün iki tablosu.
-- İKİSİ DE YENİ — mevcut tablolara, satırlara ve politikalara DOKUNULMAZ.
--
--   payment_plans       — hedef (kredi kartı hesabı ya da borç) başına
--                         varsayılanlar: aylık tutar, ödeme hesabı, ödeme günü,
--                         takip başlangıcı, takipte mi.
--   payment_occurrences — tek bir ayın düzenlemesi ve ödeme kaydı: o aya özel
--                         tutar / tarih / hesap, ödendi-atlandı durumu, ödeme
--                         işleminin kimliği.
--
-- Satırlar yalnızca kullanıcı bir şeyi değiştirdiğinde yazılır; kayıt yoksa
-- istemci değerleri kartın/borcun kendi alanlarından türetir
-- (src/lib/payments/schedule.ts). Kimlikler deterministik uuid metnidir.
--
-- ⚠️ DEPLOY SIRASI: bu migration, Ödeme Takibi'ni içeren istemci sürümü
-- yayına alınmadan ÖNCE çalıştırılmalıdır. Aksi halde bu tablolara yazılan her
-- kayıt "relation does not exist" alıp outbox'ta bekler/dead-letter'a düşer ve
-- senkron uyarı bandı çıkar (migration sonrası uygulama açılışında otomatik
-- yeniden denenir — veri kaybolmaz, ama çıkış yapılırsa yerel kuyruk silinir).
--
-- Sütun adları camelCase + tırnaklı: sync engine satır snapshot'ını alan
-- adlarıyla birebir push eder (bkz. supabase_schema.sql → schema-drift guard).
--
-- Bilinçli olarak CHECK kısıtı YOK ("targetKind", "status"): enum-benzeri bir
-- değer ileride genişlerse eski kısıt her yazımı reddeder ve outbox'ı
-- dead-letter'a düşürür (0003 bilezik vakası). Doğrulama istemcide.
--
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

create table if not exists public.payment_plans (
  id text primary key,
  user_id uuid not null,
  "targetKind" text not null,
  "targetId" text not null,
  "amount" double precision,
  "fromAccountId" text,
  "dayOfMonth" double precision,
  "startMonth" text,
  "isActive" boolean,
  "notes" text,
  "createdAt" text,
  "updatedAt" text,
  "workspaceId" text,
  deleted_at timestamptz
);

create table if not exists public.payment_occurrences (
  id text primary key,
  user_id uuid not null,
  "targetKind" text not null,
  "targetId" text not null,
  "month" text not null,
  "amount" double precision,
  "fromAccountId" text,
  "dueDate" text,
  "status" text,
  "paidAmount" double precision,
  "paidDate" text,
  "transactionId" text,
  "note" text,
  "createdAt" text,
  "updatedAt" text,
  "workspaceId" text,
  deleted_at timestamptz
);

-- Ham DDL ile oluşturulan tablolar "authenticated" rolüne tablo-seviyesi
-- GRANT'i otomatik almaz (workspaces'te yaşandı — bkz. supabase_schema.sql).
-- RLS politikaları doğru olsa bile grant yoksa "permission denied" alınır.
grant select, insert, update, delete on public.payment_plans to authenticated;
grant select, insert, update, delete on public.payment_occurrences to authenticated;

-- RLS: supabase_schema.sql'deki diğer tablolarla BİREBİR aynı sertleştirme.
do $$
declare
  t text;
  pol text;
begin
  foreach t in array array['payment_plans', 'payment_occurrences'] loop
    execute format(
      'create index if not exists %I on public.%I (user_id) where deleted_at is null;',
      t || '_user_live_idx', t
    );

    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I;', pol, t);
    end loop;

    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid());',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid());',
      t || '_insert_own', t
    );
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

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. İki tablo da RLS açık (true, true) dönmeli:
--      select relname, relrowsecurity, relforcerowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace
--         and relname in ('payment_plans', 'payment_occurrences');
--
-- 2. Her tabloda tam dört politika (_select/_insert/_update/_delete_own):
--      select tablename, policyname, cmd from pg_policies
--       where schemaname = 'public'
--         and tablename in ('payment_plans', 'payment_occurrences')
--       order by tablename, cmd;
-- ============================================================================
