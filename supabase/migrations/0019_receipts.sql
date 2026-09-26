-- ============================================================================
-- 0019 — Fiş / fatura eki (Supabase Storage)
--
-- • transactions."receipt" (jsonb): { path, name, type, size } — dosyanın
--   kendisi Storage'da, satırda yalnız yolu durur.
-- • "receipts" kovası ÖZEL (public = false): dosyaya yalnız sahibi, kısa
--   ömürlü imzalı bağlantıyla erişir. Yol biçimi: <user_id>/<tx_id>-<rastgele>.<uzantı>
--   — politikalar ilk klasörün auth.uid() olmasını şart koşar.
-- • 5 MB sınırı; yalnız JPEG / PNG / WebP / PDF (istemci büyük görselleri
--   yüklemeden önce küçültür).
-- • 0013 ile aynı kural: 2FA açık hesapta aal2 oturumu şart (RESTRICTIVE).
--
-- Hesap silme (delete_my_account) Storage dosyalarını SQL ile silemez —
-- istemci RPC'den önce kullanıcının klasörünü Storage API ile boşaltır
-- (src/lib/receipts.ts → removeAllReceipts).
--
-- Kod yayına çıkmadan ÖNCE çalıştırılmalı. Idempotent.
-- ============================================================================

alter table public.transactions add column if not exists "receipt" jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_select_own on storage.objects;
create policy receipts_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_insert_own on storage.objects;
create policy receipts_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_update_own on storage.objects;
create policy receipts_update_own on storage.objects
  for update to authenticated
  using      (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_delete_own on storage.objects;
create policy receipts_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists receipts_mfa_required on storage.objects;
create policy receipts_mfa_required on storage.objects
  as restrictive for all to authenticated
  using      (bucket_id <> 'receipts' or (select public.mfa_satisfied()))
  with check (bucket_id <> 'receipts' or (select public.mfa_satisfied()));

-- ============================================================================
-- DOĞRULAMA
--   select id, public, file_size_limit from storage.buckets where id = 'receipts';
--   select policyname, permissive, cmd from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and policyname like 'receipts%';
--   → 5 satır (4 PERMISSIVE + 1 RESTRICTIVE)
-- ============================================================================
