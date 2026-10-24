import Foundation

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

    public static let appGroup = "group.com.mylifer.fintrack"
    static let key = "fintrack.widgetSnapshot"

    public static func load() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    public func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.appGroup)?.set(data, forKey: Self.key)
    }

    public static func clear() {
        UserDefaults(suiteName: appGroup)?.removeObject(forKey: key)
    }

    /// Bu ayın özeti mi? (Ay dönünce widget eski ayı göstermesin.)
    public var isCurrentMonth: Bool { month == String(DateUtil.today().prefix(7)) }
}
