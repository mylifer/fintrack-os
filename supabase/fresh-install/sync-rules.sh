#!/usr/bin/env bash
# Sunucu tarafı eşitleme kurallarını (keep_newer_row, tombstone, RLS, paylaşılan
# çalışma alanı, restore_user_backup) GERÇEK bir Postgres'te iki cihaz / iki
# hesap senaryolarıyla sınar. Supabase'e bağlanmaz; geçici bir veritabanı
# kurup siler.
#
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=… supabase/fresh-install/sync-rules.sh
#
# Kurulum sırası run.sh ile AYNI (şema, 0*.sql glob'u, politikaları yeniden
# kuran 0013/0015/0021). Migration listesi bilerek sabit kodlanmaz: yeni bir
# migration eklendiğinde bu betik onu da kurar.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="fintrack_sync_$$"
psql -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

run() {
  PGOPTIONS='--client-min-messages=error' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null
}

run supabase/fresh-install/supabase-stub.sql
run supabase_schema.sql
for f in supabase/migrations/0*.sql; do run "$f"; done
for f in supabase/migrations/0013_*.sql supabase/migrations/0015_*.sql supabase/migrations/0021_*.sql; do run "$f"; done

echo "→ supabase/fresh-install/sync-rules.sql"
out=$(PGOPTIONS='--client-min-messages=error' psql -q -X -v ON_ERROR_STOP=1 -At -d "$DB" \
  -f supabase/fresh-install/sync-rules.sql 2>&1) || { echo "$out"; echo "sync-rules: BAŞARISIZ"; exit 1; }
echo "$out"
echo "sync-rules: $(grep -c '^ok - ' <<<"$out") kontrol geçti, $(grep -c '^BİLİNEN HATA' <<<"$out") bilinen hata hâlâ mevcut"
