# Güvenlik Denetimi Prompt'u — FinTrack OS

> Yeni bir Claude Code oturumunda aşağıdaki bloğu olduğu gibi yapıştır.

---

Bu depoda (`fintrack-os`) **saldırgan bakış açılı bir güvenlik denetimi** yap. Sen kod yazan değil, kodu kırmaya çalışan taraftasın. Amacın: gerçekten sömürülebilir açıkları kanıtla, teorik liste üretme.

## Uygulamanın gerçek tehdit modeli — önce bunu içselleştir

Bu bir **offline-first kişisel/aile finans PWA'sı**. Mimari "kalın istemci + ince backend":

- Tüm iş mantığı tarayıcıda (`src/lib/**`, Zustand store'ları, Dexie/IndexedDB).
- Bulut kaynağı Supabase (PostgREST + Auth + RPC). **Yetkilendirmenin tek gerçek sınırı Postgres RLS'tir** — `supabase/migrations/*.sql` ve `supabase_schema.sql`.
- Next.js sunucu tarafı sadece: `src/proxy.ts` (auth kapısı + güvenlik başlıkları + nonce'lu CSP) ve `src/app/api/**` altındaki 4 salt-okunur piyasa-verisi route'u.
- Server Action yok, kullanıcı verisi yazan sunucu endpoint'i yok.

Bu yüzden **klasik OWASP checklist'ini körlemesine uygulama.** Bu mimaride asıl risk şurada:

1. **RLS boşlukları** — `user_id = auth.uid()` eksik/yanlış olan tablo, policy, view, RPC veya yeni sütun. `FORCE RLS` unutulmuş tablo. `security definer` fonksiyon. Yeni migration'larda (`0006`, `0007`, `0008`, `0009`) eklenen her tablo/sütun/kısıt için ayrıca kontrol et.
2. **Kiracı (tenant) sızıntısı istemcide** — paylaşılan cihazda kullanıcı değişince yerel IndexedDB verisinin sızması. `src/lib/sync/engine.ts` içindeki `ownerId` etiketleme ve `guardUserSwitch`, `src/lib/auth.ts` içindeki çıkış/kullanıcı-değişimi temizliği, `src/lib/sync/repair.ts` ve `src/lib/sync/sanitize.ts`. Outbox'ta bir kullanıcının mutasyonunun başka kullanıcının oturumuyla flush edilmesi mümkün mü?
3. **Backup/restore RPC** — `supabase/migrations/0001`, `0004`, `0005`, `0009` ve `src/lib/backup-sync.ts` + `src/components/backup/BackupManager.tsx`. Bu yol atomik "sil ve yeniden yaz" yapıyor. Kötü/şişkin/hileli bir yedek dosyası ne yapabilir? `validateBackup` neyi kaçırıyor? Başkasının satırlarını yazmak ya da kendi verisini beklenmedik şekilde yok etmek mümkün mü?
4. **API route'ları** — `src/app/api/brand-logo`, `prices`, `prices/tefas`, `prices/history`. SSRF (host/şema gerçekten sabit mi, upstream'den gelen değer URL'e enterpole ediliyor mu), sınırsız cache'in bellek şişirmesi, rate-limit yokluğu, upstream JSON'un doğrulanmadan istemciye geçmesi.
5. **CSP / başlıklar** — `src/proxy.ts` ve `next.config.ts`. CSP şu an **Report-Only**; bunu belirt ve "enforce"a geçişi engelleyen somut şeyleri (nonce'suz inline script'ler, `style-src 'unsafe-inline'`) listele. Proxy `matcher`'ı tüm korumalı yolları gerçekten kapsıyor mu — atlatılabilecek bir yol var mı?
6. **Sır sızıntısı** — `NEXT_PUBLIC_*` içine girmiş anahtarlar, `service_role` kullanımı, git'e girmiş `.env`, istemci bundle'ına gömülü token. `.gitignore`'u ve git geçmişini de kontrol et.
7. **İstemci tarafı XSS/DOM sink'leri** — `dangerouslySetInnerHTML`, `innerHTML`, dinamik `href`/`src` (kullanıcının girdiği alıcı adı, not, kategori adı, CSV'den gelen alan). Özellikle `src/lib/utils/csv.ts` içindeki CSV import/export yolunda **CSV formula injection** (`=`, `+`, `-`, `@` ile başlayan hücreler).
8. **Servis worker** — `public/sw.js`. Neyi cache'liyor? Kimliği doğrulanmış bir yanıtı ya da başka kullanıcıya ait veriyi kalıcı cache'e alıyor mu? Çıkışta temizleniyor mu?

## Kapsam ve öncelik

Önceki tam tarama `sast/` klasöründe duruyor (`sast/final-report.md`, tarih **2026-07-17**, bulgu yok). O tarihten bu yana **153 dosya değişti**. Bu yüzden:

- **Öncelik 1 — delta:** `git diff --stat 1a8a0ea HEAD`. Özellikle `src/lib/sync/*`, `src/lib/auth.ts`, `src/lib/db/index.ts`, `src/app/api/prices/tefas`, `src/app/api/prices/history`, `supabase/migrations/0006..0009`.
- **Öncelik 2 — tüm kod tabanı:** önceki raporun "bulgu yok" sonucunu veri kabul etme, **yeniden doğrula**. Özellikle önceki raporun "hardening notu" diye geçtiği 3 maddenin bugün hâlâ zararsız olup olmadığını kanıtla.

## Yöntem — buna uy

- Her iddia için **dosya:satır** referansı ver. Kaynak → akış → sink zincirini göster.
- Her bulgu için **somut sömürü senaryosu** yaz: saldırganın kim olduğu (başka bir kayıtlı kullanıcı / aynı cihazı paylaşan kişi / ağdaki MITM / kötü niyetli yedek dosyası), attığı adımlar, elde ettiği sonuç. Senaryoyu yazamıyorsan bulgu değildir — "hardening" bölümüne koy.
- **Kendi bulgunu çürütmeye çalış.** Mitigasyon var mı diye ikinci kez bak (RLS zaten kapatıyor mu? Zod şeması zaten reddediyor mu? Değer gerçekten kullanıcı kontrolünde mi?). Çürütemediklerini raporla.
- Şema iddialarını sadece migration dosyalarından değil, `supabase_schema.sql`'in mevcut haliyle **karşılaştırarak** doğrula — ikisi ayrışmış olabilir.

## Kesin kurallar

- **Salt okunur denetim.** Uygulama kodunu, migration'ları, veriyi DEĞİŞTİRME. Uygulama canlı kullanımda ve daha önce veri kaybı yaşandı.
- Supabase'e karşı hiçbir komut/migration/RPC ÇALIŞTIRMA. Canlı sisteme karşı test yapma.
- Düzeltmeleri **öner**, uygulama. Onay ayrı bir adım.

## Çıktı

`audit/security-audit-<tarih>.md` dosyasına yaz ve sohbette özetini ver. Format:

1. **Yönetici özeti** — 5 satır: kaç bulgu, en kötüsü ne, genel duruş.
2. **Bulgular**, ciddiyete göre sıralı (Kritik / Yüksek / Orta / Düşük). Her biri:
   - Başlık + ciddiyet + güven seviyesi (Doğrulandı / Muhtemel)
   - Konum (`dosya:satır`)
   - Sömürü senaryosu (adım adım)
   - Neden mevcut savunmalar durdurmuyor
   - Önerilen düzeltme (kod/SQL taslağı)
3. **Sertleştirme notları** — sömürülebilir olmayan ama iyileştirilmesi gereken maddeler.
4. **Temiz çıkan alanlar** — neye baktın ve neden temiz. (Kapsamı görebilmem için bu bölüm zorunlu.)
5. **Bakılamayanlar** — erişemediğin veya doğrulayamadığın şeyler (ör. canlı Supabase policy'lerinin gerçek hali, Vercel env değişkenleri) ve bunları benim nasıl kontrol etmem gerektiği.

Bulgu yoksa bunu net söyle — bulgu uydurma.
