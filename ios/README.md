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
| Özet | Onay bekleyenler (tek dokunuşla onay), ay harcaması + geçen ayın aynı dönemi, kategori halkası, son 6 ay grafiği, hesaplar, bütçeler, son işlemler |
| İşlemler | Arama, süzgeç (tür/dönem/hesap/onay bekleyen), sonuç toplamı; kaydır: düzenle · sil · kopyala · onayla |
| Hesaplar | Net değer, hesaplar, borçlar; kredi kartında dönem içi / son ekstre ve ekstre geçmişi |
| Yatırımlar | Portföy, K/Z, günlük değişim |
| Plan | Bütçe · Hedef · Tekrarlayan · Abonelik |

Hızlı erişim: ana ekran / kilit ekranı widget'ı, Denetim Merkezi düğmesi (iOS 18), Siri
("FinTrack ile harcama ekle").

## Simülatörde örnek veriyle çalıştırma

Debug derlemede `-demo` başlatma argümanı gerçek hesap yerine örnek veri yükler; buluta hiçbir
şey yazılmaz. Xcode'da: Product → Scheme → Edit Scheme → Run → Arguments → `-demo`.
Ekran doğrulaması için ek argümanlar (yalnız DEBUG): `-tab transactions|accounts|investments|budgets`,
`-plan budgets|goals|recurring|subscriptions`, `-quickadd`, `-search <metin>`,
`-account <hesap-id> [-statements]`.

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
- Hedefler: iOS tüm alanları yazar; "Ekle/Çıkar" yalnız `savedAmount` (işlem oluşturmaz).
- Abonelik = gider üzerinde `abonelik` etiketi; diğer etiketler korunur.
- Çevrimdışı: ağ yoksa satır cihazdaki kuyruğa (`Outbox`) girer, bağlantı gelince gönderilir;
  sunucudaki `keep_newer_row` sırayı korur.
- Ödeme Takibi (`payment_plans` / `payment_occurrences`) iOS'ta yalnız okunur (kart ekstresi
  tarihleri için).

## Güvenlik

- Oturum belirteçleri Keychain'de `AfterFirstUnlockThisDeviceOnly` (yedekle taşınmaz).
- Face ID kilidi (hemen / 1 / 5 / 15 dk), uygulama değiştiricide gizlilik perdesi.
- Önbellek ve çevrimdışı kuyruk: cihaz kilitliyken okunamaz, iCloud yedeğine girmez, çıkışta silinir.
- Kilit ekranı widget'larında tutarlar cihaz kilitliyken gizlenir.
