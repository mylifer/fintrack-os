-- ============================================================================
-- 0022 — Kart Takvimi: aya özel kesim tarihi
--
-- Kredi kartı ödemesinin ay kaydına (payment_occurrences) o ayın ekstre KESİM
-- tarihi eklenir. Son ödeme tarihi zaten aynı kayıtta ("dueDate"). Boş = kartın
-- varsayılan kesim gününden hesaplanır (src/lib/payments/card-cycles.ts).
-- Bankalar tarihleri hafta sonu / tatile göre ay ay kaydırdığı için.
--
-- Kod yayına çıkmadan ÖNCE uygulanmalı. Idempotent.
-- ============================================================================

alter table public.payment_occurrences add column if not exists "statementDate" text;
