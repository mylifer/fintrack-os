# FinTrack OS — Saldırgan Bakış Açılı Güvenlik Denetimi

**Tarih:** 2026-08-29
**Kapsam:** Tüm kod tabanı; öncelik `1a8a0ea..HEAD` deltası (153 dosya)
**Yöntem:** Salt okunur kaynak incelemesi. Denetim tarafından canlı Supabase'e karşı HİÇBİR sorgu/RPC/migration çalıştırılmadı; uygulama kodu, migration'lar ve veri değiştirilmedi. Canlı ortam doğrulaması (5. bölüm) **kullanıcı tarafından**, salt okunur katalog sorgularıyla yapıldı ve sonuçları rapora işlendi.
**Önceki tarama:** `sast/final-report.md` (2026-07-17, bulgu yok) — sonuçları veri olarak kabul edilmedi, yeniden doğrulandı.

---

## 1. Yönetici özeti

Altı bulgu var; hiçbiri "başka bir kullanıcının bulut verisini okuma/yazma" sınıfında değil — RLS katmanı gerçekten sıkı ve yeniden doğrulandı. En kötüsü **F1**: henüz çalıştırılmamış `0009` migration'ı geri yüklemede `workspaces` tablosunu tombstone'layıp asla diriltmiyor; üretime alınırsa ilk yedek geri yüklemesinden sonra kullanıcının TÜM verisi arayüzde görünmez hale gelir. İkinci sırada **F2**: tanınmayan her işlem açıklaması (serbest metin — kişi adları, sağlık harcamaları, borç notları) otomatik olarak Clearbit ve Wikidata'ya gönderiliyor; bu, kullanıcı onayı olmadan gerçekleşen bir üçüncü taraf finansal veri ifşasıdır. Kalanlar paylaşılan cihazda localStorage kalıntısı, kimliği doğrulanmış kullanıcının tetikleyebildiği kaynak tüketimi ve kötü niyetli yedek dosyasıyla beacon yükleme.

**Düzeltme durumu (2026-08-29 akşamı):** F1, F3, F5 kapatıldı; F4 kısmen kapatıldı. F2 ve F6 açık — ikisinin de düzeltmesi ürün kararı gerektiriyor (ayrıntı 7. bölümde). Ayrıca H2 ve H11 (canlı DB ↔ depo ayrışması) giderildi.

Genel duruş: mimariye göre **iyi**. Tek sunucu tarafı auth kapısı fail-closed, RLS `FORCE` ile 9 tabloda owner-only, restore RPC `security invoker` ve `target_user_id <> auth.uid()` ile kapılı, ham SQL yok, sunucuda dosya sistemi/komut sink'i yok, istemci bundle'ında sır yok, git geçmişinde sır yok.

---

## 2. Bulgular

### F1 — `0009` restore RPC'si çalışma alanlarını yok ediyor, geri yüklemiyor
**Ciddiyet: Yüksek (bütünlük/erişilebilirlik) · Güven: Doğrulandı · Durum: ✅ DÜZELTİLDİ (2026-08-29)**

> Migration dosyası düzeltildi ve depoya alındı. **Üretimde çalıştırma adımı hâlâ sende** — önce boş bir test projesinde doğrula (6. bölüm).

**Konum**
- `supabase/migrations/0009_restore_user_backup_all_columns.sql:104` (spec dizisine `workspaces` eklendi)
- `supabase/migrations/0009_restore_user_backup_all_columns.sql:139` (`update public.workspaces set deleted_at = ts ...`)
- `src/lib/backup-sync.ts:20-29` (`BackupData` — `workspaces` anahtarı YOK)
- `src/lib/auto-backup.ts:45-53` (`readSnapshot()` — `db.workspaces` okunmuyor)
- `src/store/workspace.store.ts:46-64` (boş sonuçta YENİ varsayılan alan üretir)
- `src/lib/workspace-context.ts:50-53` (`rowInWorkspace` — eşleşmeyen satır filtrelenir)

**Sömürü/hata senaryosu (saldırgan gerekmez — kullanıcının kendi eylemi yeter)**
1. `0009` üretime uygulanır.
2. Kullanıcı Ayarlar → Yedekler'den herhangi bir yedeği geri yükler (elle dosya ya da bulut snapshot'ı — ikisi de `cloudReplaceAll` → `restore_user_backup` yolundan geçer).
3. RPC adım 1'de `public.workspaces` satırlarının hepsini `deleted_at = now()` ile tombstone'lar.
4. Adım 2'de `payload -> 'workspaces'` **NULL**'dur — istemci bu anahtarı hiç üretmiyor. `jsonb_populate_recordset(null::public.workspaces, NULL)` sıfır satır döner, insert hiçbir satıra dokunmaz. Çalışma alanları tombstone olarak KALIR.
5. Bir sonraki sayfa yüklemesinde `DataProvider` → `loadWorkspaces()` → `reconcilingPull('workspaces')` bulutu çeker; tombstone'lar yerel Dexie satırlarının üzerine yazılır (`engine.ts:536-539`), `isLive` hepsini eler, `rows.length === 0`.
6. `workspace.store.ts:46` **yeni bir UUID ile yeni bir varsayılan çalışma alanı** yaratır.
7. Geri yüklenen tüm satırlar eski (artık ölü) `workspaceId`'yi taşır. `rowInWorkspace(row, activeId)` → `row.workspaceId !== yeniVarsayılanId` → **false**. Kullanıcının hesapları, işlemleri, bütçeleri, borçları, yatırımları arayüzde tamamen kaybolur.

Sadece `workspaceId` null olan legacy satırlar görünür kalır (`owner = defaultWorkspaceId` fallback'i).

**Neden mevcut savunmalar durdurmuyor**
- Tek transaction/rollback koruması işe yaramaz: RPC **başarıyla** tamamlanır, hata yoktur.
- Tombstone tasarımı (hard delete yerine) veriyi diskte korur ama istemci için görünmezlik aynı sonucu verir.
- `writeDexie` (`BackupManager.tsx:326-347`) `db.workspaces`'i temizlemez, yani hata geri yükleme anında değil, **bir sonraki açılışta** patlar — kullanıcı ilişkiyi kuramaz.
- 0009'un kendi başlık notu eksikliği "istemci `workspaces` üretmiyor" diye kaydediyor ama sonucu "geri yüklemeye HAZIRDIR" diye çerçeveliyor; tombstone adımının bu durumda yıkıcı olduğunu söylemiyor.
- Şu an CANLI olan `0004` `workspaces`'e hiç dokunmadığı için bu risk bugün YOK. Risk tamamen 0009'un uygulanmasıyla doğar.

**Önerilen düzeltme (biri yeterli; ikisi birlikte en güvenlisi)**

A) RPC'de `workspaces`'i koşullu tombstone'la — yedekte yoksa dokunma:

```sql
-- 0009, adım 1: workspaces satırını şununla değiştir
if payload ? 'workspaces'
   and jsonb_typeof(payload -> 'workspaces') = 'array'
   and jsonb_array_length(payload -> 'workspaces') > 0 then
  update public.workspaces set deleted_at = ts where user_id = target_user_id;
end if;
```
ve spec döngüsünde `workspaces` satırını yalnızca aynı koşulda işle (aksi halde `continue`).

B) İstemci tarafında yedek yüküne `workspaces` ekle (yazma yolunu da değiştirir, ayrı test ister):
- `src/lib/backup-sync.ts` → `BackupData`'ya `workspaces: Workspace[]`
- `src/lib/auto-backup.ts:45-53` → `readSnapshot()`'a `db.workspaces.toArray()`
- `src/components/backup/BackupManager.tsx:182-197` (export) ve `326-347` (`writeDexie`) → `workspaces` dahil
- `validateBackup` → eski dosyalarda `b.data.workspaces ??= []` (geriye uyum) **+ A şıkkındaki koşullu tombstone** — yoksa eski dosyalar aynı tuzağa düşer.

