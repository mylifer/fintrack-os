# FinTrack OS

Kişisel finans uygulaması: hesaplar, işlemler, bütçeler, borçlar, yatırımlar, raporlar.
Çevrimdışı öncelikli (offline-first) bir PWA'dır — veri önce tarayıcıdaki IndexedDB'ye
yazılır, bağlantı olduğunda Supabase'e eşitlenir. Arayüz Türkçedir.

Canlı: https://fintrack-os-ten.vercel.app

## Özellikler

- **İşlemler** — gelir/gider/transfer, taksit, çoklu kategori, etiket, alıcı/aile üyesi,
  iade, fiş/fatura eki, otomatik kategori (alıcı geçmişi + anahtar kelime).
- **İçe aktarma** — banka dökümü / kart ekstresi (CSV, `;`/Windows-1254, XLSX), Borç/Alacak
  sütunları, satır bazlı önizleme, mükerrer tespiti, geri alma.
- **Hesaplar** — kredi kartı ekstresi (kesim, son ödeme, asgari), vadeli mevduat (faiz,
  stopaj, vade sonu işleme), bakiye eşitleme.
- **Planlama** — bütçe (devir dahil), birikim hedefleri, borç takibi, ödeme takibi,
  tekrarlayan işlemler (geçmişten öneri), abonelikler (zam tespiti), nakit akışı tahmini.
- **Yatırımlar** — altın/döviz, TEFAS ve BES fonları, BIST hisseleri, kripto; gerçekleşen
  K/Z, yıllık getiri (XIRR), fon stopajı.
- **Raporlar** — dönem kıyası (önceki dönem / geçen yıl), aylık özet, yazdır/PDF.
- **Aile paylaşımı** — varsayılan olmayan bir çalışma alanı davet bağlantısıyla eşle paylaşılır;
  iki hesap da aynı veriyi görür ve düzenler (0021).
- **Güvenlik ve gizlilik** — 2FA (TOTP), tutarları gizle, cihaz PIN kilidi, RLS, özel
  Storage kovası, işlem açıklamaları hiçbir dış servise gönderilmez.
- **Eşitleme** — outbox + son-yazan-kazanır (`updatedAt`), silinen kaydın dirilmemesi,
  Realtime ile cihazlar arası canlı güncelleme.

## Teknoloji

Next.js 16 (App Router, `src/proxy.ts` middleware) · React 19 · TypeScript · Tailwind v4 ·
Zustand · Dexie (IndexedDB) · Supabase (Auth, Postgres + RLS, Realtime, Storage) ·
Recharts · Vitest · Playwright.

> Next.js 16 önceki sürümlerden farklıdır; kod yazmadan önce `node_modules/next/dist/docs/`
> altındaki ilgili rehbere bakın (bkz. `AGENTS.md`).

Ücretli servis kullanılmaz. Fiyat kaynakları ücretsiz ve anahtarsızdır: fawazahmed0
currency-api (kurlar), Truncgil (Kapalıçarşı altını), TEFAS (fonlar), Yahoo Finance
(altın vadelisi, BIST, kripto). Hepsi sunucu tarafında (`src/app/api/prices/*`) çağrılır.

## Kurulum

Gereksinim: Node 22, bir Supabase projesi.

```bash
npm ci
cp .env.example .env.local   # değerleri doldurun
npm run dev                  # http://localhost:3000
```

### Supabase

1. SQL Editor'de `supabase_schema.sql`'i çalıştırın (tablolar, `deleted_at`, RLS).
2. Ardından `supabase/migrations/` altındaki dosyaları **numara sırasıyla** çalıştırın
   (0001 → son). Hepsi idempotenttir; tekrar çalıştırmak güvenlidir.
3. Authentication → URL Configuration:
   - Site URL: uygulamanın adresi
   - Redirect URLs: `https://<adres>/auth/callback**` (şifre sıfırlama ve e-posta onayı)

**Yeni migration'ı her zaman koddan ÖNCE uygulayın.** İstemci yeni sütunları yazmaya
başladığında sütun yoksa bulut yazımı reddedilir ve kayıt yalnız o cihazda kalır.

### Giriş yapmadan yerel deneme

`.env.local`'a `AUTH_BYPASS=1` eklenirse uygulama girişsiz açılır; veri yalnız o
tarayıcının IndexedDB'sinde kalır. Uçtan uca testler bu kipte çalışır. Üretimde yok sayılır.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi / sunucusu |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest birim testleri |
| `npm run test:e2e` | Playwright uçtan uca testleri (`e2e/`) |

CI (`.github/workflows/ci.yml`) her push ve PR'da tip kontrolü, lint, birim testleri,
üretim derlemesi ve uçtan uca testleri çalıştırır. Vercel deploy'u bundan bağımsızdır.

## Mimari

```
src/
  app/(main)/…        sayfalar (giriş gerektirir)      app/api/…  sunucu rotaları
  components/…        arayüz                           proxy.ts   oturum + CSP
  store/…             Zustand store'ları (sayfaların tek veri kaynağı)
  lib/db              Dexie şeması (yerel kopya)
  lib/sync            outbox eşitleme motoru, realtime, onarım
  lib/utils           SAF hesaplar — store/DB bilmez, birim testli
supabase/migrations   sıralı, idempotent SQL
audit/                güvenlik ve hata denetim raporları
```

- **Yazma yolu:** store → `localUpsert/localPatch/localBatch` (Dexie + outbox) →
  `engine.ts` kuyruğu Supabase'e iter. Silme her zaman `deleted_at` (tombstone).
- **Okuma yolu:** `reconcilingPull` bulut + yerel kopyayı birleştirir; çakışmada
  `updatedAt` yeni olan kazanır (sunucuda `keep_newer_row` tetikleyicisi, 0016).
- **Hata kaydı:** üretimde yakalanmamış hatalar ve hata sınırı `error_logs` tablosuna yazılır
  (0020, kullanıcı yalnız ekler; Supabase panelinden okunur, 30 gün tutulur).
- **Hesap kuralları** `lib/utils`'tedir (akış toplamı, bütçe, ekstre, getiri…) ve
  sayfalar arası tutarlılık için tek yerden çağrılır.
