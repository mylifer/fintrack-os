-- ============================================================================
-- 0003 — investment_transactions.asset CHECK kısıtı yeni varlıkları tanımıyor
--
-- Tablo ilk kurulduğunda asset için sabit 8 değerlik bir CHECK konmuştu.
-- Sonradan eklenen varlıklar bu listede olmadığı için Supabase upsert'leri
-- 4xx ile reddediyor; sync outbox'ı 12 denemeden sonra dead-letter'a düşüyor
-- ve kayıt yalnızca yerel Dexie'de kalıyor (kalıcı veri kaybı riski —
-- bilezik alımı olayı, Tem 2026).
--
-- Bu migration kısıtı günceller:
--   • GOLD_BRACELET (22 ayar bilezik, commit 2e0c1d3) eklendi
--   • TEFAS:<KOD> dinamik fon varlıkları (commit 37266f1) prefix ile tanındı
--
-- NOT: src/types'a yeni bir StaticInvestmentAsset eklenirse bu kısıt da
-- güncellenmek ZORUNDA — aksi halde aynı sessiz kayıp tekrarlanır.
-- Idempotent: tekrar çalıştırmak güvenlidir.
-- ============================================================================

alter table public.investment_transactions
  drop constraint if exists investment_transactions_asset_check;

alter table public.investment_transactions
  add constraint investment_transactions_asset_check
  check (
    asset in (
      'GOLD_GRAM', 'GOLD_QUARTER', 'GOLD_HALF', 'GOLD_FULL', 'GOLD_OZ',
      'GOLD_BRACELET',
      'USD', 'EUR', 'GBP'
    )
    or asset like 'TEFAS:%'
  );
