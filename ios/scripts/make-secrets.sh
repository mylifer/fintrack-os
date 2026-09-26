#!/bin/sh
# .env.local'daki Supabase anahtarlarından ios/Config/Secrets.xcconfig üretir.
# Çıktı git dışıdır (.gitignore) — repo herkese açık, asla commit etmeyin.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/../../.env.local"
out="$here/../Config/Secrets.xcconfig"

[ -f "$env_file" ] || { echo ".env.local bulunamadı: $env_file" >&2; exit 1; }

value() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
url="$(value NEXT_PUBLIC_SUPABASE_URL)"
key="$(value NEXT_PUBLIC_SUPABASE_ANON_KEY)"
[ -n "$url" ] && [ -n "$key" ] || { echo "NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY eksik" >&2; exit 1; }

# xcconfig'te "//" yorum başlatır: https:// → https:/$()/
escaped="$(printf '%s' "$url" | sed 's#//#/$()/#')"
umask 077
printf '// Üretildi: scripts/make-secrets.sh — COMMIT ETMEYİN\nSUPABASE_URL = %s\nSUPABASE_ANON_KEY = %s\n' "$escaped" "$key" > "$out"
echo "Yazıldı: $out"
