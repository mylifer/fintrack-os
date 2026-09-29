import Foundation

/* ── Abonelikler — web src/lib/utils/subscriptions.ts + src/lib/subscriptions/brands.ts ──
   Abonelik, tekrarlayan şablonlara BAĞLI DEĞİL: kullanıcının rezerve `abonelik`
   etiketiyle işaretlediği GİDER işlemleri üzerinde türetilmiş bir görünümdür.
   Aynı markaya (Netflix, Spotify, …) giden ödemeler tek grupta toplanır;
   tanınmayanlar normalize edilmiş açıklamaya göre gruplanır.

   Saf modül: store/DB yok. Toplamlar kuruş-tam `Money.sum` ile (asla çıplak +),
   TRY değeri `fx.baseAmount` (snapshot), aylık tahmin `fx.toBaseTry` (CANLI kur)
   ile — web ile aynı. Girdi, çalışma alanının canlı işlem listesinin TAMAMI:
   tarih ya da onay filtresi YOK (gelecek tarihli / onay bekleyen etiketliler dahil).

   Değişiklik gerekirse önce web tarafı ve subscriptions.test.ts, sonra burası ve
   SubscriptionsTests.swift. Logo SVG path verisi taşınmadı; yalnızca `hasLogo`.
─────────────────────────────────────────────────────────────────────────── */

/// Marka kaydı (web `Brand`). `hasLogo` = web'de gömülü simple-icons `path` var mı
/// (yoksa monogram + marka rengi).
public struct SubscriptionBrand: Hashable, Sendable, Identifiable {
    public let key: String
    public let name: String
    /// '#' + hex — marka rengi (logo/monogram tonu).
    public let colorHex: String
    /// Küçük harf, aksan duyarsız eşleşme terimleri (kayıttaki sırayla).
    public let keywords: [String]
    public let hasLogo: Bool

    public var id: String { key }

    public init(key: String, name: String, colorHex: String, keywords: [String], hasLogo: Bool) {
        self.key = key
        self.name = name
        self.colorHex = colorHex
        self.keywords = keywords
        self.hasLogo = hasLogo
    }
}

/// Son ödeme bir öncekinden (aynı para birimi) yüksekse: zam.
public struct SubscriptionPriceChange: Hashable, Sendable {
    public let from: Double
    public let to: Double
    public let pct: Double
    /// Zamlı ilk ödemenin tarihi.
    public let date: String
}

public struct SubscriptionGroup: Hashable, Sendable, Identifiable {
    /// `brand:<key>` ya da `desc:<normalize(açıklama) || diger>` (detay bağlantısı).
    public let key: String
    public let brand: SubscriptionBrand?
    public let name: String
    public let currency: CurrencyCode
    /// En yeni ödemenin ham tutarı (`currency` cinsinden).
    public let latestAmount: Double
    /// En yeni ödemenin tarihi.
    public let lastDate: String
    /// Gruptaki ödeme sayısı.
    public let count: Int
    /// Tüm ödemelerin TRY toplamı (snapshot — baseAmount).
    public let totalTry: Double
    /// En yeni ödeme aylık fiyat sayılır, CANLI kurla TRY (sıklık girdisi yok).
    public let monthlyEstimateTry: Double
    public let priceChange: SubscriptionPriceChange?
    /// Ödemeler, en yeni önce.
    public let txs: [Transaction]

    public var id: String { key }
}

public struct SubscriptionsSummary: Hashable, Sendable {
    public let groups: [SubscriptionGroup]
    public let serviceCount: Int
    public let monthTotalTry: Double
    public let monthlyEstimateTry: Double
}

public struct SubscriptionMonthService: Hashable, Sendable, Identifiable {
    /// SubscriptionGroup ile aynı anahtar (detay bağlantısı).
    public let key: String
    public let brand: SubscriptionBrand?
    public let name: String
    /// O ay bu servise yapılan ödeme sayısı.
    public let count: Int
    public let totalTry: Double

    public var id: String { key }
}

public struct SubscriptionMonth: Hashable, Sendable, Identifiable {
    /// YYYY-MM
    public let month: String
    public let totalTry: Double
    public let count: Int
    /// En yüksek harcama önce.
    public let services: [SubscriptionMonthService]

    public var id: String { month }
}

