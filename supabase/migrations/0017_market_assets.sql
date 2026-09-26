-- ============================================================================
-- 0017 — investment_transactions.asset: BIST hissesi ve kripto
--
-- Yeni varlıklar TEFAS fonları gibi ön ekle saklanır: 'BIST:THYAO',
-- 'CRYPTO:BTC' (bkz. src/lib/market.ts). 0003'teki CHECK bunları tanımazsa
-- Supabase upsert'i 4xx ile reddeder ve kayıt yalnız yerel Dexie'de kalır
-- (0003'ün anlattığı sessiz kayıp). Bu yüzden KOD YAYINA ÇIKMADAN ÖNCE
-- çalıştırılmalı.
--
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
    or asset ~ '^BIST:[A-Z0-9]{3,6}$'
    or asset ~ '^CRYPTO:[A-Z0-9]{2,10}$'
  );
