-- ============================================================================
-- Sunucu tarafı eşitleme kuralları — gerçek Postgres'te İKİ CİHAZ / İKİ HESAP
-- senaryoları. sync-rules.sh, şemayı boş bir veritabanına (run.sh ile aynı
-- sırayla) kurduktan SONRA bu dosyayı çalıştırır.
--
-- Her "istemci isteği" ayrı bir transaction'dır (PostgREST gibi): rol
-- `authenticated`, JWT talepleri istek ayarlarından (supabase-stub.sql). Bu
-- önemli — keep_newer_row (0016) aynı transaction'da tombstone'lanan satırı
-- geri yükleme istisnası olarak geçirir; tek bir transaction'a sıkıştırılmış
-- test o istisnaya düşüp yanlış yeşil verirdi.
--
-- Doğrulamalar süper kullanıcıyla (RLS'siz, "gerçek durum") yapılır ve
-- başarısızlıkta hata fırlatır (ON_ERROR_STOP → betik kırmızı biter).
--
-- BİLİNEN HATA blokları `it.fails` karşılığıdır: hatanın HÂLÂ var olduğunu
-- doğrular; hata düzeltilince "XPASS" ile kırmızı olur → bloğu normal bir
-- kontrole çevirin.
-- ============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set C '''cccccccc-0000-0000-0000-00000000000c'''
\set D '''dddddddd-0000-0000-0000-00000000000d'''

-- "Bu kullanıcının cihazından gelen istek" önsözü (transaction içinde)
\set asA 'set local role authenticated; set local request.jwt.claim.sub = ' :A '; set local request.jwt.claims = ''{"email":"a@test","aal":"aal1"}'';'
\set asB 'set local role authenticated; set local request.jwt.claim.sub = ' :B '; set local request.jwt.claims = ''{"email":"b@test","aal":"aal1"}'';'
\set asC 'set local role authenticated; set local request.jwt.claim.sub = ' :C '; set local request.jwt.claims = ''{"email":"c@test","aal":"aal1"}'';'
\set asD 'set local role authenticated; set local request.jwt.claim.sub = ' :D '; set local request.jwt.claims = ''{"email":"d@test","aal":"aal1"}'';'

insert into auth.users values
  (:A, 'a@test'), (:B, 'b@test'), (:C, 'c@test'), (:D, 'd@test');

-- ── Kurulum: A'nın kişisel alanı ve paylaşılacak "Aile" alanı ───────────────
begin; :asA
insert into workspaces (id, user_id, name, "isDefault", "createdAt", "updatedAt") values
  ('wsA-genel', auth.uid(), 'Genel', true,  '2026-01-01', '2026-01-01T00:00:00.000Z'),
  ('wsA-aile',  auth.uid(), 'Aile',  false, '2026-01-01', '2026-01-01T00:00:00.000Z');
commit;

-- ============================================================================
-- 1. keep_newer_row (0016): eski damgalı upsert yeni satırı ezemez
-- ============================================================================
-- İstemcinin push'u: tam satır upsert (engine.ts flushOutbox), user_id dahil.
-- Cihaz 1: k1 @10:00 tutar 100
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k1', auth.uid(), 'expense', 100, 'TRY', '2026-10-01', 'a1', 'ilk', false, '2026-10-01', '2026-10-01T10:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;

-- Cihaz 2 (çevrimdışı kalmış): k1 @09:00 tutar 50 — HATA VERMEDEN yok sayılmalı
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k1', auth.uid(), 'expense', 50, 'TRY', '2026-10-01', 'a1', 'eski cihaz', false, '2026-10-01', '2026-10-01T09:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
do $$ begin
  if (select amount from transactions where id = 'k1') <> 100
     or (select "updatedAt" from transactions where id = 'k1') <> '2026-10-01T10:00:00.000Z' then
    raise exception 'keep_newer_row: eski damgalı upsert yeni satırı ezdi';
  end if;
end $$;
\echo ok - keep_newer_row: eski damgalı upsert hata vermeden yok sayılır

-- Cihaz 2 sonra YENİ bir düzenleme yapar: @11:00 tutar 200 → kazanır
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k1', auth.uid(), 'expense', 200, 'TRY', '2026-10-01', 'a1', 'yeni', false, '2026-10-01', '2026-10-01T11:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
do $$ begin
  if (select amount from transactions where id = 'k1') <> 200 then
    raise exception 'keep_newer_row: daha yeni damgalı upsert uygulanmadı';
  end if;
end $$;
\echo ok - keep_newer_row: daha yeni damgalı upsert kazanır

-- Eşit damga: karşılaştırma katı (`<`), yani SONRA VARAN kazanır. İstemci
-- stampAfter ile aynı cihazda eşit damga üretmez; iki cihazın aynı
-- milisaniyeyi üretmesi pratikte nadir. Davranış burada SABİTLENİR.
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k1', auth.uid(), 'expense', 300, 'TRY', '2026-10-01', 'a1', 'eşit damga', false, '2026-10-01', '2026-10-01T11:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
do $$ begin
  if (select amount from transactions where id = 'k1') <> 300 then
    raise exception 'keep_newer_row: eşit damgada davranış değişti (beklenen: sonra varan kazanır)';
  end if;
end $$;
\echo ok - keep_newer_row: eşit damgada sonra varan kazanır (karakterizasyon)

-- Damgasız gelen yazma (0016 öncesi istemci) korumayı atlar: "damgalardan
-- biri yoksa davranış değişmez" (0016 başlığı). Sabitlenir.
begin; :asA
update transactions set amount = 1, "updatedAt" = null where id = 'k1';
commit;
do $$ begin
  if (select amount from transactions where id = 'k1') <> 1 then
    raise exception 'keep_newer_row: damgasız yazmada davranış değişti';
  end if;
end $$;
\echo ok - keep_newer_row: damgasız yazma korumayı atlar (karakterizasyon)

-- ============================================================================
-- 2. Tombstone: silinmiş satır eski bir düzenlemeyle dirilmez
-- ============================================================================
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k2', auth.uid(), 'expense', 75, 'TRY', '2026-10-02', 'a1', 'silinecek', false, '2026-10-02', '2026-10-02T10:00:00.000Z', null, 'wsA-genel');
commit;
-- Cihaz 1 siler (softDelete → deleted_at + yeni damga, UPDATE olarak gider)
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k2', auth.uid(), 'expense', 75, 'TRY', '2026-10-02', 'a1', 'silinecek', false, '2026-10-02', '2026-10-02T12:00:00.000Z', '2026-10-02T12:00:00Z', 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
-- Cihaz 2'nin silmeden ÖNCE yaptığı düzenleme (deleted_at = null snapshot) geç varır
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k2', auth.uid(), 'expense', 999, 'TRY', '2026-10-02', 'a1', 'eski düzenleme', false, '2026-10-02', '2026-10-02T11:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
do $$ begin
  if (select deleted_at from transactions where id = 'k2') is null then
    raise exception 'tombstone: silinmiş satır eski düzenlemeyle dirildi';
  end if;
  if (select amount from transactions where id = 'k2') <> 75 then
    raise exception 'tombstone: eski düzenleme silinmiş satırın alanlarını değiştirdi';
  end if;
end $$;
\echo ok - tombstone: eski düzenleme silinmiş satırı diriltmez

-- Silmeden SONRA yapılan düzenleme ise diriltir ("sonra YAPILAN kazanır" —
-- 0016 §2; aynı id ile yeniden oluşturma da bu yoldan çalışır).
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", deleted_at, "workspaceId")
values ('k2', auth.uid(), 'expense', 80, 'TRY', '2026-10-02', 'a1', 'yeniden', false, '2026-10-02', '2026-10-02T13:00:00.000Z', null, 'wsA-genel')
on conflict (id) do update set amount = excluded.amount, description = excluded.description,
  "updatedAt" = excluded."updatedAt", deleted_at = excluded.deleted_at, user_id = excluded.user_id;
commit;
do $$ begin
  if (select deleted_at from transactions where id = 'k2') is not null
     or (select amount from transactions where id = 'k2') <> 80 then
    raise exception 'tombstone: silmeden sonra yapılan düzenleme uygulanmadı';
  end if;
end $$;
\echo ok - tombstone: silmeden sonra yapılan düzenleme diriltir (karakterizasyon)

-- Aynı-transaction istisnası YALNIZ o transaction'da geçerli: ayrı istekte
-- (yukarıdaki k2 akışı) devreye girmediği zaten doğrulandı; burada istisnanın
-- kendisi — geri yükleme adım 1 + adım 2 deseni — çalışıyor mu:
begin; :asA
update transactions set deleted_at = now() where id = 'k2';
update transactions set deleted_at = null, amount = 81, "updatedAt" = '2026-01-01T00:00:00.000Z' where id = 'k2';
commit;
do $$ begin
  if (select amount from transactions where id = 'k2') <> 81 or (select deleted_at from transactions where id = 'k2') is not null then
    raise exception 'keep_newer_row: aynı transaction''daki geri yükleme istisnası çalışmıyor';
  end if;
end $$;
\echo ok - keep_newer_row: aynı transaction’da tombstone + eski sürüm geçer (geri yükleme istisnası)

-- ============================================================================
-- 3. RLS: hesaplar arası yalıtım
-- ============================================================================
begin; :asB
do $$
declare n int;
begin
  if (select count(*) from transactions) <> 0 or (select count(*) from workspaces) <> 0 then
    raise exception 'RLS: B, A''nın satırlarını okuyabiliyor';
  end if;
  update transactions set amount = 0 where id = 'k1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS: B, A''nın satırını UPDATE edebildi'; end if;
  delete from transactions where id = 'k1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS: B, A''nın satırını silebildi'; end if;
end $$;
commit;

-- B, A'nın satır kimliğiyle upsert (bayat paylaşımlı tarayıcı — repair.ts'nin
-- "takılı kategori" senaryosu): RLS hatası, satır değişmez
begin; :asB
do $$ begin
  insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", "workspaceId")
  values ('k1', auth.uid(), 'expense', 5, 'TRY', '2026-10-01', 'a1', 'B ezmeye çalışıyor', false, '2026-10-01', '2099-01-01T00:00:00.000Z', null)
  on conflict (id) do update set amount = excluded.amount, user_id = excluded.user_id, "updatedAt" = excluded."updatedAt";
  raise exception 'RLS: B, A''nın satırını upsert ile ezebildi';
