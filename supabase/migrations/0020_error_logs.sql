-- ============================================================================
-- 0020 — İstemci hata kaydı (ücretli Sentry yerine)
--
-- Tarayıcıdaki yakalanmamış hatalar ve hata sınırına düşen render hataları
-- buraya yazılır (src/lib/error-reporter.ts). Kullanıcı YALNIZ EKLER; okuma
-- politikası yoktur — kayıtlar Supabase panelinden (Table Editor / SQL) okunur.
--
-- Gizlilik: yalnız hata mesajı, yığın, sayfa YOLU (sorgu dizesi yok), sürüm ve
-- tarayıcı bilgisi. İşlem verisi gönderilmez. Kayıtlar 30 gün tutulur; hesap
-- silinince (auth.users) CASCADE ile gider.
--
-- Idempotent.
-- ============================================================================

create table if not exists public.error_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('error', 'unhandledrejection', 'boundary')),
  message     text not null check (length(message) <= 2000),
  stack       text check (length(stack) <= 8000),
  path        text check (length(path) <= 300),
  user_agent  text check (length(user_agent) <= 400),
  release     text check (length(release) <= 64)
);

create index if not exists error_logs_created_at_idx on public.error_logs (created_at);

alter table public.error_logs enable row level security;

drop policy if exists error_logs_insert_own on public.error_logs;
create policy error_logs_insert_own on public.error_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- 30 günden eski kayıtları temizle (ekleme başına bir kez; kullanıcı silme
-- yetkisi olmadığı için security definer)
create or replace function public.prune_error_logs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.error_logs where created_at < now() - interval '30 days';
  return null;
end;
$$;

revoke all on function public.prune_error_logs() from public, anon, authenticated;

drop trigger if exists error_logs_prune on public.error_logs;
create trigger error_logs_prune
  after insert on public.error_logs
  for each statement execute function public.prune_error_logs();

-- ============================================================================
-- OKUMA (panelde):
--   select created_at, kind, message, path, release from public.error_logs
--    order by created_at desc limit 100;
-- ============================================================================
