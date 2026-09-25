-- ============================================================================
-- 0013 — Hesap güvenliği: iki adımlı doğrulama (MFA) RLS'te zorlanır +
--        kullanıcının kendi hesabını silmesi (KVKK / unutulma hakkı)
--
-- İSTEMCİ TARAFI: Ayarlar → Hesap (src/components/settings/AccountSettings.tsx),
-- giriş sayfasındaki kod adımı ve src/proxy.ts'teki aal2 kapısı.
--
-- 1) mfa_satisfied() + kısıtlayıcı (RESTRICTIVE) politikalar
-- ----------------------------------------------------------
-- Doğrulama uygulaması eklemiş bir kullanıcının oturumu ancak kod girildikten
-- sonra aal2 olur. Proxy aal1 oturumu arayüzden uzak tutar ama PostgREST'e
-- doğrudan giden bir istek proxy'den geçmez: yalnız şifreyi ele geçiren biri
-- anon anahtarla veriyi okuyabilirdi. Bu yüzden asıl kilit burada.
--
--   • MFA'sı OLMAYAN kullanıcı: hiçbir şey değişmez (aal1 yeterli).
--   • MFA'sı OLAN kullanıcı: aal1 oturumla hiçbir satırı göremez/yazamaz.
--
-- RESTRICTIVE politika mevcut owner-only (PERMISSIVE) politikalarla AND'lenir;
-- onları gevşetmez, yalnız daraltır.
--
-- `authenticated` rolünün auth.mfa_factors'ı okuma yetkisi YOK (2026-09-25'te
-- canlı katalogda doğrulandı: has_table_privilege → false). Supabase
-- belgelerindeki politikayı doğrudan yazmak "permission denied" verirdi; kontrol
-- bu yüzden sahibi postgres olan bir security definer fonksiyonda.
-- `(select public.mfa_satisfied())` sarmalayıcısı fonksiyonun satır başına
-- değil SORGU başına bir kez çalışmasını sağlar (initPlan).
--
-- ⚠️ supabase_schema.sql ve 0011 tablolarındaki TÜM politikaları silip yeniden
--    kurar. İkisinden biri yeniden çalıştırılırsa bu dosyayı da yeniden
--    çalıştırın, yoksa MFA zorlaması sessizce kalkar.
--
-- 2) delete_my_account()
-- ----------------------
-- Kullanıcının tüm satırlarını ve auth.users kaydını TEK transaction'da siler.
-- Tabloların user_id FK'ları (user_backups hariç) ON DELETE CASCADE DEĞİL, bu
-- yüzden satırlar önce açıkça silinir; sıra tablolar arası FK'lara uyar.
-- security definer + sahibi postgres: postgres BYPASSRLS'tir (FORCE RLS'e
-- rağmen siler) ve auth.users'ta DELETE yetkisi vardır (ikisi de 2026-09-25'te
-- canlıda doğrulandı). Hedef HER ZAMAN auth.uid() — parametre almaz, başkasının
-- hesabı hedeflenemez. MFA'lı kullanıcıda aal2 şartı burada da aranır.
--
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
      );
$$;

revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts',
    'transactions',
    'categories',
    'budgets',
    'debts',
    'investment_transactions',
    'people',
    'recurring_transactions',
    'workspaces',
    'payment_plans',
    'payment_occurrences',
    'user_backups'
  ] loop
    execute format('drop policy if exists %I on public.%I;', t || '_mfa_required', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));',
      t || '_mfa_required', t
    );
  end loop;
end $$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'oturum yok' using errcode = '42501';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'iki adımlı doğrulama gerekli' using errcode = '42501';
  end if;

  -- Çocuktan ebeveyne: bağlı satırlar önce gider
  delete from public.payment_occurrences     where user_id = uid;
  delete from public.payment_plans           where user_id = uid;
  delete from public.investment_transactions where user_id = uid;
  delete from public.transactions            where user_id = uid;
  delete from public.recurring_transactions  where user_id = uid;
  delete from public.budgets                 where user_id = uid;
  delete from public.debts                   where user_id = uid;
  delete from public.people                  where user_id = uid;
  delete from public.categories              where user_id = uid;
  delete from public.accounts                where user_id = uid;
  delete from public.workspaces              where user_id = uid;
  delete from public.user_backups            where user_id = uid;

  -- Oturumlar, kimlikler ve MFA faktörleri auth şemasında CASCADE ile gider
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. Her tabloda bir RESTRICTIVE politika (12 satır dönmeli):
--      select tablename, policyname, permissive from pg_policies
--       where schemaname = 'public' and policyname like '%\_mfa\_required';
--
-- 2. İki fonksiyon da search_path sabit ve security definer:
--      select proname, prosecdef, proconfig from pg_proc
--       where pronamespace = 'public'::regnamespace
--         and proname in ('mfa_satisfied', 'delete_my_account');
--
-- 3. anon çalıştıramaz (ikisi de false dönmeli):
--      select has_function_privilege('anon', 'public.mfa_satisfied()', 'execute'),
--             has_function_privilege('anon', 'public.delete_my_account()', 'execute');
--
-- 4. MFA'sız bir kullanıcı için davranış değişmemeli: uygulamayı açıp verinin
--    geldiğini görün. (Şu an canlıda doğrulanmış faktör sayısı 0.)
-- ============================================================================