exception when insufficient_privilege then null;
end $$;
-- user_id'yi A olarak yazmak da reddedilir
do $$ begin
  insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt")
  values ('b-sahte', 'aaaaaaaa-0000-0000-0000-00000000000a', 'expense', 5, 'TRY', '2026-10-01', 'a1', 'x', false, '2026-10-01');
  raise exception 'RLS: B, A adına satır ekleyebildi';
exception when insufficient_privilege then null;
end $$;
-- Paylaşılmamış alanın kimliğini bilerek oraya yazmak: satır B'nin kalır,
-- A'ya SIZMAZ (A görmez)
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "workspaceId")
values ('b-sizinti', auth.uid(), 'expense', 5, 'TRY', '2026-10-01', 'a1', 'A''nın alanına', false, '2026-10-01', 'wsA-aile');
commit;
do $$ begin
  if (select amount from transactions where id = 'k1') <> 1 then
    raise exception 'RLS: A''nın satırı B''nin isteğiyle değişti';
  end if;
  if (select user_id from transactions where id = 'b-sizinti') <> 'bbbbbbbb-0000-0000-0000-00000000000b' then
    raise exception 'RLS: B''nin yazdığı satırın sahipliği değişti';
  end if;
end $$;
begin; :asA
do $$ begin
  if exists (select 1 from transactions where id = 'b-sizinti') then
    raise exception 'RLS: B''nin satırı A''nın (paylaşılmamış) alanında A''ya göründü';
  end if;
