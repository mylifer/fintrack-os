-- ============================================================================
-- 0007 — transactions."categorySplits"
--
-- Bir işlem artık birden fazla kategoriye bölünebilir. Paylar
-- [{ "categoryId": "...", "amount": 123.45 }, ...] biçiminde bu sütunda
-- tutulur; toplamları işlemin "amount" değerine kuruşu kuruşuna eşittir.
-- "categoryId" sütunu DEĞİŞMEDEN kalır: bölünmüş satırlarda en büyük payın
-- kategorisini taşır, böylece kategoriye göre okuyan mevcut sorgular, liste
-- görünümleri ve eski raporlar bozulmadan çalışır.
--
-- Mevcut satırlara DOKUNULMAZ: sütun null kalır ve null = "bölünmemiş işlem"
-- demektir (istemci tarafında tek kategori davranışı).
--
-- ⚠️ Bu migration, alanı yazan kod deploy edilmeden ÖNCE çalıştırılmalıdır;
-- aksi halde sync upsert'leri bilinmeyen sütun nedeniyle 4xx alıp outbox'ı
-- dead-letter'a düşürür (bkz. 0003'teki bilezik olayı).
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.transactions
  add column if not exists "categorySplits" jsonb;
