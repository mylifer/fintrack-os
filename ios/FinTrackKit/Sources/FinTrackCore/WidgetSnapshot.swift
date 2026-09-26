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

    public var month: String            // "2026-09"
    public var monthTitle: String       // "Eylül 2026"
    public var expense: Double
    public var income: Double
    public var net: Double
    public var netWorth: Double
    public var budgetSpent: Double
    public var budgetLimit: Double
    public var budgets: [BudgetLine]    // en dolu ilk 3
    public var amountsHidden: Bool
    public var updatedAt: Date

    public init(month: String, monthTitle: String, expense: Double, income: Double, net: Double,
                netWorth: Double, budgetSpent: Double, budgetLimit: Double, budgets: [BudgetLine],
                amountsHidden: Bool, updatedAt: Date) {
        self.month = month; self.monthTitle = monthTitle; self.expense = expense; self.income = income
        self.net = net; self.netWorth = netWorth; self.budgetSpent = budgetSpent; self.budgetLimit = budgetLimit
        self.budgets = budgets; self.amountsHidden = amountsHidden; self.updatedAt = updatedAt
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
