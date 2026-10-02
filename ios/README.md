# FinTrack iOS (SwiftUI)

Web ile aynı Supabase'e bağlanan, günlük kullanım için native iPhone uygulaması.
Plan ve veri kuralları: [docs/ios-native-plan.md](../docs/ios-native-plan.md).

## Kurulum

1. Anahtarları üret (repo kökündeki `.env.local`'dan; çıktı git dışı):
   ```sh
   ios/scripts/make-secrets.sh
   ```
2. `ios/FinTrack.xcodeproj`'u Xcode'da aç.
3. Telefona kurmak için: FinTrack hedefi → Signing & Capabilities → Team = Apple kimliğin.
   Paket kimliği (`com.mylifer.fintrack`) başka bir hesapta alınmışsa değiştir.

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
| İşlemler | Arama, süzgeç (tür/dönem/hesap/etiket/onay bekleyen), etiketler (sayı, toplam → işlemler), sonuç toplamı, CSV paylaş, tekrarlayanların gelecek dönemleri; kaydır: düzenle · sil · kopyala · onayla |
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

- Satırın tamamı `upsert(onConflict: "id")`, her yazmada `updatedAt` (JS `toISOString` biçimi).
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
  geri alınır; düzenlemesi web'de.
- Etiketler: web `tags.ts` kuralı — yazmada `Tags.dedupe` (boşluk kırpma, Türkçe büyük/küçük harf
  tekrarı atılır); etikete dokunulmadıysa ham liste aynen kalır. Yeniden adlandırma web'de.
- Abonelik = gider üzerinde `abonelik` etiketi; diğer etiketler korunur.
- Kişiler (web `people`): iOS yalnız okur ve işleme atar (`familyMemberId`, `recipientId`); transferde
  boş yazılır (web formu gibi), dokunulmazsa ham satır aynen kalır. Kişi ekleme/düzenleme web'de.
- Çevrimdışı: ağ yoksa satır cihazdaki kuyruğa (`Outbox`) girer, bağlantı gelince gönderilir;
  sunucudaki `keep_newer_row` sırayı korur.
- Ödeme Takibi: takvim web `schedule.ts` ile birebir. "Öde" = web `payRow`: isteğe bağlı ödeme
  işlemi (+ borçta borç satırı) ve ayın `payment_occurrences` kaydı "ödendi" (deterministik
  kimlik, var olan satırın üstüne birleştirilir; tutar/vade dondurulur). Tutar/gün düzenleme ve
  "atla" web'de; `payment_plans` yalnız okunur.
- Bakiye eşitleme: web `ReconcileBalanceModal` — fark tek satır, `systemKind='reconciliation'`,
  `#BakiyeEşitleme`; akışlara/bütçelere/ekstreye girmez. Eşitleme satırı silinebilir.
- Vadeli mevduat: web `deposit.ts` (basit faiz, stopaj, net). "Faizi işle" = web
  `processDepositInterest`. Önce buluttan taze veri çekilir (çevrimdışıysa işlenmez); o vadenin faiz
  satırı (web'in rastgele kimlikli satırı dahil, içerikle aranır) zaten varsa yazılmaz. Net faiz vade
  sonu tarihli gelir; hesapta yalnız `deposit*` sütunları KISMİ güncellenir (`update … eq id`, tam satır
  değil — web'in değiştirdiği alanlar ezilmez). Vade koşulları web'de girilir.
- Taksitli alışveriş: web `addInstallmentGroup` (kuruş hassas bölme, ilk taksitlere artan,
  aylık tarihler, hepsi onaylı, ortak `installGroupId`). Silme tüm grubu siler; düzenleme web'de.

## Güvenlik

- Oturum belirteçleri Keychain'de `AfterFirstUnlockThisDeviceOnly` (yedekle taşınmaz).
- Face ID kilidi (hemen / 1 / 5 / 15 dk), uygulama değiştiricide gizlilik perdesi.
- Önbellek ve çevrimdışı kuyruk: cihaz kilitliyken okunamaz, iCloud yedeğine girmez, çıkışta silinir.
- Kilit ekranı widget'larında tutarlar cihaz kilitliyken gizlenir.
