-- ============================================================================
-- 0015 — Birikim Hedefleri: savings_goals
--
-- "Aralık'a kadar tatil için 50.000 ₺" gibi hedefler. İlerleme SAKLANMAZ:
-- hedef bir hesaba bağlıysa o hesabın bakiyesinden, değilse "savedAmount"tan
-- istemcide türetilir (src/lib/utils/goals.ts). YENİ tablo — mevcut tablolara,
-- satırlara ve politikalara DOKUNULMAZ.
--
-- ⚠️ ÖN KOŞUL: 0013 (public.mfa_satisfied fonksiyonu burada da kullanılır).
--
-- ⚠️ DEPLOY SIRASI: Hedefler sayfasını içeren istemci yayına alınmadan ÖNCE
-- çalıştırılmalıdır. Aksi halde hedef yazımları "relation does not exist" alıp
-- outbox'ta bekler/dead-letter'a düşer ve senkron uyarı bandı çıkar (0011 ile
-- aynı durum — migration sonrası açılışta yeniden denenir, veri kaybolmaz).
--
-- YEDEK: restore_user_backup (0009) tablo listesi sabit olduğu için bu tabloyu
-- bilmez; istemci geri yüklemede onu Ödeme Takibi tablolarıyla aynı yoldan,
-- outbox üzerinden değiştirir (src/lib/backup-sync.ts → replaceOutboxTables).
-- Üretimde çalışan RPC'ye dokunulmadı.
--
-- HESAP SİLME: user_id → auth.users FK'sı ON DELETE CASCADE — 0013'teki
-- delete_my_account() auth.users satırını silince hedefler de gider.
--
-- Sütun adları camelCase + tırnaklı (sync engine alan adlarıyla birebir push
-- eder). Bilinçli olarak CHECK kısıtı yok (0011'deki gerekçe). Idempotent.
-- ============================================================================

create table if not exists public.savings_goals (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  "name" text not null,
  "targetAmount" double precision not null,
  "targetDate" text,
  "accountId" text,
  "savedAmount" double precision,
  "color" text,
  "notes" text,
  "createdAt" text,
  "updatedAt" text,
  "workspaceId" text,
  deleted_at timestamptz
);

-- Ham DDL ile oluşturulan tablo "authenticated" rolüne GRANT'i otomatik almaz
-- (workspaces'te yaşandı — bkz. supabase_schema.sql).
grant select, insert, update, delete on public.savings_goals to authenticated;

create index if not exists savings_goals_user_live_idx
  on public.savings_goals (user_id) where deleted_at is null;

-- RLS: diğer tablolarla BİREBİR aynı owner-only sertleştirme + 0013'teki MFA
-- kısıtlayıcı politikası.
do $$
declare
  pol text;
begin
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'savings_goals'
  loop
    execute format('drop policy if exists %I on public.savings_goals;', pol);
  end loop;
end $$;

alter table public.savings_goals enable row level security;
alter table public.savings_goals force row level security;

create policy savings_goals_select_own on public.savings_goals
  for select to authenticated using (user_id = auth.uid());
create policy savings_goals_insert_own on public.savings_goals
  for insert to authenticated with check (user_id = auth.uid());
create policy savings_goals_update_own on public.savings_goals
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy savings_goals_delete_own on public.savings_goals
  for delete to authenticated using (user_id = auth.uid());
create policy savings_goals_mfa_required on public.savings_goals
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. RLS açık ve zorlanmış (true, true):
--      select relrowsecurity, relforcerowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace and relname = 'savings_goals';
--
-- 2. Beş politika (4 owner-only + 1 RESTRICTIVE MFA):
--      select policyname, permissive, cmd from pg_policies
--       where schemaname = 'public' and tablename = 'savings_goals' order by policyname;
-- ============================================================================
