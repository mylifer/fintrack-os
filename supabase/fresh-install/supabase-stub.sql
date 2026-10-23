-- ============================================================================
-- Supabase ortamının asgari taklidi — YALNIZ fresh-install testi için.
-- Boş bir Postgres'te migration'ların dayandığı auth/storage/realtime
-- parçalarını kurar. Canlı projede ÇALIŞTIRMAYIN.
--
-- Bilerek public şemasında VARSAYILAN İZİN YOK: Supabase 30 Ekim 2026'dan beri
-- yeni tablolara Data API izni otomatik vermiyor. Test bu davranışı taklit
-- eder; izni unutulmuş bir tablo burada yakalanır.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  status text,
  factor_type text
);
-- Supabase'deki gibi: JWT talepleri istek ayarlarından okunur
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create publication supabase_realtime;

grant usage on schema public to anon, authenticated, service_role;
