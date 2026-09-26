-- ============================================================================
-- 0023 — Kredi kartı: kesim → son ödeme farkı ve tatil kuralı
--
-- • "dueGapDays": kesimden son ödemeye gün (bankalarda 10; 5464 sayılı Kanun
--   md. 26 alt sınırı). Doluysa son ödeme her ay kesim + fark'tan hesaplanır
--   (24 Ocak → 3 Şubat, 24 Şubat → 6 Mart). Boş = banka kuralı ya da girilen
--   sabit son ödeme günü (src/lib/payments/bank-rules.ts).
-- • "holidayRule": son ödeme hafta sonu / resmi tatile denk gelirse
--   'due' = yalnız son ödeme ilk iş gününe kayar, 'both' = kesim de kayar
--   (VakıfBank). Boş = kart adından tanınan bankanın kuralı.
--
-- Kod yayına çıkmadan ÖNCE uygulanmalı. Idempotent.
-- ============================================================================

alter table public.accounts add column if not exists "dueGapDays"  double precision;
alter table public.accounts add column if not exists "holidayRule" text;

alter table public.accounts drop constraint if exists accounts_holiday_rule_check;
alter table public.accounts add constraint accounts_holiday_rule_check
  check ("holidayRule" is null or "holidayRule" in ('due', 'both'));
