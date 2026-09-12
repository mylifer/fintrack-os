-- ============================================================================
-- 0012 — investment_transactions.taxLinkedTransactionId
--
-- TEFAS fon satışında, gerçekleşen kâr üzerinden hesaplanan STOPAJ artık ayrı
-- bir gider defter satırı olarak yazılıyor ("… Satış Stopajı", Vergi
-- kategorisi). 0006'daki P&L bağıyla aynı desen: satırın ID'si bu sütuna
-- yazılır ki satış silinince/düzenlenince doğru gider satırı kaldırılsın.
-- Bağı olmayan ESKİ satışlar (sütun null) için açıklama+tarih eşleşmesi
-- fallback olarak korunur — mevcut veriye DOKUNULMAZ, geçmiş satışlara
-- geriye dönük stopaj satırı üretilmez.
--
-- ⚠️ Bu migration, alanı yazan kod deploy edilmeden ÖNCE çalıştırılmalıdır;
-- aksi halde sync upsert'leri bilinmeyen sütun nedeniyle 4xx alıp outbox'ı
-- dead-letter'a düşürür (bkz. 0003'teki bilezik olayı, 0006'daki aynı uyarı).
-- Idempotent: tekrar çalıştırmak güvenlidir.
--
-- NOT: restore_user_backup sütun listesini 0009'dan beri şemadan türetiyor,
-- bu yüzden yedek/geri yükleme tarafında ek bir değişiklik GEREKMEZ.
-- ============================================================================

alter table public.investment_transactions
  add column if not exists "taxLinkedTransactionId" text;