end $$;
commit;
\echo ok - RLS: B, A’nın satırlarını okuyamaz / güncelleyemez / silemez / upsert ile ezemez

-- ============================================================================
-- 4. Paylaşılan çalışma alanı (0021): editör okur/yazar, çıkarılınca kesilir
-- ============================================================================
begin; :asA
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", "workspaceId")
values ('s1', auth.uid(), 'expense', 40, 'TRY', '2026-10-05', 'a1', 'aile market', false, '2026-10-05', '2026-10-05T10:00:00.000Z', 'wsA-aile');
select public.create_workspace_invite('wsA-aile') as token \gset
commit;

-- Paylaşım başlarken alana önceden yerleştirilmiş yabancı satır temizlenir
do $$ begin
  if exists (select 1 from transactions where id = 'b-sizinti') then
    raise exception 'paylaşım: başka hesabın alana yerleştirdiği satır paylaşım başlarken silinmedi';
  end if;
end $$;
\echo ok - paylaşım: alana önceden yerleştirilmiş yabancı satır paylaşım başlarken silinir

-- C (davetsiz) paylaşılan alana yazmaya çalışır: tetikleyici sahipliği A'ya
-- çevirir, WITH CHECK reddeder
begin; :asC
do $$ begin
  insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "workspaceId")
  values ('c-sizma', auth.uid(), 'expense', 1, 'TRY', '2026-10-05', 'a1', 'davetsiz', false, '2026-10-05', 'wsA-aile');
  raise exception 'RLS: üye olmayan C paylaşılan alana satır ekleyebildi';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  if (select count(*) from transactions) <> 0 then raise exception 'RLS: üye olmayan C paylaşılan alanı görüyor'; end if;
