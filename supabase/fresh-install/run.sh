#!/usr/bin/env bash
# Depodaki SQL'in BOŞ bir Postgres'te projeyi sıfırdan kurabildiğini doğrular
# (felaket kurtarma, yeni test projesi). Supabase'e bağlanmaz; yerel/CI
# Postgres'te geçici bir veritabanı oluşturup siler.
#
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=… supabase/fresh-install/run.sh
#
# Sıra supabase_schema.sql başlığındakiyle aynı: önce şema, sonra 0001..N,
# sonra politikaları yeniden kuran 0013 / 0015 / 0021.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="fintrack_fresh_$$"
psql -q -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

run() {
  echo "→ $1"
  # NOTICE/WARNING (ör. wal_level) gürültüsü bastırılır; hata betiği durdurur
  PGOPTIONS='--client-min-messages=error' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null
}

run supabase/fresh-install/supabase-stub.sql
run supabase_schema.sql
for f in supabase/migrations/0*.sql; do run "$f"; done
for f in supabase/migrations/0013_*.sql supabase/migrations/0015_*.sql supabase/migrations/0021_*.sql; do run "$f"; done

echo "→ supabase/fresh-install/checks.sql"
PGOPTIONS='--client-min-messages=error' psql -q -X -v ON_ERROR_STOP=1 -At -d "$DB" \
  -f supabase/fresh-install/checks.sql >/dev/null
echo "fresh-install: TÜM KONTROLLER GEÇTİ"
