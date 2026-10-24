# FinTrack iOS (SwiftUI)

Web ile aynı Supabase'e bağlanan, günlük kullanım için native iPhone uygulaması.
Plan ve veri kuralları: [docs/ios-native-plan.md](../docs/ios-native-plan.md).

## iPhone'a kurulum (Apple Developer hesabıyla, App Store'suz)

Uygulama App Store'da yayınlanmaz; Xcode doğrudan sizin iPhone'unuza kurar. Ücretli
Apple Developer hesabıyla kurulan uygulama **1 yıl** çalışır (ücretsiz hesapta 7 gün).

**Bir kez (Mac'te):**

1. App Store'dan **Xcode 27** (ya da daha yenisi). İlk açılışta iOS bileşenlerini indirin.
2. Repoyu alın ve bu dala geçin:
   ```sh
   git clone https://github.com/mylifer/fintrack-os.git && cd fintrack-os
   git checkout claude/clever-davinci-dm7r4v      # birleştirildiyse: master
   ```
3. Windows'taki `.env.local`'ı repo köküne kopyalayın (USB / iCloud Drive; sohbete ya da GitHub'a
   yapıştırmayın), sonra anahtar dosyasını üretin:
   ```sh
   ios/scripts/make-secrets.sh
   ```
4. `ios/FinTrack.xcodeproj`'u açın. **Xcode → Settings → Accounts → +** ile Developer hesabınızın
   Apple kimliğini ekleyin.
5. Sol panelde **FinTrack** projesi → **FinTrack** hedefi → **Signing & Capabilities** →
   *Automatically manage signing* açık, **Team** = Developer ekibiniz (Personal Team DEĞİL).
   Aynısını **FinTrackWidget** hedefinde yapın.
   - "*… identifier is not available*" hatası çıkarsa (kimlik daha önce başka ekiple/ücretsiz
     hesapla alınmışsa): `cp ios/Config/Local.example.xcconfig ios/Config/Local.xcconfig`, içinde
     `FT_BUNDLE_ID = com.adiniz.fintrack` satırını açın; Xcode'u kapatıp açın. Widget ve App Group
     kimlikleri buradan türetilir. İsterseniz `DEVELOPMENT_TEAM` da oraya yazılır.
6. iPhone'u kabloyla bağlayın → telefonda "Bu bilgisayara güven". **Ayarlar → Gizlilik ve Güvenlik →
   Geliştirici Modu**'nu açın (telefon yeniden başlar).
7. Xcode'un üst çubuğunda hedef olarak iPhone'unuzu seçin. Günlük kullanım için hızlı derleme:
   **Product → Scheme → Edit Scheme → Run → Build Configuration: Release**.
8. **Product → Run (⌘R)**. Uygulama telefona kurulur ve açılır; kabloyu çıkarabilirsiniz.
   "Güvenilmeyen geliştirici" uyarısı çıkarsa: **Ayarlar → Genel → VPN ve Aygıt Yönetimi** →
   Developer uygulaması → Güven.

**Güncellerken:** `git pull`, sonra yine ⌘R (veriler bulutta, telefondaki oturum kalır).
Bir yıl dolmadan bir kez daha ⌘R yapmak süreyi yeniler.

**Kablosuz / Mac'siz kurulum (isteğe bağlı): TestFlight.** App Store Connect'te uygulama kaydı
açılıp **Product → Archive → Distribute App → TestFlight (Internal Only)** ile yüklenirse,
iPhone'daki TestFlight uygulamasından kurulur; incelemeye gönderilmez, herkese açılmaz. Her yükleme
90 gün geçerlidir.

## Geliştirme

- Örnek veriyle simülatör: Scheme → Run → Arguments → `-demo` (aşağıda).
- Testler: `cd ios/FinTrackKit && swift test` (Linux'ta da çalışır: FinTrackCore).
- GitHub Actions (`.github/workflows/ios.yml`): her `ios/` değişikliğinde Mac'te test, simülatör
  derlemesi ve örnek veriyle ekran görüntüleri.

## Yapı

| Klasör | İçerik |
| --- | --- |
| `FinTrack/` | SwiftUI ekranları. Xcode klasörü eşitler: buraya eklenen dosya otomatik derlenir. |
| `FinTrackKit/Sources/FinTrackCore` | Modeller, para/tarih, bakiye-akış-bütçe hesapları (web `src/lib/utils` karşılıkları). Bağımlılık yok. |
| `FinTrackKit/Sources/FinTrackData` | Supabase oturumu (+ TOTP), okuma/yazma, `AppModel`. |
| `Config/` | `Base.xcconfig`, `Info.plist`; `Secrets.xcconfig` git dışı. |

## Test

```sh
cd ios/FinTrackKit && swift test
```

Testler web'deki `calculations.test.ts` / `money.test.ts` girdileriyle aynıdır; bir hesap kuralı
değişirse iki taraf birlikte güncellenir.

## Ekranlar

| Sekme | İçerik |
| --- | --- |
| Özet | Onay bekleyenler (tek dokunuşla onay), ay harcaması + geçen ayın aynı dönemi, kategori halkası (dokun → kategori raporu), yaklaşanlar (7 gün), son 6 ay grafiği (→ aylık özet: gelir/gider/net/tasarruf, önceki ay ve geçen yılla kıyas, paylaş), hesaplar, bütçeler, son işlemler |
| İşlemler | Arama, süzgeç (tür/dönem/hesap/etiket/kişi/onay bekleyen), etiketler (sayı, toplam → işlemler), sonuç toplamı, CSV paylaş, tekrarlayanların gelecek dönemleri; kaydır: düzenle · sil · kopyala · onayla |
| Hesaplar | Net değer, Ödeme Takibi, nakit akışı tahmini, hesaplar (90 gün bakiye seyri; vadeli hesapta vade özeti + faizi işle), borçlar (ödeme yap, taksit planı); kredi kartında dönem içi / son ekstre, ekstre geçmişi, "Ekstreyi öde" |
| Yatırımlar | Portföy, K/Z, günlük değişim |
| Plan | Bütçe · Hedef · Tekrarlayan · Abonelik |

Bildirimler (Ayarlar → Hatırlatmalar): kart son ödeme günü, tekrarlayan ve planlı işlemler (sabah 9),
bütçe uyarı eşiği geçilince / aşılınca (web bildirim merkezindeki gibi bütçe + ay + durum başına bir kez).

Hızlı erişim: uygulama simgesine basılı tut (gider / gelir / transfer ekle, bütçeler), ana ekran / kilit ekranı widget'ları (Bu ay, Net değer, Yaklaşanlar), Denetim Merkezi düğmesi (iOS 18), Siri
("FinTrack ile harcama ekle", "FinTrack bu ay ne kadar harcadım" — uygulamayı açmadan cevaplar; cihaz
kilitliyse önce kilit açılır, "Tutarları gizle" açıksa tutar söylenmez).

## Simülatörde örnek veriyle çalıştırma

Debug derlemede `-demo` başlatma argümanı gerçek hesap yerine örnek veri yükler; buluta hiçbir
şey yazılmaz. Xcode'da: Product → Scheme → Edit Scheme → Run → Arguments → `-demo`.
Ekran doğrulaması için ek argümanlar (yalnız DEBUG): `-tab transactions|accounts|investments|budgets`,
`-plan budgets|goals|recurring|subscriptions`, `-quickadd`, `-search <metin>`,
`-account <hesap-id> [-statements] [-reconcile] [-processdeposit]`, `-debt <id>`, `-payments`, `-forecast`, `-report`, `-monthly`, `-tags`, `-edit <açıklama>`, `-openurl <fintrack://…>`,
`-settings`, `-newrecurring`, `-newbudget`, `-lock -noautounlock`.

Performans: `-demo -stress` örnek veriye 20 bin işlem ekler. Ağır hesaplar (aylık akış,
kategori dağılımı, bütçe durumları, kart ekstreleri, öneri dizini) arka planda bir kez yapılır
(`Derived`); işlem listesi 400'lük sayfalarla çizilir, kaydırdıkça devamı gelir. Bu veride
her sekme birkaç saniye içinde açılmalı.

## Web ile aynı veriye yazmanın kuralları (özet)

- Satırın tamamı `upsert(onConflict: "id")`, her yazmada `updatedAt` (JS `toISOString` biçimi);
  damga satırdakinden eski olmaz (+1 ms) — saati ileri bir cihazın düzenlediği satırda `keep_newer_row`
  iOS yazmasını sessizce yok saymasın.
- Ham satır korunur: iOS'un bilmediği sütunlar düzenlemede kaybolmaz.
- Silme = `deleted_at` damgası; okurken silinmişler gizlenir.
- Başka kayıtlara bağlı işlemler (taksit, borç, yatırım, bölünmüş kategori, çalışma alanı
  transferi, mutabakat, iade) iOS'ta düzenlenemez/silinemez — yan etkileri yalnız web'de doğru
  uygulanıyor. **Onaylanabilirler**: onay yalnız `approvalStatus` + `approvedAt` değiştirir.
- Gelecek tarihli yeni işlem `approvalStatus = 'pending'` doğar; yabancı para biriminde kur yoksa
  `amountTry` yazılmaz (web ile aynı).
- Tekrarlayan onayı: kaçırılan her dönem için `deterministicUuid("recur:<şablon>:<tarih>")`
  kimlikli işlem, sonra şablonun `nextDueDate` / `lastGeneratedDate`'i. Atla yalnız imleci ilerletir.
- Tekrarlayan şablon ve bütçe ekleme/düzenleme web formlarının kurallarıyla (`RecurringDraft`,
  `BudgetDraft`); yazmada yalnız değişen alanlar ham satırın üstüne konur.
- Hedefler: iOS tüm alanları yazar; "Ekle/Çıkar" yalnız `savedAmount` (işlem oluşturmaz).
- Borç ödemesi: tek bacaklı transfer (`debtId`, `toAccountId` yok, "<ad> ödemesi") + borç satırı
  (`paidAmount` += TRY değeri, `paidInstallments` +1, `isSettled`). Düz borç ödemesi silinince borç
  geri alınır; düzenlenince tutar/borç farkı borca yansır (web mutabakatı).
- Alacak tahsilatı: gelir tipli, `debtId`'li, 🤝 ikonlu satır; gelir sayılmaz, kalan alacağı aşamaz.
- Faiz stopajı: Faiz kategorili gelir BRÜT yazılır; stopaj ayrı gider (Vergi, alıcı İTC), kimliği
  `interest-tax:<faiz id>`'den türetilir; düzenleme/silme birlikte.
- Çalışma alanları arası transfer: iki (borç ödemeli üç) satır, ortak `workspaceTransferId`; hiçbiri
  akışa girmez; herhangi bir bacak silinince hepsi silinir ve borç ödemesi geri alınır.
- Etiketler: web `tags.ts` kuralı — yazmada `Tags.dedupe` (boşluk kırpma, Türkçe büyük/küçük harf
  tekrarı atılır); etikete dokunulmadıysa ham liste aynen kalır. Toplu yeniden adlandırma web'de.
- Abonelik = gider üzerinde `abonelik` etiketi; diğer etiketler korunur.
- Kişiler (web `people`): ekle, yeniden adlandır, arşivle (silinmez); işlemde `familyMemberId`,
  `recipientId`; transferde boş yazılır (web formu gibi).
- Hesaplar / borçlar / kategoriler / yatırımlar / çalışma alanları: iOS'tan eklenir ve düzenlenir;
  kurallar web formlarıyla aynı (bkz. `FinTrackCore/*Draft.swift`, `InvestmentTrade.swift`).
- Çevrimdışı: ağ yoksa satır cihazdaki kuyruğa (`Outbox`) girer, bağlantı gelince gönderilir;
  sunucudaki `keep_newer_row` sırayı korur.
- Ödeme Takibi: takvim web `schedule.ts` ile birebir. "Öde" = web `payRow`: isteğe bağlı ödeme
  işlemi (+ borçta borç satırı) ve ayın `payment_occurrences` kaydı "ödendi" (deterministik
  kimlik, var olan satırın üstüne birleştirilir; tutar/vade dondurulur). Düzenle (bu ay / bu ve
  sonraki aylar), atla, ödendiyi geri al, sıfırla ve plan ayarları web `actions.ts` ile aynı
  (`PaymentEdits.swift`); Kart Takvimi web `CardCalendar` ile aynı yazımlar.
- Bakiye eşitleme: web `ReconcileBalanceModal` — fark tek satır, `systemKind='reconciliation'`,
  `#BakiyeEşitleme`; akışlara/bütçelere/ekstreye girmez. Eşitleme satırı silinebilir.
- Vadeli mevduat: web `deposit.ts` (basit faiz, stopaj, net). "Faizi işle" = web
  `processDepositInterest`. Önce buluttan taze veri çekilir (çevrimdışıysa işlenmez). Faiz satırının
  kimliği web ile AYNI formülden (`deposit:<hesap>:<vade sonu>`): iki cihaz aynı vadeyi işlese de tek
  satır. O vadenin faizi (kimlikle ya da eski rastgele kimlikli satır içerikle) zaten varsa yazılmaz. Net faiz vade
  sonu tarihli gelir; hesapta yalnız `deposit*` sütunları KISMİ güncellenir (`update … eq id`, tam satır
  değil — web'in değiştirdiği alanlar ezilmez). Vade koşulları hesap formunda girilir.
- Taksitli alışveriş: web `addInstallmentGroup` (kuruş hassas bölme, ilk taksitlere artan,
  aylık tarihler, hepsi onaylı, ortak `installGroupId`). Silme tüm grubu siler; düzenleme web'de.

## Güvenlik

- Oturum belirteçleri Keychain'de `AfterFirstUnlockThisDeviceOnly` (yedekle taşınmaz).
- Face ID kilidi (hemen / 1 / 5 / 15 dk), uygulama değiştiricide gizlilik perdesi.
- Önbellek ve çevrimdışı kuyruk: cihaz kilitliyken okunamaz, iCloud yedeğine girmez, çıkışta silinir.
- Kilit ekranı widget'larında tutarlar cihaz kilitliyken gizlenir.
