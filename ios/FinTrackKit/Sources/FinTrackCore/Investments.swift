import Foundation

/* ── Yatırımlar — web src/store/investment.store.ts (computeHoldings,
   getAssetPrice, assetLabel) karşılığı. Varlık anahtarı web ile aynı metin:
   'GOLD_GRAM', 'USD', 'TEFAS:AFA', 'BIST:THYAO', 'CRYPTO:BTC'. ───────────── */

public struct InvestmentTransaction: SyncRecord, Hashable {
    public static let table = "investment_transactions"
    public let raw: JSONObject
    public let id: String
    public var type: String          // 'buy' | 'sell'
    public var asset: String
    public var quantity: Double
    public var pricePerUnit: Double  // TRY / birim
    public var date: String
    public var createdAt: String
    public var note: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        type = raw.str("type") ?? "buy"
        asset = raw.str("asset") ?? ""
        quantity = raw.num("quantity") ?? 0
        pricePerUnit = raw.num("pricePerUnit") ?? 0
        date = raw.str("date") ?? ""
        createdAt = raw.str("createdAt") ?? ""
        note = raw.str("note")
    }

    public func ownedColumns() -> JSONObject { [:] }   // iOS yatırım yazmaz (bağlı defter satırları web'de)
}

public enum AssetKind: String, CaseIterable, Sendable {
    case gold, currency, fund, stock, crypto

    public var label: String {
        switch self {
        case .gold: "Altın"
        case .currency: "Döviz"
        case .fund: "Fonlar"
        case .stock: "Hisseler"
        case .crypto: "Kripto"
        }
    }
}

public enum Asset {
    /// Gram altın karşılıkları (22 ayar ziynetler: brüt gramaj × 0,916).
    public static let goldGrams: [String: Double] = [
        "GOLD_GRAM": 1, "GOLD_QUARTER": 1.6067, "GOLD_HALF": 3.2133,
        "GOLD_FULL": 6.4267, "GOLD_OZ": 31.1035, "GOLD_BRACELET": 0.916,
    ]

    static let labels: [String: String] = [
        "GOLD_GRAM": "Gr Altın", "GOLD_QUARTER": "Çeyrek Altın", "GOLD_HALF": "Yarım Altın",
        "GOLD_FULL": "Tam Altın", "GOLD_OZ": "Ons Altın", "GOLD_BRACELET": "Gr Bilezik",
        "USD": "USD", "EUR": "EUR", "GBP": "GBP",
    ]

    public static func kind(_ asset: String) -> AssetKind {
        if asset.hasPrefix("TEFAS:") { return .fund }
        if asset.hasPrefix("BIST:") { return .stock }
        if asset.hasPrefix("CRYPTO:") { return .crypto }
        if asset.hasPrefix("GOLD_") { return .gold }
        return .currency
    }

    /// 'TEFAS:AFA' → 'AFA', 'BIST:THYAO' → 'THYAO'
    public static func code(_ asset: String) -> String {
        guard let i = asset.firstIndex(of: ":") else { return asset }
        return String(asset[asset.index(after: i)...])
    }

    public static func label(_ asset: String) -> String {
        switch kind(asset) {
        case .fund, .stock, .crypto: code(asset)
        default: labels[asset] ?? asset
        }
    }

    public static func unit(_ asset: String) -> String {
        switch kind(asset) {
        case .gold: asset == "GOLD_GRAM" || asset == "GOLD_BRACELET" ? "gr" : (asset == "GOLD_OZ" ? "ons" : "adet")
        case .currency: code(asset)
        case .fund: "pay"
        case .stock: "adet"
        case .crypto: code(asset)
        }
    }
}

/// Fiyatlar — web PriceData + fundPrices sözlüğü (fon kodu / tam piyasa anahtarı).
public struct PriceBook: Codable, Hashable, Sendable {
    public struct Quote: Codable, Hashable, Sendable {
        public var name: String
        public var price: Double
        public var prevPrice: Double?
        public var date: String
        public init(name: String, price: Double, prevPrice: Double?, date: String) {
            self.name = name; self.price = price; self.prevPrice = prevPrice; self.date = date
        }
    }

    public var usdTry: Double = 0, eurTry: Double = 0, gbpTry: Double = 0
    public var goldGramTry: Double = 0
    public var goldQuarterTry: Double?, goldHalfTry: Double?, goldFullTry: Double?, bilezikGramTry: Double?
    public var prevUsdTry: Double?, prevEurTry: Double?, prevGbpTry: Double?
    public var prevGoldGramTry: Double?, prevGoldQuarterTry: Double?, prevGoldHalfTry: Double?
    public var prevGoldFullTry: Double?, prevBilezikGramTry: Double?
    /// TEFAS: fon kodu ('AFA'); hisse/kripto: tam anahtar ('BIST:THYAO')
    public var quotes: [String: Quote] = [:]
    public var updatedAt: Date?

