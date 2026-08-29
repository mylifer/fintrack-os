-- ============================================================================
-- 0009 — restore_user_backup: sütun listesi artık ŞEMADAN türetiliyor
--
-- ⚠️  BU MIGRATION HENÜZ ÇALIŞTIRILMADI. Denetim (audit/bug-audit-2026-08-28.md,
--     bulgu #1) kapsamında yazıldı. ÜRETİMDE ÇALIŞTIRMADAN ÖNCE boş bir Supabase
--     projesinde gerçek bir yedek dosyasıyla test edin — aşağıdaki "Doğrulama"
--     bölümüne bakın.
--
-- SORUN
-- -----
-- 0001/0002/0004 sürümleri her tabloya AÇIK sütun listesiyle insert ediyordu.
-- Tabloya sonradan eklenen her sütun bu listelerin dışında kaldı ve geri
-- yüklemede SESSİZCE kayboldu:
--
--   transactions             : "categorySplits" (0007), "approvalStatus",
--                              "approvedAt", "workspaceId",
--                              "workspaceTransferId", "peerWorkspaceId",
--                              "debtPrincipalId" (0008)
--   investment_transactions  : "pnlLinkedTransactionId" (0006), "workspaceId"
--   debts                    : "borrowDate" (0008), "workspaceId"
--   people                   : "isArchived" (0002 ekledi, 0004 geri düşürdü!),
--                              "workspaceId"
--   budgets                  : "categoryName", "workspaceId"
--   accounts / categories    : "workspaceId"
--   workspaces               : tablo hiç geri yüklenmiyordu
--
-- Etki: satır bulutta HÂLÂ duruyorsa `on conflict do update` yalnızca listelenen
-- sütunları güncellediği için eksik alanlar korunuyordu. Ama satır bulutta yoksa
-- (yeni cihaz, silinmiş hesap, sıfırlanmış proje — yani FELAKET KURTARMA) düz
-- insert yolu işliyor ve eksik sütunlar NULL kalıyordu. Somut sonuç: tüm veri
-- varsayılan çalışma alanına çöküyor, kategori payları siliniyor, onay bekleyen
-- işlemler onaysız bakiyeye giriyordu.
--
-- 0002 → 0004 regresyonu (people."isArchived") sorunun tek tek sütun değil bir
-- DESEN olduğunu gösteriyor: fonksiyon her yeniden yazıldığında liste kayıyor.
--
-- ÇÖZÜM
-- -----
-- Sütun listeleri artık information_schema'dan ÇALIŞMA ANINDA türetiliyor.
-- Tabloya yeni bir sütun eklendiğinde bu fonksiyonu güncellemek GEREKMEZ —
-- sütun kendiliğinden kapsanır. Böylece aynı kayma bir daha yaşanamaz.
--
-- KORUNAN DAVRANIŞLAR (0004'ten devralınan, bilinçli kararlar)
-- -----------------------------------------------------------
--   • Hard delete YOK: önce tüm satırlar tombstone'lanır, yedektekiler
--     `deleted_at = null` ile diriltilir. Yedekte olmayanlar tombstone kalır →
--     diğer cihazlar silmeyi POZİTİF kanıtla öğrenir (GOLD_BRACELET vakası).
--   • user_id her satırda çağırana zorlanır; başka hesaba geri yükleme yasak.
--   • Tek transaction: herhangi bir adım patlarsa tamamı geri alınır.
--   • security invoker + RLS: fonksiyon çağıranın yetkisiyle çalışır.
--
-- GERİYE DÖNÜK UYUMLULUK
-- ----------------------
-- Eski yedek dosyaları (ör. 'workspaces' anahtarı olmayanlar) sorunsuz çalışır:
-- jsonb_populate_recordset(null::X, NULL) sıfır satır döndürür, o tablo atlanır.
-- Yedek dosyasında olup tabloda KARŞILIĞI OLMAYAN anahtarlar da yok sayılır
-- (jsonb_populate_recordset bilinmeyen anahtarları görmezden gelir).
--
-- ÇALIŞMA ALANLARI (workspaces) — 2026-08-29 güvenlik denetimi, bulgu F1
-- ----------------------------------------------------------------------
-- Bu dosyanın ilk hâli `workspaces`'i koşulsuz tombstone'luyordu. Uygulama
-- tarafındaki yedek yükü (src/lib/backup-sync.ts → BackupData) `workspaces`
-- anahtarını HENÜZ ÜRETMEDİĞİ için adım 2'de diriltilecek satır yoktu: her geri
-- yükleme kullanıcının tüm çalışma alanlarını ölü bırakıyor, geri yüklenen
-- satırlar ölü bir workspaceId'yi gösterdiği için istemci HEPSİNİ filtreliyor
-- ve kullanıcı tüm verisini kaybolmuş görüyordu. RPC hata vermiyor, rollback
-- tetiklenmiyor — sorun bir sonraki sayfa yüklemesinde ortaya çıkıyordu.
--
-- Düzeltme: tombstone + upsert artık `has_workspaces` koşuluna bağlı. Yedekte
-- çalışma alanı yoksa tabloya HİÇ dokunulmaz (mevcut alanlar korunur, bugünkü
-- ve canlı olan 0004 davranışıyla aynı). İstemci ileride BackupData'ya
-- `workspaces` eklerse koşul kendiliğinden açılır; eski yedek dosyaları güvenli
-- yoldan geçmeye devam eder. Ayrıntı: audit/security-audit-2026-08-29.md → F1.
--
-- Idempotent (create or replace). Supabase SQL Editor'de çalıştırın.
-- ============================================================================

create or replace function public.restore_user_backup(payload jsonb, target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ts  timestamptz := now();

  -- {tablo adı, yedek dosyasındaki anahtar}. Sıra ÖNEMLİ: ebeveyn → çocuk.
  -- workspaces en başta — diğer 8 tablonun bölümleme eksenidir.
  spec text[][] := array[
    ['workspaces',              'workspaces'],
    ['categories',              'categories'],
    ['accounts',                'accounts'],
    ['people',                  'people'],
    ['debts',                   'debts'],
    ['recurring_transactions',  'recurringTransactions'],
    ['budgets',                 'budgets'],
    ['transactions',            'transactions'],
    ['investment_transactions', 'investmentTransactions']
  ];

  tbl      text;
  key      text;
  col_list text;   -- "a", "b", "c"
  sel_list text;   -- r."a", r."b", r."c"
  upd_list text;   -- "a" = excluded."a", ...
  i        int;

  -- Yedek dosyası GERÇEKTEN çalışma alanı taşıyor mu? (bkz. aşağıdaki uzun not)
  -- CASE kullanılıyor: SQL'de AND kısa devre yapmayı GARANTİ etmez, oysa CASE
  -- dalları sırayla değerlendirilir — anahtar yokken jsonb_array_length'in
  -- patlamasını bu engeller. Eksik anahtarda `payload -> 'workspaces'` NULL,
  -- jsonb_typeof(NULL) NULL, `NULL = 'array'` NULL → ELSE dalı → false.
  has_workspaces boolean := case
    when jsonb_typeof(payload -> 'workspaces') = 'array'
    then jsonb_array_length(payload -> 'workspaces') > 0
    else false
  end;
begin
  -- Bir kullanıcı yalnızca KENDİ hesabına geri yükleyebilir.
  if uid is null or target_user_id is null or target_user_id <> uid then
    raise exception 'unauthorized: target_user_id must match the authenticated user';
  end if;

  -- ── 1. Mevcut tüm satırları tombstone'la (hard delete YOK) ────────────────
  -- Çocuk → ebeveyn sırası (FK zincirleri devrede olmasa da tutarlı kalsın).
  update public.investment_transactions set deleted_at = ts where user_id = target_user_id;
  update public.transactions            set deleted_at = ts where user_id = target_user_id;
  update public.budgets                 set deleted_at = ts where user_id = target_user_id;
  update public.recurring_transactions  set deleted_at = ts where user_id = target_user_id;
  update public.debts                   set deleted_at = ts where user_id = target_user_id;
  update public.people                  set deleted_at = ts where user_id = target_user_id;
  update public.accounts                set deleted_at = ts where user_id = target_user_id;
  update public.categories              set deleted_at = ts where user_id = target_user_id;

  -- `workspaces` KOŞULLU tombstone'lanır — yedek dosyasında çalışma alanı yoksa
  -- tabloya HİÇ dokunulmaz.
  --
  -- NEDEN: adım 2 yalnızca yedekte BULUNAN satırları diriltir. Koşulsuz
  -- tombstone'da, yedekte `workspaces` anahtarı yoksa
  -- jsonb_populate_recordset(null::workspaces, NULL) sıfır satır döner ve
  -- kullanıcının TÜM çalışma alanları tombstone olarak kalır. Diğer 8 tablonun
  -- geri yüklenen satırları ise hâlâ eski (artık ölü) workspaceId'yi taşır:
  -- istemci açılışta hiç canlı alan bulamayıp YENİ bir varsayılan alan üretir
  -- (src/store/workspace.store.ts:46), rowInWorkspace her satırı eler
  -- (src/lib/workspace-context.ts:50) ve kullanıcı hesaplarını, işlemlerini,
  -- bütçelerini, borçlarını, yatırımlarını TAMAMEN kaybolmuş görür.
  -- RPC hata vermez, rollback tetiklenmez; sorun bir sonraki sayfa yüklemesinde
  -- ortaya çıkar. (Güvenlik denetimi 2026-08-29, bulgu F1.)
  --
  -- Bugünkü istemci (src/lib/backup-sync.ts → BackupData) `workspaces`
  -- anahtarını HENÜZ ÜRETMİYOR, yani bu koşul olmadan HER geri yükleme bu yola
  -- düşerdi. İstemci ileride bu anahtarı üretmeye başlarsa koşul kendiliğinden
  -- açılır ve çalışma alanları da normal şekilde geri yüklenir; eski (anahtarsız)
  -- yedek dosyaları ise güvenli yoldan geçmeye devam eder.
  if has_workspaces then
    update public.workspaces set deleted_at = ts where user_id = target_user_id;
  end if;

  -- ── 2. Yedekteki satırları upsert et (ebeveyn → çocuk), her birini dirilt ──
  for i in 1 .. array_length(spec, 1) loop
    tbl := spec[i][1];
    key := spec[i][2];

    -- Koşullu tombstone'un eşi: yedekte çalışma alanı yoksa bu tabloyu atla.
    -- (Atlanmasa da sıfır satır işlerdi; açık `continue` niyeti görünür kılar.)
    if tbl = 'workspaces' and not has_workspaces then
      continue;
    end if;

    -- Insert edilecek sütunlar: user_id ve deleted_at hariç HEPSİ
    -- (ikisi aşağıda açıkça yazılıyor).
    select
      string_agg(quote_ident(column_name), ', ' order by ordinal_position),
      string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into col_list, sel_list
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = tbl
      and column_name not in ('user_id', 'deleted_at');

    -- Çakışmada güncellenecekler: id de hariç (çakışma anahtarı).
    select string_agg(
             format('%I = excluded.%I', column_name, column_name),
             ', ' order by ordinal_position)
    into upd_list
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = tbl
      and column_name not in ('id', 'user_id', 'deleted_at');

    -- Tablo yoksa/sütunu yoksa sessizce atla (savunma amaçlı).
    if col_list is null then
      continue;
    end if;

    execute format(
      'insert into public.%I (%s, user_id, deleted_at)
       select %s, $1, null
       from jsonb_populate_recordset(null::public.%I, $2 -> %L) as r
       on conflict (id) do update set %s, user_id = excluded.user_id, deleted_at = null',
      tbl, col_list, sel_list, tbl, key, coalesce(upd_list, 'id = excluded.id')
    ) using target_user_id, payload;
  end loop;
end;
$$;

-- Giriş yapmış kullanıcılar çağırabilir (içeride RLS geçerli — security invoker).
grant execute on function public.restore_user_backup(jsonb, uuid) to authenticated;

-- ============================================================================
-- DOĞRULAMA — geri yüklemeyi ÖNCE bir TEST HESABIYLA deneyin
-- ============================================================================
-- ⚠️ SQL Editor'de `auth.uid()` DAİMA NULL DÖNER (editör `postgres` rolüyle
--    çalışır, ortada JWT yoktur). Bu yüzden aşağıdaki sorgular test hesabının
--    UUID'sini AÇIKÇA alır. UUID'yi bulmak için:
--
--      select id, email from auth.users order by created_at desc;
--
--    Sonra her sorguda :uid yerine o UUID'yi yazın, ya da tek seferde:
--
--      \set uid '00000000-0000-0000-0000-000000000000'
--
--    (Aynı sebeple restore_user_backup RPC'si SQL Editor'den ÇAĞRILAMAZ —
--     `unauthorized` fırlatır. Geri yükleme yalnızca uygulama üzerinden yapılır;
--     bu kasıtlı bir korumadır, hata değil.)
--
-- YÖNTEM — iki seçenek
--   A) Aynı projede İKİNCİ BİR TEST HESABI (önerilen, ucuz ve yeterli):
--      RPC zaten `target_user_id = auth.uid()` ile kendi hesabına kilitli ve
--      tablolarda FORCE RLS var, dolayısıyla test hesabının geri yüklemesi
--      gerçek hesabın satırlarına DOKUNAMAZ. Test hesabında hiç satır olmadığı
--      için içe aktarma düz INSERT yolundan geçer — yani 0009'un düzelttiği
--      sütun kaymasının GÖRÜLDÜĞÜ yoldan. Aradığımız test tam olarak budur.
--   B) Ayrı, boş bir Supabase projesi: şema farklılıklarını da yakalar ama
--      supabase_schema.sql + 0001..0010'u baştan uygulamayı gerektirir.
--
-- ADIMLAR
-- 1. Üretimde bu dosyayı çalıştırın. Bu adım VERİYE DOKUNMAZ — yalnızca
--    `create or replace function`. Geri yükleme yapmadığınız sürece davranış
--    değişmez.
-- 2. Uygulamada gerçek hesabınızla: Ayarlar → Yedekler → "Bulut yedeği oluştur",
--    sonra "Yedeği indir" ile JSON'u diske alın.
-- 3. İkinci bir hesap açın (ör. siz+test@...) ve GİZLİ PENCEREDE giriş yapın.
-- 4. Test hesabında: Ayarlar → Yedekler → indirdiğiniz JSON'u içe aktarın.
-- 5. F1 kontrolü — bu sorgu 0'DAN BÜYÜK dönmeli (çalışma alanları hayatta):
--
--      select count(*) from public.workspaces
--       where user_id = :uid and deleted_at is null;
--
--    0 dönerse geri yükleme çalışma alanlarını yok etmiştir: DURUN.
--    Uygulamada işlem listesinin BOŞ görünmesi aynı sorunun belirtisidir.
--
-- 6. Sütun kayması gitti mi — hepsi 0 dönmeli:
--
--      -- Çalışma alanı ayrımı korundu mu?
--      select count(*) from public.transactions
--       where user_id = :uid and deleted_at is null and "workspaceId" is null;
--
--      -- Kategori payları korundu mu? (yedekte payı olan satırlar için)
--      select count(*) from public.transactions
--       where user_id = :uid and deleted_at is null and "categorySplits" is null
--         and id in ( /* yedekteki bölünmüş işlem id'leri */ );
--
--    Onay durumu dağılımı yedekle uyuşmalı (0 beklenmiyor, KARŞILAŞTIRIN):
--      select "approvalStatus", count(*) from public.transactions
--       where user_id = :uid and deleted_at is null group by 1;
--
-- 7. Kayıt sayıları yedek dosyasıyla eşleşmeli:
--      select 'transactions' t, count(*) from public.transactions
--        where user_id = :uid and deleted_at is null
--      union all select 'accounts', count(*) from public.accounts
--        where user_id = :uid and deleted_at is null
--      union all select 'workspaces', count(*) from public.workspaces
--        where user_id = :uid and deleted_at is null;
--
-- 8. Uygulamayı test hesabıyla gezin: çalışma alanı geçişi, bölünmüş işlemler,
--    onay bekleyenler ve yatırım K/Z bağları yerinde mi?
--
-- 9. TEMİZLİK — test hesabının verisini bırakmayın:
--      delete from public.transactions            where user_id = :uid;
--      delete from public.investment_transactions where user_id = :uid;
--      delete from public.budgets                 where user_id = :uid;
--      delete from public.recurring_transactions  where user_id = :uid;
--      delete from public.debts                   where user_id = :uid;
--      delete from public.people                  where user_id = :uid;
--      delete from public.accounts                where user_id = :uid;
--      delete from public.categories              where user_id = :uid;
--      delete from public.workspaces              where user_id = :uid;
--      delete from public.user_backups            where user_id = :uid;
--    Ardından Authentication → Users'tan test hesabını silin
--    (auth.users silinince user_backups zaten cascade ile gider).
--    ⚠️ :uid'in TEST hesabının UUID'si olduğunu iki kez kontrol edin.
-- ============================================================================