end $$;
commit;
\echo ok - paylaşım: üye olmayan paylaşılan alanı göremez, yazamaz

begin; :asB
select public.accept_workspace_invite(:'token') \gset
do $$
declare n int;
begin
  -- Yalnız paylaşılan alanı görür; A'nın kişisel alanındaki k1/k2'yi değil
  if (select string_agg(id, ',' order by id) from transactions) is distinct from 's1' then
    raise exception 'paylaşım: editör yanlış satır kümesini görüyor: %', (select string_agg(id, ',' order by id) from transactions);
  end if;
  if not exists (select 1 from workspaces where id = 'wsA-aile') or exists (select 1 from workspaces where id = 'wsA-genel') then
    raise exception 'paylaşım: editör alan satırlarını yanlış görüyor';
  end if;
  update transactions set amount = 45, "updatedAt" = '2026-10-05T11:00:00.000Z' where id = 's1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'paylaşım: editör paylaşılan satırı düzenleyemedi'; end if;
end $$;
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", "workspaceId")
values ('s2', auth.uid(), 'expense', 12, 'TRY', '2026-10-06', 'a1', 'B ekledi', false, '2026-10-06', '2026-10-06T10:00:00.000Z', 'wsA-aile');
commit;
do $$ begin
  if (select amount from transactions where id = 's1') <> 45 then raise exception 'paylaşım: editör düzenlemesi kaydedilmedi'; end if;
  if (select user_id from transactions where id = 's2') <> 'aaaaaaaa-0000-0000-0000-00000000000a' then
    raise exception 'paylaşım: editörün eklediği satırın sahibi alan sahibi değil';
  end if;
end $$;
\echo ok - paylaşım: editör okur, düzenler, ekler; satırlar alan sahibinde kalır

-- Editör de eski damgayla ezemez (keep_newer_row paylaşılan alanda da geçerli)
begin; :asB
update transactions set amount = 1, "updatedAt" = '2026-10-05T09:00:00.000Z' where id = 's1';
commit;
do $$ begin
  if (select amount from transactions where id = 's1') <> 45 then raise exception 'paylaşım: editörün eski damgalı yazması kazandı'; end if;
end $$;
\echo ok - paylaşım: editörün eski damgalı yazması yok sayılır

-- Editör alan satırını (ad vb.) değiştiremez — yalnız sahip
begin; :asB
do $$
declare n int;
begin
  update workspaces set name = 'ele geçirildi' where id = 'wsA-aile';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'paylaşım: editör alan satırını düzenleyebildi'; end if;
end $$;
commit;
\echo ok - paylaşım: editör çalışma alanı satırını düzenleyemez