    public init() {}

    public var hasRates: Bool { usdTry > 0 }
    public var fxRates: FXRates? { hasRates ? FXRates(usdTry: usdTry, eurTry: eurTry, gbpTry: gbpTry) : nil }

    func quote(_ asset: String) -> Quote? {
        switch Asset.kind(asset) {
        case .fund: quotes[Asset.code(asset)]
        case .stock, .crypto: quotes[asset]
        default: nil
        }
    }

    /// Güncel birim fiyat (TRY); bilinmiyorsa 0 — web getAssetPrice.
    public func price(_ asset: String) -> Double {
        if let q = quote(asset) { return q.price }
        switch Asset.kind(asset) {
        case .fund, .stock, .crypto: return 0
        default: break
        }
        guard hasRates else { return 0 }
        if asset == "GOLD_QUARTER", let p = goldQuarterTry, p > 0 { return p }
        if asset == "GOLD_HALF", let p = goldHalfTry, p > 0 { return p }
        if asset == "GOLD_FULL", let p = goldFullTry, p > 0 { return p }
        if asset == "GOLD_BRACELET", let p = bilezikGramTry, p > 0 { return p }
        if let g = Asset.goldGrams[asset] { return goldGramTry * g }
        switch asset {
        case "USD": return usdTry
        case "EUR": return eurTry
        case "GBP": return gbpTry
        default: return 0
        }
    }

    /// Bir önceki kapanış (günlük değişim için); bilinmiyorsa nil.
    public func prevPrice(_ asset: String) -> Double? {
        if let q = quote(asset) { return q.prevPrice }
        switch asset {
        case "GOLD_QUARTER": if let p = prevGoldQuarterTry { return p }
        case "GOLD_HALF": if let p = prevGoldHalfTry { return p }
        case "GOLD_FULL": if let p = prevGoldFullTry { return p }
        case "GOLD_BRACELET": if let p = prevBilezikGramTry { return p }
        case "USD": return prevUsdTry
        case "EUR": return prevEurTry
        case "GBP": return prevGbpTry
        default: break
        }
        if let g = Asset.goldGrams[asset], let p = prevGoldGramTry { return p * g }
        return nil
    }
}

public struct Holding: Hashable, Sendable {
    public var asset: String
    public var quantity: Double
    public var avgCostPerUnit: Double
    public var totalCost: Double
    public var currentPrice: Double
    public var currentValue: Double
    public var pnl: Double
    public var pnlPercent: Double
    /// Günlük değişim (TRY); önceki kapanış bilinmiyorsa nil
    public var dayChange: Double?

    public var kind: AssetKind { Asset.kind(asset) }
    public var hasPrice: Bool { currentPrice > 0 }
}

public enum Portfolio {
    /// Ağırlıklı ortalama maliyet: alım maliyeti biriktirir, satış adedi düşer ve
    /// maliyeti ortalamayla orantılı azaltır (web computeHoldings birebir).
    public static func holdings(_ txs: [InvestmentTransaction], prices: PriceBook) -> [Holding] {
        let sorted = txs.sorted { $0.date != $1.date ? $0.date < $1.date : $0.createdAt < $1.createdAt }
        var order: [String] = []
        var pos: [String: (qty: Double, cost: Double)] = [:]
        for t in sorted {
            if pos[t.asset] == nil { pos[t.asset] = (0, 0); order.append(t.asset) }
            var p = pos[t.asset]!
            if t.type == "buy" {
                p.cost += t.quantity * t.pricePerUnit
                p.qty += t.quantity
            } else {
                let avg = p.qty > 0 ? p.cost / p.qty : 0
                p.qty = max(0, p.qty - t.quantity)
                p.cost = p.qty * avg
            }
            pos[t.asset] = p
        }
        return order.compactMap { asset in
            let p = pos[asset]!
            guard p.qty >= 0.000001 else { return nil }
            let price = prices.price(asset)
            let value = p.qty * price
            let pnl = value - p.cost
            let day = price > 0 ? prices.prevPrice(asset).map { p.qty * (price - $0) } : nil
            return Holding(asset: asset, quantity: p.qty, avgCostPerUnit: p.qty > 0 ? p.cost / p.qty : 0,
                           totalCost: p.cost, currentPrice: price, currentValue: value, pnl: pnl,
                           pnlPercent: p.cost > 0 ? pnl / p.cost * 100 : 0, dayChange: day)
        }
    }
}