> Not: `audit/bug-audit-2026-08-28.md` bulgu #1, 0004'ün sütun listesi kaymasını ele alıyor. Bu bulgu ONUN ÇÖZÜMÜNÜN kendisinde yeni bir yıkım yolu açtığını söylüyor — 0009 çalıştırılmadan önce kapatılmalı.

---

### F2 — İşlem açıklamaları üçüncü taraf servislere sızıyor (Clearbit + Wikidata)
**Ciddiyet: Orta (gizlilik/mahremiyet) · Güven: Doğrulandı · Durum: ⏸️ AÇIK**

> Düzeltilmedi: marka çözümlemesinin varsayılanını kapatmak bir ürün/UX kararı (ikonlar kaybolur). Kullanıcı onayı bekliyor.

**Konum**
- `src/components/transactions/TransactionList.tsx:206-215` — `resolveBrandDomain(name)`, `name = description.trim()`
- `src/lib/people/brand-logo.ts:44` — `fetch('/api/brand-logo?name=' + encodeURIComponent(name))`
- `src/app/api/brand-logo/route.ts:38-39` — `autocomplete.clearbit.com/v1/companies/suggest?query=<açıklama>`
- `src/app/api/brand-logo/route.ts:57-58` — `wikidata.org/w/api.php?...&search=<açıklama>` (tr + en, iki ayrı istek)

