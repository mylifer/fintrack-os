-- ============================================================================
-- 0018 — Vadeli mevduat koşulları (accounts)
--
-- "Vadeli Hesap" (type 'savings') türündeki hesaba yıllık brüt faiz, vade
-- başlangıcı/sonu ve stopaj oranı girilebilir (bkz. src/lib/utils/deposit.ts).
-- İstemci bu sütunları YALNIZ koşul girilmiş hesaplarda yazar; yine de kod
-- yayına çıkmadan ÖNCE çalıştırılmalı — aksi halde vade girilen hesabın
-- buluta yazımı PGRST204 (bilinmeyen sütun) ile reddedilir.
--
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.accounts add column if not exists "depositRate"   double precision;
alter table public.accounts add column if not exists "depositStart"  text;
alter table public.accounts add column if not exists "depositEnd"    text;
alter table public.accounts add column if not exists "depositTaxPct" double precision;
