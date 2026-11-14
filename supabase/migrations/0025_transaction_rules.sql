-- ============================================================================
-- 0025 — İşlem Kuralları: transaction_rules
--
-- Kullanıcı tanımlı otomatik sınıflandırma: "açıklama X içeriyorsa / X ile
-- başlıyorsa / tam eşitse (+ isteğe bağlı hesap, tür, tutar aralığı) →
-- kategori ata, etiket ekle, alıcı ata". Sıralı (sortOrder), ilk eşleşen
-- kazanır. Eşleştirme istemcide: src/lib/utils/transaction-rules.ts.
-- YENİ tablo — mevcut tabloların satırlarına DOKUNULMAZ.
--
-- Örnek alınan desen: savings_goals (0015) + 0016 (keep_newer_row, Realtime)
-- + 0021 (paylaşılan çalışma alanı politikaları, sahiplik tetikleyicisi) +
-- 0013 (MFA kısıtlayıcı politikası) + 0020/0024 (açık Data API GRANT'ları).
--
-- ⚠️ ÖN KOŞUL: 0013 (mfa_satisfied), 0016 (keep_newer_row), 0021
--    (my_workspace_ids, set_workspace_owner).
--
-- ⚠️ DEPLOY SIRASI: Kurallar ekranını içeren istemci yayına alınmadan ÖNCE
-- çalıştırılmalıdır. Uygulanmazsa bulut yazımı "tablo yok" (PGRST205) ile
-- reddedilir; istemci bunu tanır ve kuralları YALNIZ YEREL tutar (outbox'ta
-- deneme sayacı artmadan bekler, senkron uyarısı çıkmaz — engine.ts
-- tablesMissingInCloud). Migration sonrası ilk açılışta buluta gider.
--
-- YEDEK: restore_user_backup (0009) tablo listesi sabit olduğu için bu tabloyu
-- bilmez; geri yükleme onu savings_goals ile aynı yoldan, outbox üzerinden
-- değiştirir (src/lib/backup-sync.ts → replaceOutboxTables). RPC'ye dokunulmadı.
--
-- PAYLAŞIM: create_workspace_invite (0021) ilk paylaşımda alana başka
-- hesabın önceden yerleştirdiği satırları siler; bu tablo o listeye eklenmek
-- üzere fonksiyon aşağıda aynı gövdeyle yeniden tanımlanır (tek fark liste).
--
-- HESAP SİLME: user_id → auth.users ON DELETE CASCADE.
--
-- Sütun adları camelCase + tırnaklı (sync engine alan adlarıyla birebir push
-- eder). Bilinçli olarak CHECK kısıtı yok (0011/0015 gerekçesi: eski istemci
-- kuyruğu kalıcı reddedilmesin). Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- ── 1. Tablo ────────────────────────────────────────────────────────────────
create table if not exists public.transaction_rules (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  "pattern" text not null,
  "matchKind" text not null,           -- 'contains' | 'startsWith' | 'equals'
  "accountId" text,
  "txType" text,                       -- 'expense' | 'income' | null
  "minAmount" double precision,
  "maxAmount" double precision,
  "categoryId" text,
  "tags" jsonb,
  "recipientId" text,
  "sortOrder" double precision not null default 0,
  "isActive" boolean not null default true,
  "createdAt" text,
  "updatedAt" text,
  "workspaceId" text,
  deleted_at timestamptz
);

-- Data API erişimi AÇIKÇA verilir (Supabase 30 Ekim 2026'dan beri yeni
-- tablolara otomatik izin vermiyor). Girişsiz (anon) erişim yok.
grant select, insert, update, delete on public.transaction_rules to authenticated;
grant all on public.transaction_rules to service_role;

create index if not exists transaction_rules_user_live_idx
  on public.transaction_rules (user_id) where deleted_at is null;

-- ── 2. RLS: sahip-veya-alan-üyesi (0021) + MFA (0013) ───────────────────────
alter table public.transaction_rules enable row level security;
alter table public.transaction_rules force row level security;

do $$
declare
  pol text;
begin
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'transaction_rules'
  loop
    execute format('drop policy if exists %I on public.transaction_rules;', pol);
  end loop;
end $$;

create policy transaction_rules_select on public.transaction_rules for select to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_rules_insert on public.transaction_rules for insert to authenticated
  with check (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_rules_update on public.transaction_rules for update to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()))
  with check (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_rules_delete on public.transaction_rules for delete to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_rules_mfa_required on public.transaction_rules
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ── 3. Tetikleyiciler: paylaşılan alanın sahibi (0021), eski yazma yeniyi ezemez (0016)
drop trigger if exists set_workspace_owner on public.transaction_rules;
create trigger set_workspace_owner before insert or update on public.transaction_rules
  for each row execute function public.set_workspace_owner();

drop trigger if exists keep_newer_row on public.transaction_rules;
create trigger keep_newer_row before update on public.transaction_rules
  for each row execute function public.keep_newer_row();

-- ── 4. Realtime yayını (0016) ───────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok — canlı senkron atlandı';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transaction_rules'
  ) then
    alter publication supabase_realtime add table public.transaction_rules;
  end if;
end $$;

-- ── 5. create_workspace_invite: yabancı satır temizliği bu tabloyu da kapsar ─
-- 0021'deki gövdenin AYNISI; yalnız temizlenen tablo listesine
-- 'transaction_rules' eklendi.
create or replace function public.create_workspace_invite(p_workspace text)
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
  select "isDefault" into ws_default from public.workspaces
   where id = p_workspace and user_id = uid and deleted_at is null;
  if not found then
    raise exception 'alan bulunamadı' using errcode = '42501';
  end if;
  if coalesce(ws_default, false) then
    raise exception 'varsayılan alan paylaşılamaz' using errcode = '22023';
  end if;

  if public.workspace_owner(p_workspace) is null then
    insert into public.workspace_members (workspace_id, user_id, role, email)
    values (p_workspace, uid, 'owner', auth.jwt() ->> 'email');
    foreach t in array array[
      'accounts', 'transactions', 'categories', 'budgets', 'debts',
      'investment_transactions', 'people', 'recurring_transactions',
      'payment_plans', 'payment_occurrences', 'savings_goals', 'transaction_rules'
    ] loop
      execute format('delete from public.%I where "workspaceId" = $1 and user_id <> $2', t)
        using p_workspace, uid;
    end loop;
  end if;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites (workspace_id, token_hash, created_by)
  values (p_workspace, encode(sha256(convert_to(token, 'UTF8')), 'hex'), uid);
  return token;
end;
$$;

revoke all on function public.create_workspace_invite(text) from public, anon;
grant execute on function public.create_workspace_invite(text) to authenticated;

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. RLS açık ve zorlanmış (true, true):
--      select relrowsecurity, relforcerowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace and relname = 'transaction_rules';
-- 2. Beş politika (select/insert/update/delete + RESTRICTIVE MFA):
--      select policyname, permissive, cmd from pg_policies
--       where schemaname = 'public' and tablename = 'transaction_rules' order by 1;
-- 3. İki tetikleyici (keep_newer_row, set_workspace_owner):
--      select trigger_name from information_schema.triggers
--       where event_object_table = 'transaction_rules' group by 1;
-- 4. Realtime: select 1 from pg_publication_tables
--       where pubname = 'supabase_realtime' and tablename = 'transaction_rules';
-- ============================================================================