**Sömürü senaryosu (saldırgan: ağdaki/upstream'deki pasif gözlemci ve servis sağlayıcının kendisi)**
1. Kullanıcı işlem listesini açar. Her satır için `TxIcon` render olur.
2. Açıklama küratörlü marka listesinde YOKSA (`brand`/`known` null) ve uzunluğu 2–64 arasındaysa, otomatik olarak `/api/brand-logo`'ya gider — kullanıcı hiçbir şeye tıklamaz, onay istenmez.
3. Sunucu bu metni **birebir** Clearbit'e ve Wikidata'ya sorgu parametresi olarak iletir.
4. Sonuç: `"Dr. Ahmet — terapi"`, `"Emine'ye borç ödemesi"`, `"Boşanma avukatı"`, `"Klinik kontrol"` gibi serbest metinler — yani uygulamanın sakladığı en hassas anlatısal veri — iki dış servisin erişim loglarına düşer. Bunlar aynı zamanda kullanıcı adı/e-postasıyla değil ama Vercel çıkış IP'siyle ve zaman damgasıyla ilişkilendirilebilir.
5. Ek olarak `Favicon` bileşeni (`TransactionList.tsx:246-260`) çözülen her domain için `google.com/s2/favicons`'e istek atar — bu da kullanıcının hangi markalarla çalıştığını Google'a bildirir (tarayıcıdan, doğrudan).

**Neden mevcut savunmalar durdurmuyor**
- Küratörlü liste (`getBrandDomain`) yalnızca bilinen markaları yakalar; **tanınmayan** metinler tam olarak dışarı gidenlerdir.
- 64 karakter sınırı kısa/kişisel açıklamaları elemez — aksine tam olarak onları geçirir.
- `localStorage` negatif cache (7 gün) yalnızca TEKRARI azaltır; her yeni açıklama ilk render'da gider.
- CSP `connect-src` bunu engelleyemez: istek tarayıcıdan değil, kendi sunucumuzdan çıkıyor.
- Kullanıcıya bu davranış hiçbir yerde bildirilmiyor; kapatma anahtarı yok.

**Önerilen düzeltme**
1. **Varsayılan kapalı yap.** Ayarlar'a açık bir tercih ekle (`settings.store.ts` deseni, `includeFundGain` gibi):
   ```ts
   // src/store/settings.store.ts
   onlineBrandLookup: boolean   // varsayılan: false
   ```
   `TxIcon`'daki effect (`TransactionList.tsx:206`) yalnızca bu açıkken `resolveBrandDomain` çağırsın. Kapalıyken küratörlü liste + monogram zaten çalışıyor.
2. Açıklamayı ham göndermek yerine **yalnızca alıcı (`recipient.name`) alanı** için çözümleme yap — alıcı adı zaten bir marka/kişi etiketi, işlem açıklaması ise serbest not.
3. Ayarlar'da tek cümlelik açıklama: "Açık olduğunda, tanınmayan açıklamalar logo bulmak için Clearbit ve Wikidata'ya gönderilir."
4. Favicon için `google.com/s2/favicons` yerine sunucu tarafında proxy'leyip cache'lemek Google'a giden tarayıcı-kaynaklı sızıntıyı da kapatır (opsiyonel, maliyeti var).

---

### F3 — Paylaşılan cihazda kullanıcı değişiminde localStorage temizlenmiyor: önceki kullanıcının işlem açıklamaları kalıyor
**Ciddiyet: Orta (kiracı sızıntısı) · Güven: Doğrulandı · Durum: ✅ DÜZELTİLDİ (2026-08-29)**

**Konum**
- `src/app/register/page.tsx:29-44` — kayıt akışı `ft_last_uid` yazmıyor
- `src/app/login/page.tsx:42-53` — `switched` yalnızca `ft_last_uid` varsa true olur
- `src/lib/auth.ts:9-33` — `clearLocalData()`: Dexie temizliği ÖNCE, `localStorage.clear()` SONRA
- `src/lib/sync/engine.ts:423-441` — `guardUserSwitch()` Dexie + outbox temizler, **localStorage'a dokunmaz**
- `src/lib/people/brand-logo.ts:7,24-28` — `fintrack.brandDomain.v1`, **anahtarları işlem açıklamalarının kendisi**

**Sömürü senaryosu (saldırgan: aynı cihazı/tarayıcı profilini paylaşan ikinci kişi)**
1. Kullanıcı A cihazda **/register üzerinden** hesap açar. Kayıt sayfası `ft_last_uid` yazmaz. `DataProvider` → `guardUserSwitch()` yalnızca `fintrack.lastSyncUserId = A` yazar.
2. A uygulamayı kullanır. `TxIcon` her tanınmayan açıklama için `resolveBrandDomain` çağırır ve sonucu `localStorage['fintrack.brandDomain.v1']`'e **açıklama metnini anahtar yaparak** yazar (`brand-logo.ts:47`).
3. A **çıkış yapmadan** sekmeyi/tarayıcıyı kapatır (ya da oturumu süresi dolar).
4. Kullanıcı B `/login`'den giriş yapar. `prevUid = localStorage.getItem('ft_last_uid')` → **null** → `switched === false` → **`clearLocalData()` ÇAĞRILMAZ**, soft `router.push('/dashboard')`.
5. `DataProvider` → `guardUserSwitch()`: `prev = 'A' !== B` → Dexie tabloları temizlenir, A'nın outbox girdileri düşer. **localStorage'a dokunulmaz.**
6. B, DevTools → Application → Local Storage'da (ya da konsolda `Object.keys(JSON.parse(localStorage['fintrack.brandDomain.v1']))` ile) **A'nın işlem açıklamalarının listesini** okur: alıcı adları, klinik/avukat/kişi isimleri, borç notları.

**İkinci yol (kayıt akışından bağımsız):** `switched === true` olsa bile `clearLocalData()` içinde Dexie temizliği (`auth.ts:10-21`) reddederse — başka bir sekme DB'yi tutuyorsa, versiyon yükseltmesi bloklanmışsa — `localStorage.clear()` satırına (`auth.ts:29`) **hiç ulaşılmaz**; çağıran taraf hatayı yutup devam eder (`login/page.tsx:48`, `useSidebarData.ts:116`). Aynı kalıntı oluşur.

**Neden mevcut savunmalar durdurmuyor**
- `guardUserSwitch` ikinci savunma katmanı olarak tasarlanmış ama kapsamı yalnızca **Dexie + outbox**; localStorage'ı bilinçli olarak `clearLocalData`'ya devretmiş (`workspace-context.ts:9-11` yorumu bunu açıkça varsayıyor) — ama `clearLocalData` bu yolda hiç çalışmıyor.
- `fintrack.activeWorkspaceId` kalıntısı zararsız: `workspace.store.ts:61` persisted id'yi kullanıcının kendi alanlarına karşı doğrulayıp varsayılana düşüyor. Sorun sadece brandDomain cache'inde.
- Veri Dexie'de değil localStorage'da olduğu için "yerel entity tablolarını temizle" yaklaşımı bunu hiç görmüyor.

**Önerilen düzeltme**
1. `guardUserSwitch()`'i kendi kendine yeter hale getir — ikinci katman başka bir fonksiyona güvenmesin:
   ```ts
   // src/lib/sync/engine.ts, guardUserSwitch içinde, prev !== uid bloğuna:
   try {
     const theme = localStorage.getItem('fintrack-theme')
     localStorage.clear()
     sessionStorage.clear()
     if (theme !== null) localStorage.setItem('fintrack-theme', theme)
   } catch { /* storage kapalı */ }
   ```
   (`LAST_UID_KEY` bu bloğun ALTINDA zaten yeniden yazılıyor — sıra korunmalı.)
2. `clearLocalData()` içinde sırayı ters çevir: **önce** localStorage/sessionStorage temizliği, **sonra** Dexie. Böylece Dexie hatası storage temizliğini iptal etmez:
   ```ts
   // src/lib/auth.ts
   export async function clearLocalData(): Promise<void> {
     if (typeof window !== 'undefined') {
       const theme = localStorage.getItem('fintrack-theme')
       try { localStorage.clear(); sessionStorage.clear() } catch {}
       if (theme !== null) { try { localStorage.setItem('fintrack-theme', theme) } catch {} }
     }
     await Promise.all([ /* mevcut db.*.clear() listesi */ ])
   }
   ```
3. `src/app/register/page.tsx`'te başarılı kayıttan sonra `localStorage.setItem('ft_last_uid', data.user.id)` yaz — iki işaretçi arasındaki boşluğu kapatır.
4. (İsteğe bağlı, F2 ile birlikte çözülür) `fintrack.brandDomain.v1` anahtarlarını ham metin yerine hash'le sakla; cache yine çalışır, kalıntı okunabilir olmaz.

---

### F4 — `/api/prices/history` sınırsız dış istek fan-out'u; rate-limit yok, negatif sonuç cache'lenmiyor
**Ciddiyet: Orta (kaynak/maliyet tükenmesi) · Güven: Doğrulandı · Durum: 🟡 KISMEN DÜZELTİLDİ (2026-08-29)**

> Negatif sonuç notu eklendi — tekrarlanan isteğin maliyeti kesildi. `from` için taban sınırı UYGULANMADI: grafiklerin ne kadar geriye gidebileceği bir ürün kararı.

**Konum**
- `src/app/api/prices/history/route.ts:14-25` (`sampleDates` — `from`'dan bugüne GÜN GÜN)
- `src/app/api/prices/history/route.ts:134` (`.slice(-4000)` — tek üst sınır)
- `src/app/api/prices/history/route.ts:70-82` (`cachedUsd` — başarısız gün cache'den SİLİNİR)
- `src/app/api/prices/history/route.ts:138-149` (50'lik dalgalar, dalga sayısı sınırsız)

**Sömürü senaryosu (saldırgan: kayıtlı, kimliği doğrulanmış herhangi bir kullanıcı — kendi hesabıyla)**
1. Saldırgan kayıt olur, e-postasını doğrular, giriş yapar (proxy `/api`'yi auth ile kapatıyor, yani anonim değil).
2. `GET /api/prices/history?asset=USD&from=2014-01-01` çağırır.
3. `sampleDates` ~4600 tarih üretir, son 4000'e kırpılır. Her tarih için `cachedUsd` → `fetchUsd` → jsDelivr, düşerse Cloudflare Pages: **tarih başına 2'ye kadar dış istek**.
4. `fetchUsd` null dönen günler (hafta sonları, CDN'de olmayan tarihler, timeout) `usdCache.delete(date)` ile **kalıcı olarak cache'lenmez** (`route.ts:77`). Aynı istek tekrarlandığında bu yüzlerce gün yeniden çekilir.
5. Saldırgan isteği döngüye alır. Her tur: instance'tan dışarı binlerce HTTP isteği, ~80 ardışık dalga, dalga başına 6 sn'ye kadar timeout bütçesi.
6. Sonuç: (a) Vercel fonksiyon süresi/faturası kullanıcı başına sınırsız şekilde şişer, (b) jsDelivr ve `currency-api.pages.dev`'e uygulamanın çıkış IP'sinden yönlendirilmiş trafik oluşur — üst servis tarafından hız sınırlaması/engelleme yenirse **tüm kullanıcılar için** fiyat geçmişi çalışmaz hale gelir.

**Neden mevcut savunmalar durdurmuyor**
- `slice(-4000)` yalnızca TEK istekteki tarih sayısını sınırlar, istek SAYISINI değil.
- `usdCache` kalıcı cache olarak tasarlanmış ama tam da tekrar tetikleyen günleri (başarısız + dünden yeni) kasıtlı olarak dışarıda bırakıyor.
- Instance-içi cache serverless'ta her soğuk başlangıçta sıfırlanır; saldırgan aralarını açarak sürekli soğuk yola girebilir.
- Uygulamada hiçbir yerde rate limit yok (`grep` ile 4 route'un hiçbirinde yok).
- Auth kapısı saldırganın kim olduğunu bilinir kılar ama **engellemez** — kayıt açık.

**Önerilen düzeltme**
```ts
// src/app/api/prices/history/route.ts
// 1) `from` için makul bir taban sınırı (grafiklerin gerçek ihtiyacı ~5 yıl)
const MIN_FROM = new Date(Date.now() - 5 * 365 * 86_400_000).toISOString().slice(0, 10)
const effFrom = from < MIN_FROM ? MIN_FROM : from

// 2) Başarısız günü de cache'le (kısa TTL) — sonsuz yeniden deneme biter
const p = fetchUsd(date).then(res => {
  if (date >= cutoffStr) usdCache.delete(date)          // kesinleşmemiş gün: kalıcı tutma
  else if (!res) setTimeout(() => usdCache.delete(date), 10 * 60_000)  // negatif TTL
  return res
})
```
Ek olarak dört route'a ortak, IP+kullanıcı bazlı basit bir sayaç (ör. `Map<key, {n, at}>`, dakikada N istek) koy; Vercel'de Edge Config/KV varsa oraya taşı.

---

### F5 — `/api/brand-logo` sınırsız büyüyen bellek-içi cache (anahtarlar saldırgan kontrolünde)
**Ciddiyet: Düşük · Güven: Doğrulandı · Durum: ✅ DÜZELTİLDİ (2026-08-29)**

**Konum**
- `src/app/api/brand-logo/route.ts:11` — `const cache = new Map<string, {...}>()`, tahliye/boyut sınırı yok
- `src/app/api/brand-logo/route.ts:79-84` — `cache.set(key, ...)`, `key = normalize(name)` (2–64 karakter, keyfi)
- `src/app/api/brand-logo/route.ts:82` — miss durumunda 1 Clearbit + 2 Wikidata arama + 6'ya kadar entity fetch

**Sömürü senaryosu (kimliği doğrulanmış kullanıcı)**
1. `GET /api/brand-logo?name=<rastgele 64 karakter>` döngüsü.
2. Her benzersiz isim yeni bir Map girdisi yaratır ve **hiç silinmez** (TTL sadece okunurken kontrol edilir, girdi kalır).
3. Aynı anda her miss upstream'e 1–9 istek çıkarır (Clearbit + Wikidata arama ×2 dil + entity ×3 ×2 dil).
4. Sonuç: fonksiyon instance'ında bellek şişmesi (OOM → soğuk başlangıç döngüsü) + Clearbit/Wikidata'ya yönlendirilmiş trafik.

**Neden mevcut savunmalar durdurmuyor**
- `MAX_NAME_LEN = 64` girdi boyutunu sınırlar, girdi SAYISINI değil.
- `CACHE_TTL_MS` yalnızca `Date.now() - hit.at < TTL` okuma kontrolü; süresi dolan girdi yerinde durur.
- Auth kapısı saldırganı kayıtlı bir kullanıcıya indirger ama kayıt açıktır.

**Önerilen düzeltme** — sınırlı LRU:
```ts
const MAX_CACHE = 2000
function cacheSet(key: string, v: { at: number; domain: string | null }) {
  if (cache.size >= MAX_CACHE) {
    // Map ekleme sıralı: en eski anahtarı at
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.delete(key); cache.set(key, v)   // yeniden ekleyerek tazeliği sıraya yaz
}
```
Aynı desen `src/app/api/prices/tefas/route.ts:17`'deki `cache` için de geçerli (orada anahtar uzayı `[A-Z0-9]{2,6}` ile sınırlı olduğu için risk daha düşük, ama sınırsız).

---

### F6 — Kötü niyetli yedek dosyası `account.icon` üzerinden keyfi dış URL yükletiyor (beacon)
**Ciddiyet: Düşük · Güven: Doğrulandı · Durum: ⏸️ AÇIK**

> Düzeltilmedi: iki seçenek de karar gerektiriyor — CSP'yi enforce'a çevirmek (H1, uygulamayı bozma riski) ya da kullanıcının kendi yapıştırdığı meşru ikon URL'lerini de reddedebilecek bir allow-list.

**Konum**
- `src/components/backup/BackupManager.tsx:79-82` — `RECORD_GUARDS.accounts`, `icon` alanı **hiç kontrol edilmiyor**
- `src/components/accounts/AccountAvatar.tsx:48` — `const iconSrc = account.icon ?? ...`
- `src/components/accounts/AccountAvatar.tsx:67` — `<img src={iconSrc} />`
- `src/proxy.ts:44,110` — `img-src` politikası var ama header **`Content-Security-Policy-Report-Only`** olarak gönderiliyor

**Sömürü senaryosu (saldırgan: kurbana yedek dosyası veren kişi — "verini taşıdım, bunu içe aktar")**
1. Saldırgan geçerli bir yedek JSON'u hazırlar; bir hesabın `icon` alanına `https://saldirgan.example/px.png?u=kurban&t=1` yazar.
2. Kurban Ayarlar → Yedekler → dosya seçer. `validateBackup` geçer: `accounts` guard'ı `id/name/type/currency/initialBalance/color/creditLimit` bakıyor, **`icon`'a bakmıyor**.
3. Kurban "geri yükle"yi onaylar. Satır Dexie'ye ve `cloudReplaceAll` ile Supabase'e yazılır.
4. Hesap avatarını gösteren HER ekranda (sidebar, hesaplar sayfası, işlem satırı) tarayıcı saldırganın URL'sine istek atar → saldırgan geri yüklemenin gerçekleştiğini, kurbanın IP'sini, User-Agent'ını ve kullanım sıklığını öğrenir. `data:` URI ile de rastgele görsel enjekte edilebilir.
5. Satır buluta yazıldığı için beacon **kullanıcının tüm cihazlarında** kalıcıdır.

**Neden mevcut savunmalar durdurmuyor**
- CSP `img-src 'self' data: blob: https://api.iconify.design https://www.google.com` bu URL'i **engellerdi** — ama politika `Content-Security-Policy-Report-Only` başlığıyla gönderiliyor (`proxy.ts:110`), yani tarayıcı hiçbir şeyi engellemiyor. Üstelik politikada `report-uri`/`report-to` da yok, yani ihlal raporu hiçbir yere GİTMİYOR: Report-Only şu an sıfır fayda üretiyor.
- `account.icon`'un meşru değeri zaten keyfi bir URL (`AccountFormModal.tsx:257` kullanıcı URL yapıştırabiliyor), yani tip kontrolü tek başına ayırt edemez — ayrım "kullanıcı mı yapıştırdı, dosya mı getirdi"de.
- XSS değildir: `<img src>` `javascript:` çalıştırmaz. Etki beacon/izleme ile sınırlıdır.

**Önerilen düzeltme**
1. CSP'yi enforce'a çevir (aşağıdaki H1'e bak) — tek satırlık değişiklik bu bulguyu tamamen kapatır.
2. Ek olarak guard'a şema kısıtı koy:
   ```ts
   // BackupManager.tsx, RECORD_GUARDS.accounts içine
   const isSafeIcon = (v: unknown): boolean =>
     v === undefined || v === null ||
     (typeof v === 'string' &&
      (v.startsWith('data:image/') || v.startsWith('https://www.google.com/s2/favicons') ||
       v.startsWith('https://api.iconify.design/')))
   ```
   ve `accounts` guard'ına `&& isSafeIcon(r.icon)` ekle.

---

## 3. Sertleştirme notları (sömürülebilir bulgu değil)

**H1 — CSP hâlâ Report-Only ve raporlama uçları yok.** `src/proxy.ts:110`. Politika tarayıcıda hiçbir şey engellemiyor; `report-uri`/`report-to` direktifi de olmadığı için ihlaller yalnızca kullanıcının konsoluna düşüyor ve kimse görmüyor. Enforce'a geçişi engelleyen SOMUT şeyler:
   - `@vercel/speed-insights` nonce'suz bir **inline bootstrap** script'i enjekte ediyor (`proxy.ts:27-29`'daki kendi notunuz). Çözüm: `script-src`'a `'strict-dynamic'` ekleyin (nonce'lu loader'ın onu doğurmasına izin verir) veya inline'ın SHA-256 hash'ini ekleyin.
   - `style-src 'self' 'unsafe-inline'` — Tailwind'in inline `style` attribute'ları için gerekli. Bu politikanın zayıf noktası; enforce'a geçseniz bile stil enjeksiyonuna açık kalır. Kabul edilebilir bir ödünç, ama bilinçli olsun.
   - `layout.tsx:56`'daki tema script'i `nonce={nonce}` taşıyor — bu taraf hazır.
   Öneri: önce `report-to` + bir toplayıcı ekleyip 1–2 hafta gerçek ihlalleri izleyin, sonra başlık adını `Content-Security-Policy` yapın.

**H2 — `supabase_schema.sql` ile migration'lar ayrışmış.** `supabase_schema.sql`'de **`categorySplits` sütunu yok** (yalnızca `0007`'de) ve **`user_backups` tablosu yok** (yalnızca `0005`'te). Diğerleri (`pnlLinkedTransactionId`, `borrowDate`, `debtPrincipalId`, `approvalStatus`, `workspaceTransferId`) senkron. Üretim DB'si migration'ları aldığı için bugün sorun yok; ama **felaket kurtarmada** sadece `supabase_schema.sql` ile kurulan bir proje `transactions.categorySplits`'ten yoksun olur → sync engine tam satır snapshot'ı push ettiği için HER işlem PGRST204 alır ve outbox tamamen dead-letter'a düşer (0003'teki bilezik vakasının aynısı). `supabase_schema.sql`'e iki eksik parçayı ekleyin veya dosyanın başına "tek başına yeterli değildir, 0001..0009 da uygulanmalıdır" notunu koyun.

**H3 — 0009'un dinamik sütun listesi geleceğe açık kapı bırakıyor.** `0009:...:150-165` sütun listesini `information_schema.columns`'tan türetiyor; `user_id` ve `deleted_at` dışındaki HER sütun istemcinin yedek dosyasından yazılabilir hale geliyor. Bugün zararsız (tüm sütunlar zaten istemci sahipli), ama ileride sunucu tarafında hesaplanan ya da ayrıcalıklı bir sütun eklenirse (ör. `is_verified`, `plan_tier`) restore onu sessizce istemci kontrolüne verir. Öneri: `user_id`, `deleted_at` yanına açık bir kara liste değişkeni koyun ve yeni sütun eklerken orayı gözden geçirin.

**H4 — Restore RPC zayıf bir satır-varlığı kâhini (oracle) sunuyor.** `0004`/`0009`'daki `on conflict (id) do update`, çakışan satır BAŞKA bir kullanıcıya aitse RLS nedeniyle hata döner; hiç yoksa insert başarılı olur. Saldırgan bu farktan "şu id bulutta var mı" bilgisini çıkarabilir. Kimlikler `crypto.randomUUID()` olduğu için pratikte tahmin edilemez ve hiçbir veri sızmaz — kayda değer değil ama bilinsin.

**H5 — Yedek yükünde boyut sınırı yok.** `validateBackup` (`BackupManager.tsx:109-143`) kayıt sayısını/dosya boyutunu sınırlamıyor; `createCloudBackup` (`auto-backup.ts:67-88`) da `user_backups.payload` jsonb'sine sınırsız yazıyor. Devasa bir dosya tarayıcıda OOM'a yol açar ve Supabase depolamasını şişirir (kendi kotanız). Öneri: `validateBackup`'ta toplam kayıt sayısına (ör. 500k) ve `file.size`'a (ör. 100 MB) tavan koyun.

**H6 — Servis worker cache'i çıkışta temizlenmiyor.** `public/sw.js:62-76` gezinme yanıtlarını (HTML kabuğu) `ft-shell-v1`'e yazıyor; `clearLocalData()` Cache API'ye dokunmuyor. **Etki bugün yok**: `(main)` altındaki tüm sayfalar `'use client'` (yalnızca `accounts/[id]` ve birkaç detay sayfası sunucu bileşeni ve onlar da kullanıcı verisi çekmiyor), veri tamamen istemcide Supabase'den geliyor — yani cache'lenen HTML'de kullanıcı verisi YOK. Yine de çıkışta `caches.keys()` → `caches.delete()` eklemek ucuz bir güvence. `/api/*` ve cross-origin isteklerin hiç yakalanmaması (`sw.js:112-113`) ve redirect'lerin cache'lenmemesi (`sw.js:50`) doğru yapılmış.

**H7 — Wikidata entity id'si URL'e doğrulanmadan gömülüyor.** `brand-logo/route.ts:64-66`. Önceki raporun 1 numaralı notu; **hâlâ mevcut, hâlâ sömürülebilir değil**: `e.id` upstream Wikidata yanıtından geliyor ve Wikidata id'leri `Q<sayı>` biçiminde otomatik atanıyor (bir saldırgan Wikidata'da bir öğe oluşturup ETİKETİNİ kontrol edebilir, ID'sini edemez). Host ve şema literal olduğu için yol enjeksiyonu en fazla `wikidata.org` içinde kalır — SSRF yok. Yine de `if (!/^Q\d+$/.test(e.id)) continue` bir satırlık iyileştirme.

**H8 — `getUserId()` doğrulanmamış oturumu okuyor.** `src/lib/auth.ts:4-7` `supabase.auth.getSession()` kullanıyor (yerel çerezi okur, JWT'yi sunucuda doğrulamaz). Push'ta `user_id` damgalamak ve outbox `ownerId`'si için kullanılıyor. Yetkilendirme açısından **zararsız**: gerçek sınır RLS'te ve orada `auth.uid()` doğrulanmış token'dan geliyor; sahte bir uid ile push RLS'e takılır. Proxy tarafı zaten doğru olanı yapıyor (`proxy.ts:99` `getUser()`). Değiştirmeye gerek yok, ama bu ayrımın bilinçli olduğu kod içinde not düşülebilir.

**H9 — `repairStuckCategories` önceki kiracının kategori adlarını yeni hesaba kopyalıyor.** `src/lib/sync/repair.ts:63-78`: RLS'e takılan yabancı bir kategori satırı, aynı isimli hedef yoksa **yeni bir kimlikle kullanıcının hesabına klonlanır** (`rekey`) ve buluta yazılır. Yani A'nın kategori adları B'nin bulut hesabına geçebilir. Pratikte dar: `guardUserSwitch` farklı `ownerId`'li outbox girdilerini zaten düşürüyor, dolayısıyla bu yol yalnızca `ownerId` null olan legacy girdiler için açık ve düğmeye kullanıcı basıyor. Öneri: onar diyaloğunda hangi kategori adlarının kopyalanacağını listeleyip onaylatın.

**H10 — `clearAllData` kategorileri ve çalışma alanlarını bulutta tombstone'lamıyor.** `src/lib/seed.ts:517-527` yedi tabloyu tombstone'luyor; `categories` ve `workspaces` listede yok ve `db.categories`/`db.workspaces` yerelde de temizlenmiyor. Muhtemelen bilinçli (varsayılan kategoriler korunsun diye), ama "tüm veriyi sil" vaadiyle davranış arasında bir fark var — kullanıcıya "kategoriler ve çalışma alanları korunur" diye yazın.

**H11 — `rls_auto_enable()` versiyon kontrolünde yok ve hatayı sessizce yutuyor.** Canlı veritabanında `postgres` sahipli, `security definer` bir event trigger fonksiyonu var (`ensure_rls`, `ddl_command_end`) — `public` şemasında oluşturulan her yeni tabloya otomatik `enable row level security` uyguluyor. Depoda (`supabase/`, `supabase_schema.sql`, `sast/`) **hiçbir izi yok**; 2026-08-29 doğrulamasında canlı DB sorgulanınca ortaya çıktı. İki ayrı iş:
   - **Depoya al.** `supabase/migrations/0010_rls_auto_enable.sql` olarak commit'le (`pg_get_functiondef` çıktısı doğrudan kullanılabilir). Şu an sıfırdan kurulan bir proje bu korumasız gelir ve kimse fark etmez — H2'deki şema ayrışmasının aynı deseni.
   - **Sessiz başarısızlığı görünür yap.** Gövdedeki `EXCEPTION WHEN OTHERS THEN RAISE LOG` bloğu, RLS açma başarısız olursa tabloyu **RLS'siz** bırakıp yalnızca Postgres log'una yazıyor. Exception fırlatmak `CREATE TABLE`'ı bozacağı için bilinçli bir ödünç olabilir; ama `RAISE WARNING` istemciye de gösterilir ve sessizliği bozar.

   Fonksiyonun kendisi güvenlik açısından **doğru yazılmış** — ayrıntı için 4. bölümdeki "Event trigger: `rls_auto_enable`" satırına bak.

---

## 4. Temiz çıkan alanlar

| Alan | Ne bakıldı | Neden temiz |
|---|---|---|
| **RLS politikaları** | `supabase_schema.sql:59-125` DO bloğu | 9 tablonun tamamında (`accounts, transactions, categories, budgets, debts, investment_transactions, people, recurring_transactions, workspaces`) önce **her mevcut politika düşürülüyor** (legacy `USING (true)` OR-birleşmesi riski kapatılmış), sonra `enable` + **`force row level security`**, ardından 4 politika: SELECT/INSERT/UPDATE/DELETE, hepsi `user_id = auth.uid()`. UPDATE'te hem `USING` hem `WITH CHECK` var → satır başka kullanıcıya yeniden atanamıyor. `workspaces` için ayrıca `grant ... to authenticated` verilmiş. |
| **RLS'in canlı DB'de gerçekten açık olduğu** | `pg_class.relrowsecurity` taraması (2026-08-29, kullanıcı çalıştırdı) | `public` şemasında RLS'siz **hiçbir tablo yok** (sorgu boş döndü). Tablo listesi de tam olarak beklenen 10 tablo: `accounts, budgets, categories, debts, investment_transactions, people, recurring_transactions, transactions, user_backups, workspaces` — depoda olmayan sürpriz tablo yok. |
| **Event trigger: `rls_auto_enable`** | `pg_get_functiondef`, `pg_event_trigger`, `pg_namespace.nspacl` (2026-08-29) | Depoda olmayan, `postgres` sahipli `security definer` bir event trigger fonksiyonu (`ensure_rls`, `ddl_command_end`): yeni oluşturulan her `public` tablosuna `enable row level security` uyguluyor — yani savunma amaçlı, fail-closed bir kontrol. Dört sömürü açısı da kapalı: (1) `SET search_path TO 'pg_catalog'` ile sabitlenmiş → `security definer` yetki yükseltmesi yok; (2) `proacl` null (PUBLIC'e EXECUTE) ama `RETURNS event_trigger` olduğu için doğrudan çağrı dil seviyesinde reddediliyor, `pg_event_trigger_ddl_commands()` de bağlam dışında hata veriyor; (3) `format('%s', cmd.object_identity)` doğru kullanım — `object_identity` PostgreSQL'in kendi ürettiği, zaten tırnaklanmış tam nitelikli ad, `%I` onu bozardı; (4) değeri kontrol etmek tablo yaratmayı gerektirir, `authenticated` yaratamaz (aşağıdaki satır). Versiyon kontrolü eksiği için H11'e bak. |
| **`public` şemasında CREATE yetkisi** | `pg_namespace.nspacl` (2026-08-29) | `anon`, `authenticated`, `service_role` ve `PUBLIC` rollerinin hepsinde yalnızca **`U` (USAGE)** var; `C` (CREATE) sadece `pg_database_owner`'da. Giriş yapmış bir kullanıcı `public` şemasına tablo/fonksiyon/tip yaratamıyor — bu tek başına `search_path` ele geçirme ve sahte-obje sınıfındaki saldırıların tamamını kapatıyor. |
| **`user_backups`** | `0005_user_backups.sql` | Ayrı ama aynı sıkılıkta: `enable` + `force` RLS, owner-only select/insert/delete, **update politikası bilinçli olarak YOK** (snapshot'lar değişmez), `anon`'a grant yok, `service_role`'a `all`. `user_id` → `auth.users(id) on delete cascade`. |
| **Restore RPC yetkilendirmesi** | `0004:29-36`, `0009:120-127` | `security invoker` + `set search_path = public`; ilk satırda `if uid is null or target_user_id is null or target_user_id <> uid then raise exception`. Başka bir hesaba geri yükleme imkânsız. `on conflict do update` yolunda yabancı satır RLS'e takılır (repair.ts'teki gözlem bunu saha kanıtıyla doğruluyor). |
| **Dinamik SQL enjeksiyonu (0009)** | `0009:150-186` | Tablo adları sabit bir dizi literalinden; sütun adları `quote_ident()`'ten; payload `using ... $1, $2` ile **bağlı parametre**. Enjeksiyon yolu yok. |
| **`security definer` fonksiyon** | Tüm `supabase/migrations/*.sql` | Hiç yok — tek RPC `security invoker`. |
| **Auth kapısı** | `src/proxy.ts`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` | Next 16.2.9'da `middleware` → `proxy` yeniden adlandırılmış; dosya `src/proxy.ts`, named export `proxy` — konvansiyon **doğru**, kapı canlı. `getUser()` (doğrulanmış) kullanılıyor, `getSession()` değil. `/api` için HTML redirect yerine **401 JSON**. `AUTH_BYPASS` yalnızca `NODE_ENV !== 'production'` VE `AUTH_BYPASS === '1'` iken; NODE_ENV'e tek başına bağlı değil. |
| **Proxy matcher kapsamı** | `src/proxy.ts:135-140` | Dışlananlar: `_next/static`, `_next/image`, `favicon.ico`, `sw.js`, `manifest.webmanifest`, `.svg/.png/.jpg/.jpeg/.gif/.webp` ile BİTEN yollar. Uygulamada bu uzantılarla biten hiçbir route yok; `_next/image` için `next.config.ts`'te `remotePatterns` tanımlı değil, yani yalnızca yerel görselleri optimize edebiliyor. Korunması gereken hiçbir yol atlanmıyor. RSC gezinme istekleri (`?_rsc=`) pathname üzerinden yakalanıyor. |
| **Sır sızıntısı** | `.gitignore`, `git ls-files`, `git log --all --diff-filter=A`, `repomix-output.txt`, `git log -S`, `process.env.*` kullanımları | `.env*` gitignore'da; hiçbir `.env` dosyası ne takipte ne de geçmişte eklenmiş. `repomix-output.txt` (785 KB, takipte) taranıyor: `eyJ` eşleşmesi **0**, yalnızca `process.env.NEXT_PUBLIC_...` referansları var. Geçmişte JWT deseni yok. Kodda `service_role` yalnızca `0005_user_backups.sql:39`'daki GRANT ifadesinde geçiyor — anahtar değil. İstemciye giden tek şey `NEXT_PUBLIC_SUPABASE_URL` + anon key (tasarım gereği public, RLS ile korunuyor). |
| **XSS / DOM sink'leri** | Tüm `src/` içinde `dangerouslySetInnerHTML|innerHTML|outerHTML|document.write|eval(|new Function|insertAdjacentHTML` | Üç eşleşme: (1) `proxy.ts:31` bir YORUM; (2) `layout.tsx:56` **sabit literal** tema script'i, nonce'lu; (3) `ui/chart.tsx:69` shadcn `ChartStyle` — `ChartContainer` uygulamada **hiç kullanılmıyor** (`grep -l ChartContainer` yalnızca kendi dosyasını döndürüyor), yani ölü kod ve zaten config geliştirici tanımlı. Kullanıcı verisi hiçbir HTML sink'ine ulaşmıyor; her yerde React auto-escaping. |
| **Dinamik `href` şeması** | `src/components`, `src/app` içindeki tüm `href={...}` | Hepsi uygulama-içi göreli yol (`${config.basePath}/${person.id}`, `#${groupId(...)}`) veya `Link` sabitleri. Kullanıcı girdisinden gelen `javascript:`/`data:` href yok. `person.url` doğrudan href olarak KULLANILMIYOR — `extractDomain()`'den geçip yalnızca **hostname** olarak favicon URL'ine giriyor (`PersonAvatar.tsx:82-89`). |
| **CSV formula injection** | `src/lib/utils/csv.ts:20-36`, dışa aktarma çağrı noktaları | `escapeCsvCell` `^[=+\-@\t\r]` ile başlayan hücreleri `'` ile etkisizleştiriyor; `PLAIN_NUMBER` istisnası yalnızca `-?\d+(\.\d+)?` desenine uyan **saf sayılara** ait (Excel bunları formül olarak değerlendirmez), `-1+1` gibi gerçek formüller desene uymadığı için kaçırılmıyor. Tırnaklama sırası doğru (`'` önce, sonra `"`). Uygulamadaki tek CSV üreticisi `transactionsToCsvString` ve tüm hücreleri bu fonksiyondan geçiriyor. İçe aktarma tarafında `autoDetectMapping:201` ve `validateImportRows:308` **prototype pollution'a karşı `hasOwnProperty` guard'ı** taşıyor (`constructor`, `__proto__` başlıkları etkisiz). |
| **Sync motoru kiracı izolasyonu (bulut tarafı)** | `engine.ts:300-312`, `engine.ts:458-484` | Outbox girdileri **enqueue anında** `ownerId` ile damgalanıyor; flush'ta `owner != null && owner !== userId` → girdi **silinir**, başka hesaba replay edilmez. `fetchAllRows` RLS'e ek olarak açık `.eq('user_id', userId)` filtresi koyuyor (defense-in-depth). Eksik/başarısız fetch'te (`complete === false`) yıkıcı birleştirme hiç çalışmıyor. Silme yalnızca pozitif `deleted_at` satırından öğreniliyor, yokluktan değil. |
| **Sync motoru kiracı izolasyonu (yerel Dexie)** | `engine.ts:423-441`, `DataProvider.tsx:22-32` | `guardUserSwitch()` `init()`'in **Phase 0**'ı; `loadWorkspaces()` ve `reloadAllStores()`'dan önce await ediliyor, yani `reconcilingPull`'un yabancı satırları yeni hesaba re-enqueue etmesi (`engine.ts:540-545`) mümkün değil. Farklı uid tespitinde 9 Dexie tablosu + yabancı outbox girdileri temizleniyor. `ownerId` null/undefined olan legacy girdiler de `e.ownerId !== uid` ile düşüyor. Çıkışta (`useSidebarData.ts:92-133`) ve kullanıcı değişimli girişte (`login/page.tsx:45-63`) **hard navigation** yapılıyor → bellekteki Zustand store'ları ve `initPromise` sıfırlanıyor. (Bu katmandaki tek boşluk F3'te; Dexie tarafı sağlam, sızan şey localStorage.) |
| **SSRF** | 4 route + `src/lib/server/tefas-api.ts` | Tüm upstream host'lar literal: `autocomplete.clearbit.com`, `www.wikidata.org`, `cdn.jsdelivr.net`, `*.currency-api.pages.dev`, `query1.finance.yahoo.com`, `finans.truncgil.com`, `www.tefas.gov.tr`. Kullanıcı girdisi yalnızca **query string / POST body** içine, `encodeURIComponent` veya `JSON.stringify` ile giriyor — host, şema veya port hiçbir yerde kullanıcı kontrolünde değil. `history` route'unda `asset` bir allow-list'e, `from` `^\d{4}-\d{2}-\d{2}$`'e, `code` `^[A-Z0-9]{2,6}$`'e karşı doğrulanıyor. `currency-api.pages.dev` alt alanı `tag`'den geliyor ama `tag` ya literal `'latest'` ya da regex-doğrulanmış tarih. |
| **Upstream JSON doğrulaması** | `prices/route.ts:71-76,106-114`, `tefas-api.ts:46-62` | Upstream yanıtları ham geçirilmiyor: her alan `typeof === 'number' && > 0` / `Array.isArray` / tarih regex'inden geçiyor, sonra yeni bir nesneye kopyalanıyor. `TEFAS`'tan gelen tek serbest metin `fonUnvan` (`tefas-api.ts:62`) ve o da React metni olarak render ediliyor — escape'li. |
| **SQL enjeksiyonu / ham SQL** | Tüm `src/` | Uygulamada ham SQL yok; her şey PostgREST (`supabase.from(...)`) ve tek RPC üzerinden bağlı parametrelerle. |
| **RCE / path traversal / XXE / SSTI / GraphQL / dosya yükleme** | Tüm `src/` | Sunucuda `child_process`, `fs`, `eval`, deserializasyon, XML parser, şablon motoru, GraphQL istemcisi ya da yükleme uç noktası yok. Tek "yükleme" istemci tarafında `FileReader` ile okunan yedek JSON'u ve o da `validateBackup`'tan geçiyor. |
| **Servis worker veri güvenliği** | `public/sw.js:107-131` | `GET` dışı, cross-origin, `/api/*` ve `/sw.js` istekleri hiç yakalanmıyor → Supabase yanıtları ve canlı fiyat uçları asla cache'lenmiyor. `isCacheable` yalnızca `response.ok && type === 'basic' && !redirected` kabul ediyor → login yönlendirmesi kabuk olarak saklanmıyor. `next.config.ts:29-35` `/sw.js`'e `no-store` veriyor → eski kabuk takılı kalmıyor. |
| **Auth UX'te hesap sayımı (enumeration)** | `login/page.tsx:29-36`, `register/page.tsx:31-37` | Ham Supabase hata mesajları UI'a sızdırılmıyor; hem giriş hem kayıt tek jenerik mesaja indirgeniyor ("Email not confirmed" / "user already registered" ayırt edilemiyor). |
| **Güvenlik başlıkları** | `next.config.ts:9-27` | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `HSTS max-age=63072000; includeSubDomains; preload`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `COOP: same-origin`. CSP hariç hepsi enforce. |

---

## 5. Doğrulama durumu — canlı ortam

Rapor ilk yazıldığında canlı Supabase/Vercel'e erişimim yoktu. **2026-08-29'da kullanıcı 4 doğrulamayı çalıştırdı**; sonuçlar aşağıda. Kalan 3 madde hâlâ açık.

### ✅ Doğrulandı — temiz

| # | Kontrol | Sonuç |
|---|---|---|
| 1 | RLS'siz public tablo var mı (`pg_class.relrowsecurity`) | **Boş döndü** — hiçbiri korumasız değil. Tablo listesi de beklenen 10 tabloyla birebir; drift yok. |
| 2 | `transactions."categorySplits"` üretimde var mı | **Var** — `0007` uygulanmış. H2 böylece yalnızca "referans şema dosyası eksik" seviyesine iniyor; canlı sistem etkilenmiyor, felaket kurtarma senaryosu etkileniyor. |
| 3 | Elle eklenmiş `security definer` fonksiyon var mı | **Bir tane bulundu:** `rls_auto_enable()` (`prosecdef = true`). İncelendi: savunma amaçlı, doğru yazılmış, sömürülebilir değil — 4. bölümdeki "Event trigger" satırına bak. Tek eksiği versiyon kontrolünde olmaması → **H11**. `restore_user_backup` beklendiği gibi `false`. |
| 4 | Vercel ortam değişkenleri | **Temiz** — `AUTH_BYPASS` yok, elle set edilmiş `NODE_ENV` yok, `service_role` anahtarı yok. Yalnızca iki `NEXT_PUBLIC_*` var. |

### ⏳ Hâlâ açık — kontrol etmen gerekiyor

5. **Supabase Auth proje ayarları.** Kod tarafından görülemez, dashboard'dan bakman gerek (Authentication → Providers / Policies): e-posta doğrulama zorunlu mu, sunucu tarafı şifre politikası minimum kaç karakter (istemcideki 12 yalnızca UX — `register/page.tsx:26` bunu kendisi not ediyor), auth rate limiting açık mı, JWT süresi ne, "leaked password protection" açık mı.

6. **`0009`'un düzeltilmiş halinin test sonucu.** F1 kapatılmadan üretimde **çalıştırma**. Düzeltmeden sonra migration'ın kendi "Doğrulama" bölümünü boş bir test projesinde gerçek bir yedek dosyasıyla yürüt ve şu ek kontrolü yap — **0'dan büyük dönmeli**:
   ```sql
   select count(*) from public.workspaces
   where user_id = auth.uid() and deleted_at is null;
   ```

7. **Clearbit/Wikidata'ya bugüne kadar ne gitti.** F2 geriye dönük: uygulama üretimde olduğu süre boyunca tanınmayan her işlem açıklaması bu iki servise gitmiş olabilir. Ne kadar hassas veri sızdığını yalnızca sen (kendi işlem açıklamalarına bakarak) değerlendirebilirsin.

## 6. Önerilen sıra

1. **F1** — `0009`'u düzeltmeden çalıştırma. (Bloklayıcı, tek dosya.)
2. **F3** — `guardUserSwitch`'e localStorage temizliği + `clearLocalData` sıra değişimi + register'da `ft_last_uid`. (3 küçük değişiklik, paylaşılan cihaz senaryosunu kapatır.)
3. **F2** — marka çözümlemesini varsayılan kapalı bir ayara bağla. (Mahremiyet; F3'teki kalıntı sorununu da kaynağında küçültür.)
4. **H1** — CSP'ye `report-to` ekle, ihlalleri izle, sonra enforce'a geç. Enforce **F6'yı da kapatır**.
5. **F4 + F5** — `from` taban sınırı, negatif TTL, LRU tavanı, basit rate limit.
6. **H2 + H11** — Canlı DB ile depoyu uzlaştır: `supabase_schema.sql`'e eksik `categorySplits` ve `user_backups` parçalarını ekle, `rls_auto_enable()` + `ensure_rls` event trigger'ını `0010` migration'ı olarak commit'le. İkisi de aynı sorunun belirtisi — üretim veritabanı depodan ileride ve fark sessiz. (Felaket kurtarma güvencesi.)

**Uydurulmuş bulgu yok.** Sömürü senaryosu yazamadığım her madde 3. bölümde "sertleştirme" olarak duruyor; bakamadığım her şey 5. bölümde.

---

## 7. Uygulanan düzeltmeler (2026-08-29)

Kullanıcı onayı: *"ne gerekliyse onları yap, benim verime ve ürün kararıma dokunmadığı sürece."*
Buna göre **veriye dokunmayan ve ürün davranışını değiştirmeyen** düzeltmeler uygulandı; geri kalanlar açık bırakıldı.

### Yapılanlar

| Bulgu | Dosya | Değişiklik |
|---|---|---|
| **F1** | `supabase/migrations/0009_...sql` | `workspaces` tombstone'u + upsert'i `has_workspaces` koşuluna bağlandı. Yedekte çalışma alanı yoksa tabloya HİÇ dokunulmuyor (canlı 0004 davranışıyla aynı). Başlığa ve doğrulama listesine F1 kontrolü eklendi. **Migration çalıştırılmadı.** |
| **F3** | `src/lib/auth.ts` | `clearBrowserStorage()` ayrı fonksiyona çıkarıldı; `clearLocalData()` içinde storage temizliği Dexie'den **önce**ye alındı — Dexie hatası artık storage temizliğini iptal etmiyor. |
| **F3** | `src/lib/sync/engine.ts` | `guardUserSwitch()` artık `clearBrowserStorage()` de çağırıyor. İkinci savunma katmanı kendi kendine yeter hâle geldi; `fintrack.brandDomain.v1` (anahtarları önceki kullanıcının işlem açıklamaları) kullanıcı değişiminde siliniyor. |
| **F3** | `src/app/register/page.tsx` | Kayıt akışı giriş akışıyla simetrik hâle getirildi: `ft_last_uid` yazılıyor + kullanıcı değişiminde `clearLocalData()` ve hard navigation. İşaretçi yalnızca `data.session` varken yazılıyor. |
| **F5** | `src/lib/server/bounded-cache.ts` *(yeni)* | Boyutu sınırlı, yaklaşık-LRU süreç-içi önbellek. `src/lib/server/bounded-cache.test.ts` ile 8 test (biri açık F5 regresyon koruması: 10.000 benzersiz yazma sonrası boyut tavanı aşmıyor). |
| **F5** | `api/brand-logo/route.ts` | Sınırsız `Map` → `BoundedCache(2000)`. Anahtar serbest metin olduğu için tavan şarttı. |
| **F5** | `api/prices/tefas/route.ts` | Sınırsız `Map` → `BoundedCache(500)`. |
| **F4** | `api/prices/history/route.ts` | Başarısız gün için 60 sn'lik negatif not (`usdMiss`) — aynı isteğin tekrarı artık yüzlerce boş günü baştan çekmiyor. Süre `/api/prices/tefas`'taki `MISS_CACHE_TTL_MS` ile aynı. `usdCache` de tavanlandı (8000). |
| **H2** | `supabase_schema.sql` | Eksik `transactions."categorySplits"` eklendi + başa "bu dosya tek başına yeterli değildir, 0001..0010 da uygulanmalı" uyarısı (hangi parçanın hangi migration'da olduğu listelendi). |
| **H11** | `supabase/migrations/0010_rls_auto_enable.sql` *(yeni)* | Canlı DB'de var olan ama depoda olmayan `rls_auto_enable()` + `ensure_rls` event trigger'ı kayda geçirildi. Tek davranış farkı: sessiz `raise log` → görünür `raise warning` (RLS açma başarısız olursa artık fark edilir). Üretimde çalıştırmak idempotent. |

**Doğrulama:** `vitest` 372 passed / 2 expected-fail (öncesi 364 — fark yeni `BoundedCache` testleri), `tsc --noEmit` temiz, `eslint` temiz, `next build` başarılı.

**Dokunulmayanlar:** Kullanıcı verisi, canlı Supabase (hiçbir sorgu/migration çalıştırılmadı), ve önceki bug-audit turundan çalışma ağacında bekleyen commit'lenmemiş değişiklikler (`seq` sürüm kapısı ve arkadaşları) — onlar ayrı tutuldu.

### Bilinçli olarak YAPILMAYANLAR (karar sende)

| Bulgu | Neden yapılmadı | Karar |
|---|---|---|
| **F2** | Marka çözümlemesini varsayılan kapatmak işlem satırlarındaki ikonların çoğunu kaldırır — bu bir ürün/UX kararı, güvenlik düzeltmesi değil. | Ayar ekleyip **varsayılanı kapalı** mı yapalım (mahremiyet önce), yoksa **açık** bırakıp yalnızca anahtar mı sunalım (davranış aynı kalır)? Üçüncü seçenek: yalnızca `recipient.name` gönder, serbest açıklamayı hiç gönderme. |
| **F4** kalanı | `from` için taban sınırı, grafiklerin ne kadar geriye gidebileceğini kısar. Mevcut tavan ~11 yıl (4000 gün). | Taban 5 yıla çekilsin mi? |
| **F6** | İki seçenek de risk taşıyor: CSP enforce uygulamayı bozabilir (speed-insights'ın nonce'suz inline script'i), allow-list ise kullanıcının kendi yapıştırdığı meşru ikon URL'lerini reddedebilir. | Önce H1 (CSP report-to + izleme) yapılsın, enforce'a geçiş F6'yı kendiliğinden kapatır. |
| **H1** | `report-to` eklemek bir toplayıcı seçmeyi gerektiriyor; enforce'a geçiş test edilmeden riskli. | Toplayıcı tercihi + enforce'a geçiş takvimi. |
| **H9, H10** | Davranış değişikliği içeriyor (onar diyaloğunun içeriği, "tüm veriyi sil"in kapsamı). | Metin/kapsam kararı. |