/// Aylık geçmiş penceresi: son N ay (sıfır dolgulu) ya da en eski ödemeden itibaren
/// tümü (web `months: number | 'all'`). Tam sayı literali `.count(n)` demektir.
public enum SubscriptionHistoryRange: Hashable, Sendable, ExpressibleByIntegerLiteral {
    case count(Int)
    case all

    public init(integerLiteral value: Int) { self = .count(value) }
}

public enum Subscriptions {
    /// Bir gideri abonelik yapan rezerve etiket.
    public static let tag = "abonelik"

    // Kur/yuvarlama oynamasını zam saymamak için alt sınır (%1)
    static let priceUpMinPct: Double = 1

    // MARK: Metin normalizasyonu

    /// Küçük harf + Türkçe/aksan temizliği + boşluk sıkıştırma; "Netflix",
    /// "netflıx", "NETFLİX" aynı samanlığa iner. Web ile aynı sıra:
    /// toLowerCase → ı→i → NFD → U+0300–U+036F sil → \s+ → ' ' → trim.
    /// Not: `lowercased()` (yerel ayarsız, JS toLowerCase gibi) "İ"yi "i̇" (i + U+0307)
    /// yapar; U+0307 silme adımında düşer. ı'nın NFD ayrışımı yok, elle eşlenir.
    public static func normalize(_ text: String) -> String {
        let lowered = text.lowercased().replacingOccurrences(of: "ı", with: "i")
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for s in lowered.decomposedStringWithCanonicalMapping.unicodeScalars {
            if (0x300...0x36F).contains(s.value) { continue }
            if isJSWhitespace(s) { pendingSpace = true; continue }
            // Boşluk koşusu tek ' ' olur; baştaki/sondaki atılır (trim).
            if pendingSpace && !out.isEmpty { out.append(" ") }
            pendingSpace = false
            out.append(s)
        }
        return String(out)
    }