-- #R1 (0026): alan taşıması satırın sahipliğini değiştiremez. Eskiden iki
-- alanın editörü A'nın satırını C'nin alanına taşıyabiliyordu;
-- set_workspace_owner user_id'yi C'ye çeviriyor, A satırı kaybediyordu.
begin; :asC
insert into workspaces (id, user_id, name, "isDefault", "createdAt") values ('wsC-ortak', auth.uid(), 'C ortak', false, '2026-01-01');
select public.create_workspace_invite('wsC-ortak') as token_c \gset
commit;
begin; :asB
select public.accept_workspace_invite(:'token_c') \gset
do $$ begin
  update transactions set "workspaceId" = 'wsC-ortak' where id = 's2';
  raise exception 'R1: editör A''nın satırını C''nin alanına taşıyabildi';
exception when insufficient_privilege then null;
end $$;
commit;
do $$ begin
  if (select user_id from transactions where id = 's2') <> 'aaaaaaaa-0000-0000-0000-00000000000a'
     or (select "workspaceId" from transactions where id = 's2') <> 'wsA-aile' then
    raise exception 'R1: taşıma reddedildi ama satır değişti';
  end if;
end $$;
\echo ok - taşıma: editör satırı başka sahibin alanına taşıyamaz (sahiplik devri yok)

-- Meşru taşımalar bozulmadı: sahip kendi alanları arasında; editör AYNI
-- sahibin iki paylaşılan alanı arasında
begin; :asA
insert into workspaces (id, user_id, name, "isDefault", "createdAt") values ('wsA-is', auth.uid(), 'İş', false, '2026-01-01');
select public.create_workspace_invite('wsA-is') as token_is \gset
update transactions set "workspaceId" = 'wsA-aile' where id = 'k1';
commit;
do $$ begin
  if (select "workspaceId" from transactions where id = 'k1') <> 'wsA-aile' then raise exception 'taşıma: sahip kendi satırını kendi alanına taşıyamadı'; end if;
end $$;
begin; :asA
update transactions set "workspaceId" = 'wsA-genel' where id = 'k1';
commit;
begin; :asB
select public.accept_workspace_invite(:'token_is') \gset
update transactions set "workspaceId" = 'wsA-is' where id = 's2';
update transactions set "workspaceId" = 'wsA-aile' where id = 's2';
commit;
do $$ begin
  if (select "workspaceId" from transactions where id = 'k1') <> 'wsA-genel' then raise exception 'taşıma: sahip satırı paylaşılan alandan geri alamadı'; end if;
  if (select "workspaceId" from transactions where id = 's2') <> 'wsA-aile'
     or (select user_id from transactions where id = 's2') <> 'aaaaaaaa-0000-0000-0000-00000000000a' then
    raise exception 'taşıma: editör aynı sahibin alanları arasında taşıyamadı';
  end if;
end $$;
\echo ok - taşıma: sahip kendi alanları arasında, editör aynı sahibin paylaşılan alanları arasında taşıyabilir

-- Sahip editörü çıkarır → erişim anında kesilir (kendi eklediği s2 dahil)
begin; :asA
delete from workspace_members where workspace_id = 'wsA-aile' and user_id = 'bbbbbbbb-0000-0000-0000-00000000000b';
commit;
begin; :asB
do $$
declare n int;
begin
  if exists (select 1 from transactions where "workspaceId" = 'wsA-aile') then
    raise exception 'paylaşım: çıkarılan editör hâlâ alanın satırlarını görüyor';
  end if;
  if exists (select 1 from workspaces where id = 'wsA-aile') then
    raise exception 'paylaşım: çıkarılan editör hâlâ alanı görüyor';
  end if;
  update transactions set amount = 0 where id in ('s1', 's2');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'paylaşım: çıkarılan editör satırları düzenleyebildi'; end if;
end $$;
-- Bayat cihazdan upsert (kuyrukta kalmış yazma) → RLS hatası
do $$ begin
  insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", "workspaceId")
  values ('s1', auth.uid(), 'expense', 0, 'TRY', '2026-10-05', 'a1', 'bayat', false, '2026-10-05', '2099-01-01T00:00:00.000Z', 'wsA-aile')
  on conflict (id) do update set amount = excluded.amount, user_id = excluded.user_id, "updatedAt" = excluded."updatedAt";
  raise exception 'paylaşım: çıkarılan editör bayat upsert ile satırı ezebildi';
