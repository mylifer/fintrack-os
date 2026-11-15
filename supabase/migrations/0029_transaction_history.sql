-- ============================================================================
-- 0029 — İşlem Değişiklik Geçmişi: transaction_history
--
-- Bir kaydın NE ZAMAN düzenlendiğini `updatedAt` zaten söylüyordu; NEYİN
-- değiştiğini kimse bilmiyordu. Bu tablo her işlem yazmasında bir denetim
-- satırı tutar: zaman, eylem (oluşturuldu/düzenlendi/silindi/geri alındı),
-- hangi yoldan (form / ekstre / iade / toplu düzenleme / tekrarlayan / onay /
-- geri alma) ve alan alan eski→yeni değer çiftleri.
-- YENİ tablo — mevcut tabloların satırlarına DOKUNULMAZ.
--
-- SATIRLARI KİM YAZAR: istemcideki TEK merkez, sync engine'in 5 yerel yazma
-- primitive'i (localUpsert / localBulkUpsert / localPatch / localPatchMany /
-- localBatch — softDelete* bunların üzerinden). Geçmiş satırı ana yazmayla
-- AYNI IndexedDB işleminde doğar ve aynı dayanıklı outbox'tan buluta gider;
-- böylece hiçbir yazma yolu (form, ekstre içe aktarma, iade, toplu düzenleme,
-- tekrarlayan üretim, onay, geri alma) geçmişi atlamaz. Diff mantığı:
-- src/lib/sync/history.ts.
--
-- APPEND-ONLY: satırlar YALNIZ eklenir — geçmiş geçmişte kalır, düzenlenmez.
-- UPDATE/DELETE yetkisi gene de verilir (outbox upsert'ü ON CONFLICT DO UPDATE
-- yapar ve çakışma hâlinde aynı satırın aynısını yazar; tombstone yolu da
-- açık kalsın). İstemci bu tabloya kendiliğinden UPDATE/DELETE üretmez ve
-- geçmiş tablosunun KENDİSİ için geçmiş yazmaz (sonsuz döngü koruması).
--
-- Örnek alınan desen: transaction_rules (0025) — aynı bölümler, aynı sıra.
--
-- ⚠️ ÖN KOŞUL: 0013 (mfa_satisfied), 0016 (keep_newer_row), 0021
--    (my_workspace_ids, set_workspace_owner), 0028 (salt okuma politikaları —
--    set_workspace_owner kurulduğu an olay tetikleyicisiyle kendiliğinden gelir).
--
-- ⚠️ DEPLOY SIRASI: Geçmişi yazan istemci yayına alınmadan ÖNCE çalıştırılmalı.
-- Uygulanmazsa bulut yazımı "tablo yok" (PGRST205) ile reddedilir; istemci
-- bunu tanır ve geçmişi YALNIZ YEREL tutar (outbox'ta deneme sayacı artmadan
-- bekler, senkron uyarısı çıkmaz — engine.ts tablesMissingInCloud). İşlem
-- yazmaları etkilenmez. Migration sonrası ilk açılışta buluta gider.
--
-- YEDEK: restore_user_backup (0009) tablo listesi SABİT olduğu için bu tabloyu
-- BİLMEZ; geri yükleme geçmiş satırlarına dokunmaz (geçmiş append-only olduğu
-- için bu doğru davranıştır — eski bir anlık görüntü geçmişi silmemeli).
-- RPC'ye dokunulmadı.
--
-- PAYLAŞIM: create_workspace_invite ilk paylaşımda alana başka hesabın
-- önceden yerleştirdiği satırları siler; bu tablo o kapsama eklenmek üzere
-- fonksiyon aşağıda 0028'in gövdesiyle yeniden tanımlanır (tek fark liste).
--
-- HESAP SİLME: user_id → auth.users ON DELETE CASCADE.
--
-- Sütun adları camelCase + tırnaklı (sync engine alan adlarıyla birebir push
-- eder). Bilinçli olarak CHECK kısıtı yok (0011/0015/0025 gerekçesi: eski
-- istemci kuyruğu kalıcı reddedilmesin — yeni bir `source` etiketi eklenince
-- eski satırlar da yazılabilsin). Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

-- ── 1. Tablo ────────────────────────────────────────────────────────────────
create table if not exists public.transaction_history (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  "txId" text not null,                -- geçmişi tutulan işlemin id'si (FK YOK: işlem silinse de geçmiş kalır)
  "at" text not null,                  -- ISO zaman damgası (değişikliğin anı)
  "action" text not null,              -- 'create' | 'update' | 'delete' | 'restore'
  "source" text,                       -- 'form' | 'import' | 'refund' | 'batch' | 'recurring' | 'approval' | 'undo' | 'app'
  "changes" jsonb,                     -- { alan: [eski, yeni] } — yalnız DEĞİŞEN alanlar
  "device" text,                       -- kısa cihaz etiketi ("Chrome · macOS"); tam user-agent YAZILMAZ
  "createdAt" text,
  "updatedAt" text,
  "workspaceId" text,
  deleted_at timestamptz
);

-- Data API erişimi AÇIKÇA verilir (Supabase 30 Ekim 2026'dan beri yeni
-- tablolara otomatik izin vermiyor). Girişsiz (anon) erişim yok.
grant select, insert, update, delete on public.transaction_history to authenticated;
grant all on public.transaction_history to service_role;

-- Okuma yolu TALEP ÜZERİNEdir: tek bir işlemin geçmişi (user_id + "txId").
create index if not exists transaction_history_user_tx_idx
  on public.transaction_history (user_id, "txId");

