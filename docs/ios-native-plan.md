# FinTrack iOS — native (SwiftUI) uygulama planı

**Durum (2026-09-26):** Karar SwiftUI; henüz kod yok. Bu not, Windows'taki Claude oturumundan
Mac'e devir içindir — Mac'teki oturum buradan devam eder.

## Karar

- Kullanıcı WebView kabuğu (canlı siteyi gösteren Capacitor) **istemedi**: baştan aşağı native,
  mobil için tasarlanmış bir uygulama istiyor. Yayın yok, yalnız kendi iPhone'u.
- **SwiftUI** seçildi (Expo/React Native de değerlendirildi). Şart: telefon uygulaması web'in
  kopyası değil, günlük kullanım için yol arkadaşı. Ağır işler web'de kalır: toplu içe aktarma,
  yedek/geri yükleme, raporlar, kategori yeniden düzenleme, ayarların çoğu.
- Kurulum: Mac'ten Xcode ile telefona doğrudan. Ücretsiz Apple kimliği → 7 günde bir yeniden
  yükleme; 99 $/yıl Apple Developer → 1 yıl.

## İlk aşama

1. Giriş: e-posta + şifre, TOTP iki adımlı doğrulama (web'de var: Ayarlar → Hesap).
2. **Özet:** bu ayın harcaması, hesap bakiyeleri, bütçe durumu.
3. **İşlemler:** liste + arama, satırı kaydırarak düzenle/sil, alttan açılan hızlı ekleme sayfası.
4. **Hesaplar** ve **Bütçeler**.
5. PIN yerine **Face ID** kilidi.

Sonraki aşamalar (sırası kullanıcıyla konuşulacak): yatırımlar, borçlar, abonelikler/tekrarlayanlar,
hedefler, kart takvimi, ana ekran widget'ı.

## Veri kuralları — web ile aynı Supabase

Web ve iOS aynı tablolara yazar; kurallar birebir uyulmazsa kayıtlar birbirini ezer.

- İstemci: [supabase-swift](https://github.com/supabase/supabase-swift), anon anahtar + kullanıcı
  oturumu. RLS kullanıcıyı kendi satırlarıyla sınırlar.
- **Yazma:** satırın tamamı `upsert(onConflict: "id")`, her yazmada `updatedAt` = ISO zaman damgası.
  Sunucudaki `keep_newer_row()` tetikleyicisi (`supabase/migrations/0016_sync_integrity.sql`) eski
  damgalı yazmayı sessizce yok sayar — web'deki 700 satırlık senkron motorunu taşımak gerekmez;
  motorun çoğu çevrimdışı kuyruk (`src/lib/sync/engine.ts`, gerekirse örnek alınır).
- **Silme:** gerçek DELETE yok; `deleted_at` + `updatedAt` damgalanır. Okurken `deleted_at` dolu
  satırlar gösterilmez (`src/lib/sync/tombstone.ts` → `isLive`).
- **Sütun adları karışık:** tırnaklı camelCase (`"updatedAt"`, `"workspaceId"` …) ve snake_case
  (`deleted_at`). Swift `CodingKeys` birebir eşlenmeli. Kaynak: `src/types/index.ts` +
  `supabase/migrations/`. Tablo listesi: `SyncTable` (`src/lib/sync/engine.ts`).
- **Çalışma alanı:** kayıtlar `workspaceId` ile bölümlenir; alanı olmayan eski kayıtlar varsayılan
  alana aittir. Paylaşımlı alanlar var (`0021_workspace_sharing.sql`, `src/lib/workspace-context.ts`)
  — ilk iş bunu okuyup web'in nasıl süzdüğünü birebir uygulamak.
- **Canlı güncelleme:** tablolar `supabase_realtime` yayınında (0016); isteğe bağlı.
- **Hesaplar web ile aynı çıkmalı:** bakiye, bütçe devri, taksit, kart ekstresi vb. `src/lib/utils/*.ts`
  Swift'e taşınırken yanındaki `*.test.ts` dosyalarının girdi/beklenen sonuçları Swift testlerine
  çevrilir.
- **Anahtarlar:** `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` `.env.local`'da
  (git dışı). iOS projesine git dışı bir `.xcconfig` ile verilir; **asla commit edilmez** (repo
  herkese açık).

## Mac kurulumu

1. App Store'dan Xcode; ilk açılışta iOS bileşenlerini indir. Web testleri için Node 22 (isteğe bağlı).
2. `git clone https://github.com/mylifer/fintrack-os.git`
3. `.env.local`'ı Windows'tan kopyala (USB, iCloud Drive vb.; GitHub'a ya da sohbete yapıştırma).
4. Xcode → Settings → Accounts → Apple kimliğini ekle. iPhone'u bağla; telefonda
   Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu.
5. Claude Code'u repo klasöründe aç, ilk mesaj:
   > `docs/ios-native-plan.md`'yi oku ve SwiftUI uygulamasına ilk aşamadan başla.

## Çalışma kuralları (Mac'teki oturum kendi hafızasına kaydetsin)

- Yanıtlar **Türkçe**.
- Her iş ayrı commit; Türkçe mesaj `feat(kapsam): …` + gövde + Co-Authored-By satırı.
  `master`'a push'tan önce onay al (Vercel üretim deploy'unu tetikler).
- Ücretli API/servis önerme; önce sıfır maliyetli seçenekler.
- Migration gerekirse kullanıcı SQL Editor kullanmak istemiyor: Claude `.env.local`'daki veritabanı
  bağlantısıyla uygular — önce yedek, her dosya ayrı transaction, sonra doğrulama; üretime yazmadan
  önce ne yapılacağını söyle. Migration koddan önce uygulanır.
- Aynı klasörde başka bir Claude oturumu çalışıyor olabilir: `git status`'a bak, başkasının
  değişikliklerine dokunma, yalnız kendi dosyalarını commit et.
- Tasarımı simülatörde çalıştırıp ekran görüntüsüyle doğrula.

## Açık kalanlar

- Capacitor kabuğu yalnız Windows PC'de, push edilmemiş `ios-app` dalında
  (`C:\Users\Kaan\Projects\fintrack-os-ios`). SwiftUI ile gereksiz; kullanıcı onaylarsa silinir.
- PWA'da (Safari → Ana Ekrana Ekle) çentik boşluğu sorunu: `statusBarStyle: 'black-translucent'`
  ama `viewport-fit=cover`/`env(safe-area-inset-*)` yok → üst çubuk saat/pilin altında kalır.
  Önerildi, yapılmadı.
- claude.ai'deki "FinTrack OS — Devam Notu" belgesi bu oturumdan okunamadı (erişim reddi); artık
  devir notu bu dosya.
