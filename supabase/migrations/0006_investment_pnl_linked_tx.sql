-- ============================================================================
-- 0006 — investment_transactions.pnlLinkedTransactionId
--
-- Satış kaydının "Satış Kârı/Zararı" P&L defter satırı bugüne kadar yalnızca
-- açıklama metni + tarih eşleşmesiyle bulunup siliniyordu; aynı gün aynı
-- varlıktan iki satış olduğunda yanlış işlemin silinme riski vardı.
-- Yeni satışlarda P&L satırının ID'si bu sütuna yazılır; silme/düzenleme
-- artık ID bağını kullanır. Eski satırlar (sütunu null) için açıklama
-- eşleşmesi fallback olarak korunur — mevcut veriye dokunulmaz.
--
-- ⚠️ Bu migration, alanı yazan kod deploy edilmeden ÖNCE çalıştırılmalıdır;
-- aksi halde sync upsert'leri bilinmeyen sütun nedeniyle 4xx alıp outbox'ı
-- dead-letter'a düşürür (bkz. 0003'teki bilezik olayı).
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.investment_transactions
  add column if not exists "pnlLinkedTransactionId" text;
