-- ============================================================================
-- 0024 — Yarım kalan ekstreler (taslaklar) cihazlar arası
--
-- Ekstre Yükle'de yarım bırakılan ekstre önceden yalnız o tarayıcıda
-- (localStorage) duruyordu; başka cihazda görünmüyordu. Taslak artık buraya da
-- yazılır (src/store/statement-drafts.store.ts): okunmuş satırlar, seçilen
-- hesap, kararlar ve düzenlemeler tek bir jsonb belgesinde. PDF'in kendisi
-- gönderilmez.
--
-- • Taslak KİŞİSELDİR: paylaşılan çalışma alanında bile yalnız onu yükleyen
--   kullanıcı görür (politikalar yalnız user_id).
-- • Kimlik ekstreden türetildiği için iki kullanıcının aynı ekstresi aynı id'yi
--   alabilir: birincil anahtar (user_id, id).
-- • Silme = deleted_at damgası (tombstone): öbür cihaz bir sonraki açılışta
--   kendi kopyasını da siler. Onaylanan/silinen taslağın data'sı boşaltılır.
-- • Çakışma: istemci "updatedAt'i yeni olan kazanır" ile birleştirir.
--
-- Kod yayına çıkmadan ÖNCE uygulanmalı (uygulanmazsa taslaklar eskisi gibi
-- yalnız cihazda kalır; hata vermez). Idempotent.
-- ============================================================================

create table if not exists public.statement_drafts (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id            text not null check (length(id) <= 64),
  "workspaceId" text,
  data          jsonb,
  "updatedAt"   timestamptz not null default now(),
  deleted_at    timestamptz,
  primary key (user_id, id),
  -- Canlı taslağın belgesi olmalı; tek bir taslak 2 MB'ı geçmez (58 satırlık
  -- dönem içi liste ~40 KB)
  constraint statement_drafts_data_check check (
    (deleted_at is not null or data is not null) and (data is null or pg_column_size(data) <= 2097152)
  )
);

create index if not exists statement_drafts_user_updated_idx on public.statement_drafts (user_id, "updatedAt");

alter table public.statement_drafts enable row level security;

drop policy if exists statement_drafts_select_own on public.statement_drafts;
create policy statement_drafts_select_own on public.statement_drafts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists statement_drafts_insert_own on public.statement_drafts;
create policy statement_drafts_insert_own on public.statement_drafts
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists statement_drafts_update_own on public.statement_drafts;
create policy statement_drafts_update_own on public.statement_drafts
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists statement_drafts_delete_own on public.statement_drafts;
create policy statement_drafts_delete_own on public.statement_drafts
  for delete to authenticated using (user_id = (select auth.uid()));

-- Data API erişimi AÇIKÇA verilir (Supabase 30 Ekim 2026'dan beri yeni
-- tablolara otomatik izin vermiyor; bkz. 0020). Girişsiz (anon) erişim yok.
grant select, insert, update, delete on table public.statement_drafts to authenticated;
grant all on table public.statement_drafts to service_role;

-- 60 günden eski silme kayıtlarını temizle (her cihaz o sürede en az bir kez
-- açılmış sayılır; açılmamışsa eski taslak yine görünür, zarar yok)
create or replace function public.prune_statement_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.statement_drafts
   where user_id = (select auth.uid()) and deleted_at is not null and deleted_at < now() - interval '60 days';
  return null;
end;
$$;

revoke all on function public.prune_statement_drafts() from public, anon, authenticated;

drop trigger if exists statement_drafts_prune on public.statement_drafts;
create trigger statement_drafts_prune
  after insert on public.statement_drafts
  for each statement execute function public.prune_statement_drafts();