exception when insufficient_privilege then null;
end $$;
-- Yeni satır da eklenemez
do $$ begin
  insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "workspaceId")
  values ('s3', auth.uid(), 'expense', 1, 'TRY', '2026-10-07', 'a1', 'çıkarıldıktan sonra', false, '2026-10-07', 'wsA-aile');
  raise exception 'paylaşım: çıkarılan editör alana satır ekleyebildi';
exception when insufficient_privilege then null;
end $$;
commit;
do $$ begin
  if (select amount from transactions where id = 's1') <> 45 then raise exception 'paylaşım: çıkarılan editörün yazması satırı değiştirdi'; end if;
end $$;
\echo ok - paylaşım: çıkarılan editör okuyamaz, düzenleyemez, upsert/insert edemez

-- ============================================================================
-- 5. restore_user_backup (0009): gidiş-dönüş, tüm sütunlar, çalışma alanları
-- ============================================================================
-- Yedek satırları ŞEMADAN üretilir: her sütun (user_id/deleted_at hariç) NULL
-- OLMAYAN bir değer alır. Böylece tabloya ileride eklenen bir sütun da
-- otomatik kapsanır — "sütun kayması" (denetim #1) bir daha sessiz kalamaz.
create function pg_temp.sample_row(tbl text, rid text, ws text) returns jsonb
language plpgsql as $$
declare
  c record;
  o jsonb := '{}'::jsonb;
  v jsonb;
begin
  for c in
    select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = tbl
       and column_name not in ('user_id', 'deleted_at')
     order by ordinal_position
  loop
    v := case
      when c.column_name = 'id'              then to_jsonb(rid)
      when c.column_name = 'workspaceId'     then to_jsonb(ws)
      when c.column_name = 'updatedAt'       then to_jsonb('2026-06-01T00:00:00.000Z'::text)
      when c.column_name = 'approvalStatus'  then to_jsonb('pending'::text)
      when c.column_name = 'asset'           then to_jsonb('USD'::text)
      when c.column_name = 'holidayRule'     then to_jsonb('due'::text)
      when c.column_name = 'isDefault'       then to_jsonb(rid like '%1')
      when c.data_type = 'text'              then to_jsonb(c.column_name || ':' || rid)
      when c.data_type in ('double precision', 'numeric', 'integer', 'bigint', 'real', 'smallint')
                                             then to_jsonb(7.5)
      when c.data_type = 'boolean'           then 'true'::jsonb
      when c.data_type = 'jsonb'             then jsonb_build_array(jsonb_build_object('categoryId', 'c', 'amount', 1))
      when c.data_type = 'ARRAY'             then '["kw"]'::jsonb
      when c.data_type like 'timestamp%'     then to_jsonb('2026-06-01T08:00:00+00:00'::text)
      when c.data_type = 'date'              then to_jsonb('2026-06-01'::text)
      else to_jsonb(c.column_name || ':' || rid)
    end;
    o := o || jsonb_build_object(c.column_name, v);
  end loop;
  return o;
end $$;

-- spec'teki 9 tablo × (yedek anahtarı)
create temp table rb_spec (tbl text, key text);
insert into rb_spec values
  ('workspaces', 'workspaces'), ('categories', 'categories'), ('accounts', 'accounts'),
  ('people', 'people'), ('debts', 'debts'), ('recurring_transactions', 'recurringTransactions'),
  ('budgets', 'budgets'), ('transactions', 'transactions'), ('investment_transactions', 'investmentTransactions');

-- D'nin buluttaki mevcut durumu: yedekte OLMAYAN alan + işlem, yedekteki bir
-- işlemin DAHA YENİ damgalı sürümü, ve RPC'nin bilmediği tasarruf hedefi
begin; :asD
insert into workspaces (id, user_id, name, "isDefault", "createdAt", "updatedAt") values
  ('wsD-eski', auth.uid(), 'Eski', false, '2026-01-01', '2026-01-01T00:00:00.000Z'),
  ('rb-ws-1',  auth.uid(), 'bulut sürümü', true, '2026-01-01', '2026-09-01T00:00:00.000Z');
insert into transactions (id, user_id, type, amount, currency, date, "accountId", description, "isInstallment", "createdAt", "updatedAt", "workspaceId") values
  ('d-yedekte-yok', auth.uid(), 'expense', 9, 'TRY', '2026-10-01', 'a1', 'yedekte yok', false, '2026-10-01', '2026-10-01T00:00:00.000Z', 'wsD-eski'),
  ('rb-transactions-1', auth.uid(), 'expense', 1, 'TRY', '2026-10-01', 'a1', 'bulutta daha yeni', false, '2026-10-01', '2026-10-01T00:00:00.000Z', 'rb-ws-1');
insert into savings_goals (id, user_id, name, "targetAmount", "updatedAt") values ('d-hedef', auth.uid(), 'Tatil', 1000, '2026-10-01T00:00:00.000Z');
commit;

-- Yedek: her tabloda iki canlı satır (rb-<tbl>-1/2, alan rb-ws-2) + işlemlerde
-- bir tombstone'lu satır (eski yedek dosyası deseni → ölü kalmalı)
select jsonb_object_agg(s.key, (
         select jsonb_agg(pg_temp.sample_row(s.tbl, 'rb-' || s.tbl || '-' || n, case when s.tbl = 'workspaces' then null else 'rb-ws-2' end))
           from generate_series(1, 2) n))
  || jsonb_build_object('transactions', (
         select jsonb_agg(pg_temp.sample_row('transactions', 'rb-transactions-' || n, 'rb-ws-2'))
           from generate_series(1, 2) n)
         || jsonb_build_array(pg_temp.sample_row('transactions', 'rb-transactions-olu', 'rb-ws-2')
                              || '{"deleted_at":"2026-05-01T00:00:00+00:00"}'))
  as payload
from rb_spec s \gset
-- workspaces satırı workspaceId taşımaz, sample_row onu üretmez; kimlikleri
-- yedekteki alan kimliklerine (rb-ws-1/2) çevir
select replace(:'payload', 'rb-workspaces-', 'rb-ws-') as payload \gset

begin; :asD
select public.restore_user_backup(:'payload'::jsonb, auth.uid()) \gset
commit;

-- 5a. Her tablo, her satır, her sütun yedekteki değerle aynı
select set_config('rb.payload', :'payload', false) \gset
do $$
declare
  p jsonb := current_setting('rb.payload')::jsonb;
  s record;
  r jsonb;
  got jsonb;
  want jsonb;
  k text;
  bad text[] := '{}';
begin
  for s in select * from rb_spec loop
    for r in select * from jsonb_array_elements(p -> s.key) loop
      execute format('select to_jsonb(t) from public.%I t where id = $1', s.tbl) into got using r ->> 'id';
      if got is null then
        bad := bad || format('%s/%s: satır yok', s.tbl, r ->> 'id');
        continue;
      end if;
      -- Yükü sütun tiplerine normalize et (timestamptz vb. biçim farkı olmasın)
      execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', s.tbl) into want using r;
      for k in select jsonb_object_keys(r) loop
        if k = 'deleted_at' then continue; end if;
        if (got -> k) is distinct from (want -> k) then
          bad := bad || format('%s/%s.%s: bulut=%s yedek=%s', s.tbl, r ->> 'id', k, got -> k, want -> k);
        end if;
      end loop;
      if got ->> 'user_id' <> 'dddddddd-0000-0000-0000-00000000000d' then
        bad := bad || format('%s/%s: user_id çağırana zorlanmadı', s.tbl, r ->> 'id');
      end if;
      if (r ? 'deleted_at') <> (got ->> 'deleted_at' is not null) then
        bad := bad || format('%s/%s: deleted_at yanlış (yedekte %s, bulutta %s)', s.tbl, r ->> 'id', r -> 'deleted_at', got -> 'deleted_at');
      end if;
    end loop;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'restore_user_backup gidiş-dönüşte veri bozdu:%', E'\n  ' || array_to_string(bad, E'\n  ');
  end if;
end $$;
\echo ok - restore_user_backup: 9 tablo, tüm sütunlar gidiş-dönüşte korunur, user_id zorlanır

do $$ begin
  -- Yedekteki tombstone'lu satır dirilmez (0009 F7)
  if (select deleted_at from transactions where id = 'rb-transactions-olu') is null then
    raise exception 'restore: yedekteki silinmiş satır dirildi';
  end if;
  -- Buluttaki daha yeni damgalı sürüm yedekle DEĞİŞİR (keep_newer_row istisnası)
  if (select description from transactions where id = 'rb-transactions-1') = 'bulutta daha yeni' then
    raise exception 'restore: keep_newer_row geri yüklemeyi engelledi (aynı transaction istisnası çalışmıyor)';
  end if;
  -- Yedekte olmayanlar silinmiş (tombstone) olarak kalır — hard delete YOK
  if (select deleted_at from transactions where id = 'd-yedekte-yok') is null then
    raise exception 'restore: yedekte olmayan işlem canlı kaldı';
  end if;
  if (select deleted_at from workspaces where id = 'wsD-eski') is null then
    raise exception 'restore: yedekte olmayan çalışma alanı canlı kaldı';
  end if;
  -- Yedekteki alanlar canlı (F1: alanlar kaybolmaz)
  if (select count(*) from workspaces where user_id = 'dddddddd-0000-0000-0000-00000000000d' and deleted_at is null) <> 2 then
    raise exception 'restore: yedekteki çalışma alanları canlı değil';
  end if;
  -- RPC'nin bilmediği tablo (savings_goals) DOKUNULMADAN kalır — istemci
  -- onu outbox üzerinden değiştirir (0015 notu)
  if (select deleted_at from savings_goals where id = 'd-hedef') is not null then
    raise exception 'restore: RPC tablo listesinde olmayan savings_goals''a dokundu';
  end if;
end $$;
\echo ok - restore_user_backup: tombstone’lu yedek satırı ölü kalır, yedekte olmayanlar tombstone’lanır, alanlar canlı

-- 5b. Eski yedek dosyası (workspaces anahtarı YOK): alanlara dokunulmaz (F1)
begin; :asD
select public.restore_user_backup(jsonb_build_object(
  'accounts', jsonb_build_array(jsonb_build_object('id', 'd-eski-yedek-hesap', 'name', 'Eski', 'workspaceId', 'rb-ws-2'))),
  auth.uid()) \gset
commit;
do $$ begin
  if (select count(*) from workspaces where user_id = 'dddddddd-0000-0000-0000-00000000000d' and deleted_at is null) <> 2 then
    raise exception 'restore: workspaces anahtarı olmayan yedek çalışma alanlarını öldürdü (F1 geri geldi)';
  end if;
  if (select deleted_at from transactions where id = 'rb-transactions-2') is null then
    raise exception 'restore: yedekte olmayan işlem (eski yedek) tombstone''lanmadı';
  end if;
end $$;
\echo ok - restore_user_backup: workspaces anahtarı olmayan eski yedek alanlara dokunmaz

-- 5c. Başka hesaba geri yükleme reddedilir
begin; :asB
do $$ begin
  perform public.restore_user_backup('{}'::jsonb, 'dddddddd-0000-0000-0000-00000000000d');
  raise exception 'restore: B, D''nin hesabına geri yükleme yapabildi';
exception when raise_exception then
  if sqlerrm not like 'unauthorized%' then raise; end if;
end $$;
commit;
\echo ok - restore_user_backup: başka hesaba geri yükleme reddedilir

-- 5d. Paylaşılan alan: EDİTÖRÜN geri yüklemesi (adım 1 "user_id = ben" ile
-- tombstone'lar) alan sahibinin paylaşılan satırlarına dokunmamalı.
begin; :asA
select public.create_workspace_invite('wsA-aile') as token2 \gset
commit;
begin; :asB
select public.accept_workspace_invite(:'token2') \gset
commit;
begin; :asB
select public.restore_user_backup('{"transactions":[]}'::jsonb, auth.uid()) \gset
commit;
do $$ begin
  if (select deleted_at from transactions where id = 's1') is not null then
    raise exception 'restore: editörün geri yüklemesi sahibin paylaşılan satırını sildi';
  end if;
end $$;
\echo ok - restore_user_backup: editörün geri yüklemesi paylaşılan alandaki sahip verisine dokunmaz