create index if not exists transaction_history_user_live_idx
  on public.transaction_history (user_id) where deleted_at is null;

-- ── 2. RLS: sahip-veya-alan-üyesi (0021) + MFA (0013) ───────────────────────
alter table public.transaction_history enable row level security;
alter table public.transaction_history force row level security;

do $$
declare
  pol text;
begin
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'transaction_history'
  loop
    execute format('drop policy if exists %I on public.transaction_history;', pol);
  end loop;
end $$;

create policy transaction_history_select on public.transaction_history for select to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_history_insert on public.transaction_history for insert to authenticated
  with check (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_history_update on public.transaction_history for update to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()))
  with check (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_history_delete on public.transaction_history for delete to authenticated
  using (user_id = (select auth.uid()) or "workspaceId" in (select public.my_workspace_ids()));
create policy transaction_history_mfa_required on public.transaction_history
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ── 3. Tetikleyiciler: paylaşılan alanın sahibi (0021), eski yazma yeniyi ezemez (0016)
-- set_workspace_owner ayrıca 0028'in olay tetikleyicisini uyandırır: salt okuma
-- (viewer) üyesinin bu tabloya yazmasını engelleyen üç RESTRICTIVE politika
-- CREATE TRIGGER anında kendiliğinden eklenir.
drop trigger if exists set_workspace_owner on public.transaction_history;
create trigger set_workspace_owner before insert or update on public.transaction_history
  for each row execute function public.set_workspace_owner();

drop trigger if exists keep_newer_row on public.transaction_history;
create trigger keep_newer_row before update on public.transaction_history
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
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transaction_history'
  ) then
    alter publication supabase_realtime add table public.transaction_history;
  end if;
end $$;

-- ── 5. create_workspace_invite: yabancı satır temizliği bu tabloyu da kapsar ─
-- 0028'teki (EN SON) gövdenin AYNISI; yalnız temizlenen tablo listesine
-- 'transaction_history' eklendi. 0028 listeyi set_workspace_owner taşıyan
-- tablolardan TÜRETİYOR — bu tabloya o tetikleyici yukarıda kurulduğu için
-- zaten kapsanır; yine de açıkça union'lanır ki tetikleyici elle kaldırılsa
-- bile ilk paylaşımda yabancı geçmiş satırı alanda kalmasın (union tekrarı
-- eler). 0025'in yaptığı gibi: tek fark liste.
create or replace function public.create_workspace_invite(p_workspace text, p_role text)
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
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'geçersiz rol' using errcode = '22023';
  end if;
  select "isDefault" into ws_default from public.workspaces
   where id = p_workspace and user_id = uid and deleted_at is null;
  if not found then
    raise exception 'alan bulunamadı' using errcode = '42501';
  end if;
  if coalesce(ws_default, false) then
    raise exception 'varsayılan alan paylaşılamaz' using errcode = '22023';
  end if;

  -- İlk paylaşım: sahip satırı + başka hesabın alana önceden yerleştirdiği
  -- satırların temizliği (0021 gerekçesi). Kapsam: paylaşılan HER tablo.
  if public.workspace_owner(p_workspace) is null then
    insert into public.workspace_members (workspace_id, user_id, role, email)
    values (p_workspace, uid, 'owner', auth.jwt() ->> 'email');
    for t in
      select distinct c.relname
        from pg_catalog.pg_trigger g
        join pg_catalog.pg_class c on c.oid = g.tgrelid
        join pg_catalog.pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and g.tgname = 'set_workspace_owner' and not g.tgisinternal
      union
      select 'transaction_history'
    loop
      execute format('delete from public.%I where "workspaceId" = $1 and user_id <> $2', t)
        using p_workspace, uid;
    end loop;
  end if;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.workspace_invites (workspace_id, token_hash, created_by, role)
  values (p_workspace, encode(sha256(convert_to(token, 'UTF8')), 'hex'), uid, p_role);
  return token;
end;
$$;

-- Eski istemciler (tek argüman) editör daveti üretmeye devam eder (0028)
create or replace function public.create_workspace_invite(p_workspace text)
returns text
language sql security invoker
set search_path = ''
as $$
  select public.create_workspace_invite(p_workspace, 'editor')
$$;

revoke all on function public.create_workspace_invite(text, text) from public, anon;
revoke all on function public.create_workspace_invite(text) from public, anon;
grant execute on function public.create_workspace_invite(text, text) to authenticated;
grant execute on function public.create_workspace_invite(text) to authenticated;

-- ============================================================================
-- DOĞRULAMA (çalıştırdıktan sonra)
-- ============================================================================
-- 1. RLS açık ve zorlanmış (true, true):
--      select relrowsecurity, relforcerowsecurity from pg_class
--       where relnamespace = 'public'::regnamespace and relname = 'transaction_history';
-- 2. Beş politika (select/insert/update/delete + RESTRICTIVE MFA) + 0028'in
--    üç salt okuma politikası:
--      select policyname, permissive, cmd from pg_policies
--       where schemaname = 'public' and tablename = 'transaction_history' order by 1;
-- 3. İki tetikleyici (keep_newer_row, set_workspace_owner):
--      select trigger_name from information_schema.triggers
--       where event_object_table = 'transaction_history' group by 1;
-- 4. Realtime: select 1 from pg_publication_tables
--       where pubname = 'supabase_realtime' and tablename = 'transaction_history';
-- 5. İndeksler (user_tx + canlı kısmi):
--      select indexname from pg_indexes
--       where schemaname = 'public' and tablename = 'transaction_history' order by 1;
-- ============================================================================
