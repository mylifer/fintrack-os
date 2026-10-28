import Foundation
#if canImport(Security)
import Security
#endif

/// Uygulamanın ana ekran widget'ı için yazdığı özet. Widget ağa çıkmaz ve oturum
/// taşımaz; yalnız bunu okur. App Group'taki paylaşılan UserDefaults'ta durur.
public struct WidgetSnapshot: Codable, Hashable, Sendable {
    public struct BudgetLine: Codable, Hashable, Sendable {
        public var name: String
        public var colorHex: String
        public var spent: Double
        public var limit: Double
        public var percent: Double
        public var status: String   // ok | warning | exceeded
        public init(name: String, colorHex: String, spent: Double, limit: Double, percent: Double, status: String) {
            self.name = name; self.colorHex = colorHex; self.spent = spent
            self.limit = limit; self.percent = percent; self.status = status
        }
    }

    /// Yaklaşan ödeme / tekrarlayan / planlı işlem (widget "Yaklaşanlar")
    public struct UpcomingLine: Codable, Hashable, Sendable {
        public var title: String
        public var date: String         // yyyy-MM-dd
        public var amount: Double
        public var currency: String
        public var isIncome: Bool
        public var kind: String         // cardDue | recurring | planned
        public init(title: String, date: String, amount: Double, currency: String, isIncome: Bool, kind: String) {
            self.title = title; self.date = date; self.amount = amount
            self.currency = currency; self.isIncome = isIncome; self.kind = kind
        }
    }

    public var month: String            // "2026-09"
    public var monthTitle: String       // "Eylül 2026"
    public var expense: Double
    public var income: Double
    public var net: Double
    public var netWorth: Double
    public var budgetSpent: Double
    public var budgetLimit: Double
    public var budgets: [BudgetLine]    // en dolu ilk 6 (orta boy ilk 3ünü gösterir)
    public var amountsHidden: Bool
    public var updatedAt: Date
    /// Onay bekleyen (tarihi gelmiş işlem + vadesi gelen tekrarlayan) sayısı.
    /// Eski özetlerde yok → 0.
    public var pendingCount: Int = 0
    /// Önümüzdeki 14 gün, tarih ↑ (en çok 8). Eski özetlerde yok → boş.
    public var upcoming: [UpcomingLine] = []

    public init(month: String, monthTitle: String, expense: Double, income: Double, net: Double,
                netWorth: Double, budgetSpent: Double, budgetLimit: Double, budgets: [BudgetLine],
                amountsHidden: Bool, updatedAt: Date, pendingCount: Int = 0, upcoming: [UpcomingLine] = []) {
        self.month = month; self.monthTitle = monthTitle; self.expense = expense; self.income = income
        self.net = net; self.netWorth = netWorth; self.budgetSpent = budgetSpent; self.budgetLimit = budgetLimit
        self.budgets = budgets; self.amountsHidden = amountsHidden; self.updatedAt = updatedAt
        self.pendingCount = pendingCount
        self.upcoming = upcoming
    }

    enum CodingKeys: String, CodingKey {
        case month, monthTitle, expense, income, net, netWorth, budgetSpent, budgetLimit, budgets
        case amountsHidden, updatedAt, pendingCount, upcoming
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        month = try c.decode(String.self, forKey: .month)
        monthTitle = try c.decode(String.self, forKey: .monthTitle)
        expense = try c.decode(Double.self, forKey: .expense)
        income = try c.decode(Double.self, forKey: .income)
        net = try c.decode(Double.self, forKey: .net)
        netWorth = try c.decode(Double.self, forKey: .netWorth)
        budgetSpent = try c.decode(Double.self, forKey: .budgetSpent)
        budgetLimit = try c.decode(Double.self, forKey: .budgetLimit)
        budgets = try c.decode([BudgetLine].self, forKey: .budgets)
        amountsHidden = try c.decode(Bool.self, forKey: .amountsHidden)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        pendingCount = try c.decodeIfPresent(Int.self, forKey: .pendingCount) ?? 0
        upcoming = try c.decodeIfPresent([UpcomingLine].self, forKey: .upcoming) ?? []
    }

    /// Uygulama ve widget'ın ortak App Group'u (Info.plist FTAppGroup ← Base.xcconfig)
    public static let appGroup: String = {
        if let g = Bundle.main.object(forInfoDictionaryKey: "FTAppGroup") as? String, !g.isEmpty, !g.hasPrefix("$(") { return g }
        return "group.com.mylifer.fintrack"
    }()
    static let key = "fintrack.widgetSnapshot"

    /// Ortak keychain grubu (Info.plist FTKeychainGroup = <ekip>.<paket>.shared). App Group'u
    /// olmayan imzalarda (CI'dan TestFlight) widget veriyi buradan okur.
    public static let keychainGroup: String? = {
        guard let g = Bundle.main.object(forInfoDictionaryKey: "FTKeychainGroup") as? String,
              !g.isEmpty, !g.contains("$("), !g.hasPrefix(".") else { return nil }
        return g
    }()

    public static func load() -> WidgetSnapshot? {
        let data = UserDefaults(suiteName: appGroup)?.data(forKey: key) ?? SharedKeychain.read(key, group: keychainGroup)
        guard let data else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.appGroup)?.set(data, forKey: Self.key)
        SharedKeychain.write(data, Self.key, group: Self.keychainGroup)
    }

    public static func clear() {
        UserDefaults(suiteName: appGroup)?.removeObject(forKey: key)
        SharedKeychain.delete(key, group: keychainGroup)
    }

    /// Bu ayın özeti mi? (Ay dönünce widget eski ayı göstermesin.)
    public var isCurrentMonth: Bool { month == String(DateUtil.today().prefix(7)) }
}

/// Uygulama ile widget arasında küçük veri: ortak keychain grubu. Grup yoksa ya da
/// keychain erişilemezse (Linux testleri, imzasız simülatör) sessizce hiçbir şey yapmaz.
enum SharedKeychain {
    #if canImport(Security)
    private static func query(_ key: String, _ group: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "orbit.shared",
         kSecAttrAccount as String: key, kSecAttrAccessGroup as String: group]
    }

    static func read(_ key: String, group: String?) -> Data? {
        guard let group else { return nil }
        var q = query(key, group)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func write(_ data: Data, _ key: String, group: String?) {
        guard let group else { return }
        let q = query(key, group)
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            _ = SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }

    static func delete(_ key: String, group: String?) {
        guard let group else { return }
        _ = SecItemDelete(query(key, group) as CFDictionary)
    }
    #else
    static func read(_ key: String, group: String?) -> Data? { nil }
    static func write(_ data: Data, _ key: String, group: String?) {}
    static func delete(_ key: String, group: String?) {}
    #endif
}