    /// JS `\s` / `String.prototype.trim` kümesi (Swift'in isWhitespace'i U+0085'i
    /// içerir, U+FEFF'i içermez — birebirlik için elle).
    static func isJSWhitespace(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A,
             0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    /// JS `trim()` karşılığı.
    static func jsTrim(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        guard let first = scalars.firstIndex(where: { !isJSWhitespace($0) }),
              let last = scalars.lastIndex(where: { !isJSWhitespace($0) }) else { return "" }
        var view = String.UnicodeScalarView()
        view.append(contentsOf: scalars[first...last])
        return String(view)
    }

    // MARK: Etiket

    /// Tek etiket rezerve abonelik etiketi mi (büyük/küçük harf, Türkçe duyarsız).
    public static func isSubscriptionTag(_ tag: String) -> Bool {
        normalize(tag) == Subscriptions.tag
    }

    /// Etiket listesi abonelik etiketini içeriyor mu.
    public static func hasSubscriptionTag(_ tags: [String]?) -> Bool {
        (tags ?? []).contains(where: isSubscriptionTag)
    }

    /// Etiketli gider = abonelik ödemesi.
    public static func isSubscriptionTx(_ t: Transaction) -> Bool {
        t.type == .expense && hasSubscriptionTag(t.tags)
    }

    // MARK: Marka kaydı (web BRANDS ile aynı sıra — eşit uzunlukta anahtar
    // kelimede kayıt sırası kazanır, sıra DEĞİŞMEMELİ)

    public static let brands: [SubscriptionBrand] = [
        b("netflix", "Netflix", "#E50914", ["netflix"]),
        b("spotify", "Spotify", "#1ED760", ["spotify"]),
        b("youtubemusic", "YouTube Music", "#FF0000", ["youtube music", "yt music"]),
        b("youtube", "YouTube", "#FF0000", ["youtube", "youtube premium"]),
        b("apple", "Apple", "#000000",
          ["apple music", "apple tv", "apple one", "apple arcade", "app store", "appstore", "icloud", "apple"]),
        b("google", "Google", "#4285F4", ["google one", "google play", "google workspace", "google"]),
        b("notion", "Notion", "#000000", ["notion"]),
        b("github", "GitHub", "#181717", ["github copilot", "github", "copilot"]),
        b("figma", "Figma", "#F24E1E", ["figma"]),
        b("dropbox", "Dropbox", "#0061FF", ["dropbox"]),
        b("discord", "Discord", "#5865F2", ["discord nitro", "discord"]),
        b("twitch", "Twitch", "#9146FF", ["twitch"]),
        b("steam", "Steam", "#000000", ["steam"]),
        b("playstation", "PlayStation", "#0070D1",
          ["playstation plus", "playstation", "play station", "ps plus", "psn"]),
        b("max", "Max", "#002BE7", ["hbo max", "hbomax", "hbo", "max"]),
        b("mubi", "MUBI", "#000000", ["mubi"]),
        b("audible", "Audible", "#F8991C", ["audible"]),
        b("duolingo", "Duolingo", "#58CC02", ["duolingo"]),
        b("patreon", "Patreon", "#000000", ["patreon"]),
        b("medium", "Medium", "#000000", ["medium"]),

        // Eski simple-icons sürümlerinden gömülü logolar (web başlık notu)
        b("primevideo", "Amazon Prime Video", "#00A8E1",
          ["amazon prime video", "prime video", "amazon prime", "primevideo", "prime"]),
        b("amazon", "Amazon", "#FF9900", ["amazon"]),
        b("microsoft", "Microsoft", "#5E5E5E", ["microsoft 365", "office 365", "microsoft", "office"]),
        b("adobe", "Adobe", "#ED1C24", ["adobe creative cloud", "creative cloud", "adobe"]),
        b("openai", "OpenAI", "#10A37F", ["chatgpt plus", "chatgpt", "chat gpt", "openai"]),
        b("canva", "Canva", "#00C4CC", ["canva"]),
        b("xbox", "Xbox", "#107C10", ["xbox game pass", "game pass", "xbox"]),
        b("nintendo", "Nintendo", "#E60012", ["nintendo switch online", "nintendo switch", "nintendo"]),
        b("linkedin", "LinkedIn", "#0A66C2", ["linkedin premium", "linkedin"]),

        // Yalnızca anahtar kelime: logo yok → monogram
        b("disneyplus", "Disney+", "#113CCF", ["disney plus", "disneyplus", "disney+", "disney"], logo: false),
        b("storytel", "Storytel", "#FF3D3D", ["storytel"], logo: false),

        // Türk servisleri
        b("blutv", "BluTV", "#0055FF", ["blutv", "blu tv"], logo: false),
        b("exxen", "Exxen", "#33E0A1", ["exxen"], logo: false),
        b("gain", "Gain", "#7C3AED", ["gain"], logo: false),
        b("tabii", "Tabii", "#00A99D", ["tabii"], logo: false),
        b("tod", "TOD (beIN)", "#7A1FA2", ["bein connect", "bein", "tod"], logo: false),
        b("puhutv", "Puhu TV", "#FF6A00", ["puhutv", "puhu tv", "puhu"], logo: false),
        b("tvplus", "TV+", "#009FE3", ["tv+", "tvplus", "tv plus"], logo: false),
        b("fizy", "Fizy", "#E6007E", ["fizy"], logo: false),
    ]

    private static func b(_ key: String, _ name: String, _ color: String, _ keywords: [String],
                          logo: Bool = true) -> SubscriptionBrand {
        SubscriptionBrand(key: key, name: name, colorHex: color, keywords: keywords, hasLogo: logo)
    }

    /// (marka, normalize anahtar kelime) çiftleri, EN UZUN önce — daha özel eşleşme
    /// ("youtube music", "apple music", "hbo max") kısa olanı ("youtube", "apple",
    /// "max") yener. Uzunluk JS `.length` (UTF-16); eşitlikte kayıt sırası (kararlı).
    static let keywordIndex: [(brand: SubscriptionBrand, kw: [UInt16])] = brands
        .flatMap { brand in brand.keywords.map { (brand: brand, kw: Array(normalize($0).utf16)) } }
        .enumerated()
        .sorted { a, b in
            a.element.kw.count != b.element.kw.count ? a.element.kw.count > b.element.kw.count : a.offset < b.offset
        }
        .map(\.element)

    /// JS `includes` gibi UTF-16 kod birimi alt dizi araması (Swift'in Character
    /// tabanlı `contains`'i grafem sınırına bakar — birebirlik için elle).
    static func includes(_ haystack: [UInt16], _ needle: [UInt16]) -> Bool {
        if needle.isEmpty { return true }
        if needle.count > haystack.count { return false }
        for start in 0...(haystack.count - needle.count) {
            var i = 0
            while i < needle.count && haystack[start + i] == needle[i] { i += 1 }
            if i == needle.count { return true }
        }
        return false
    }

    /// Verilen metinlerden (açıklama, not, satıcı) markayı bulur: ilk (en uzun
    /// anahtar kelimeli) eşleşme, yoksa nil.
    public static func detectBrand(_ texts: String?...) -> SubscriptionBrand? {
        detectBrand(texts)
    }

    public static func detectBrand(_ texts: [String?]) -> SubscriptionBrand? {
        let haystacks = texts
            .compactMap { t -> String? in
                guard let t, !jsTrim(t).isEmpty else { return nil }
                return t
            }
            .map { Array(normalize($0).utf16) }
        if haystacks.isEmpty { return nil }
        for entry in keywordIndex where haystacks.contains(where: { includes($0, entry.kw) }) {
            return entry.brand
        }
        return nil
    }

    // MARK: Zam

    /// En yeni ödeme ile bir önceki arasındaki artış (`ordered` en yeni önce).
    public static func detectPriceChange(_ ordered: [Transaction]) -> SubscriptionPriceChange? {
        guard ordered.count >= 2 else { return nil }
        let latest = ordered[0], prev = ordered[1]
        guard latest.currency == prev.currency, prev.amount > 0 else { return nil }
        let pct = ((latest.amount - prev.amount) / prev.amount) * 100
        if pct < priceUpMinPct { return nil }
        return SubscriptionPriceChange(from: prev.amount, to: latest.amount, pct: pct, date: latest.date)
    }

    // MARK: Gruplama

    /// Tek ödemenin marka + grup anahtarı. Aynı markaya çözülenler birleşir;
    /// tanınmayanlar normalize açıklamaya göre gruplanır.
    static func resolve(_ t: Transaction) -> (key: String, brand: SubscriptionBrand?) {
        if let brand = detectBrand(t.description, t.notes, t.merchant) {
            return ("brand:\(brand.key)", brand)
        }
        let norm = normalize(t.description)
        return ("desc:\(norm.isEmpty ? "diger" : norm)", nil)
    }

    /// En yeni önce: tarih, eşitlikte createdAt (web `newerFirst`). Tam eşitlikte
    /// giriş sırası korunur (JS sort kararlı).
    static func newerFirst(_ txs: [Transaction]) -> [Transaction] {
        txs.enumerated().sorted { a, b in
            let x = a.element, y = b.element
            if x.date != y.date { return x.date > y.date }
            if x.createdAt != y.createdAt { return x.createdAt > y.createdAt }
            return a.offset < b.offset
        }.map(\.element)
    }

    /// Abonelik ödemelerini markaya (ya da açıklamaya) göre gruplar; aylık tahmine
    /// göre azalan (eşitlikte ilk görülme sırası).
    public static func groupSubscriptions(_ txs: [Transaction], fx: FX) -> [SubscriptionGroup] {
        var order: [String] = []
        var buckets: [String: (brand: SubscriptionBrand?, txs: [Transaction])] = [:]

        for t in txs where isSubscriptionTx(t) {
            let (key, brand) = resolve(t)
            if var bucket = buckets[key] {
                bucket.txs.append(t)
                // Kovada ilk görülen marka kalır
                if bucket.brand == nil, let brand { bucket.brand = brand }
                buckets[key] = bucket
            } else {
                order.append(key)
                buckets[key] = (brand, [t])
            }
        }

        let groups: [SubscriptionGroup] = order.map { key in
            let bucket = buckets[key]!
            let ordered = newerFirst(bucket.txs)
            let latest = ordered[0]
            let trimmed = jsTrim(latest.description)
            return SubscriptionGroup(
                key: key,
                brand: bucket.brand,
                name: bucket.brand?.name ?? (trimmed.isEmpty ? "Abonelik" : trimmed),
                currency: latest.currency,
                latestAmount: latest.amount,
                lastDate: latest.date,
                count: ordered.count,
                totalTry: Money.sum(ordered) { fx.baseAmount($0) },
                monthlyEstimateTry: fx.toBaseTry(latest.amount, latest.currency),
                priceChange: detectPriceChange(ordered),
                txs: ordered
            )
        }

        return groups.enumerated().sorted { a, b in
            a.element.monthlyEstimateTry != b.element.monthlyEstimateTry
                ? a.element.monthlyEstimateTry > b.element.monthlyEstimateTry
                : a.offset < b.offset
        }.map(\.element)
    }

    /// Grupları yeniden hesaplar ve `key`'e uyanı döndürür (detay ekranı), yoksa nil.
    public static func findSubscriptionGroup(_ txs: [Transaction], key: String, fx: FX) -> SubscriptionGroup? {
        groupSubscriptions(txs, fx: fx).first { $0.key == key }
    }

    // MARK: Özet

    /// Abonelik görünümü özeti. `monthStr` (YYYY-MM) test için enjekte edilebilir;
    /// varsayılan bu ay.
    public static func summarize(_ txs: [Transaction], monthStr: String = String(DateUtil.today().prefix(7)),
                                 fx: FX) -> SubscriptionsSummary {
        let groups = groupSubscriptions(txs, fx: fx)
        let monthCharges = txs.filter { isSubscriptionTx($0) && String($0.date.prefix(7)) == monthStr }
        return SubscriptionsSummary(
            groups: groups,
            serviceCount: groups.count,
            monthTotalTry: Money.sum(monthCharges) { fx.baseAmount($0) },
            monthlyEstimateTry: Money.sum(groups) { $0.monthlyEstimateTry }
        )
    }

    // MARK: Aylık geçmiş

    /// YYYY-MM ayını `delta` ay kaydırır (web `shiftMonth`).
    static func shiftMonth(_ month: String, _ delta: Int) -> String {
        let parts = month.split(separator: "-", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
        let y = parts.first ?? 0, m = parts.count > 1 ? parts[1] : 0
        let idx = y * 12 + (m - 1) + delta
        let year = Int((Double(idx) / 12).rounded(.down))
        return "\(year)-\(String(format: "%02d", idx % 12 + 1))"
    }

    /// Takvim ayı başına abonelik harcaması, en eski önce, `endMonth`'ta (YYYY-MM,
    /// varsayılan bu ay) biter. `months` pencere uzunluğu (sıfır dolgulu) ya da
    /// `.all` (en eski ödemeden başlar). `endMonth`'tan sonraki ödemeler dışarıda.
    /// Ay kovası `summarize` ile aynı `date.prefix(7)` kuralı — bu ayın toplamı
    /// `monthTotalTry`'a eşit; servisler grup anahtarını/adını taşır (detay bağlantısı).
    public static func subscriptionMonthlyHistory(_ txs: [Transaction], months: SubscriptionHistoryRange = 12,
                                                  endMonth: String = String(DateUtil.today().prefix(7)),
                                                  fx: FX) -> [SubscriptionMonth] {
        let groups = groupSubscriptions(txs, fx: fx)

        // ay → grup anahtarı → ödemeler (ekleme sırası korunur)
        var buckets: [String: (order: [String], byGroup: [String: [Transaction]])] = [:]
        var earliest: String?
        for g in groups {
            for t in g.txs {
                let month = String(t.date.prefix(7))
                if month > endMonth { continue }
                if earliest == nil || month < earliest! { earliest = month }
                var bucket = buckets[month] ?? ([], [:])
                if bucket.byGroup[g.key] == nil { bucket.order.append(g.key) }
                bucket.byGroup[g.key, default: []].append(t)
                buckets[month] = bucket
            }
        }

        let startMonth: String
        switch months {
        case .all:
            guard let earliest else { return [] }
            startMonth = earliest
        case .count(let n):
            startMonth = shiftMonth(endMonth, -(max(1, n) - 1))
        }

        let groupByKey = Dictionary(groups.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        var history: [SubscriptionMonth] = []
        var month = startMonth
        while month <= endMonth {
            var services: [SubscriptionMonthService] = []
            if let bucket = buckets[month] {
                for key in bucket.order {
                    let g = groupByKey[key]!
                    let list = bucket.byGroup[key]!
                    services.append(SubscriptionMonthService(
                        key: key, brand: g.brand, name: g.name, count: list.count,
                        totalTry: Money.sum(list) { fx.baseAmount($0) }))
                }
            }
            // Tutar azalan, eşitlikte ad (Türkçe sıralama), sonra giriş sırası (kararlı)
            let tr = Locale(identifier: "tr_TR")
            services = services.enumerated().sorted { a, b in
                let x = a.element, y = b.element
                if x.totalTry != y.totalTry { return x.totalTry > y.totalTry }
                let c = x.name.compare(y.name, locale: tr)
                if c != .orderedSame { return c == .orderedAscending }
                return a.offset < b.offset
            }.map(\.element)
            history.append(SubscriptionMonth(
                month: month,
                totalTry: Money.sum(services) { $0.totalTry },
                count: services.reduce(0) { $0 + $1.count },
                services: services
            ))
            month = shiftMonth(month, 1)
        }
        return history
    }
}
