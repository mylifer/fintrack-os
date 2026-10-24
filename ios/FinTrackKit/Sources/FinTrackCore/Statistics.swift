import Foundation

/* ── İstatistikler — web src/app/(main)/statistics + components/reports/
   DetailedStats.tsx ────────────────────────────────────────────────────────
   Dönem: Bu ay / Geçen ay / Son 3 ay / Bu yıl / Tüm zamanlar / Özel.
   • Taksitler satın alma ayına tek satır (reportTransactions), yalnız işlenmiş.
   • Mutabakat satırları hiçbir analize girmez.
   • Dönem toplamı ve ortalamalar: anapara hareketleri hariç; "fon getirileri
     dahil" kapalıysa gerçekleşen yatırım K/Z'si de hariç.
   • Dağılım (en çok kategori / alıcı): TÜM ikonlu satırlar hariç (donut ile aynı).
─────────────────────────────────────────────────────────────────────────── */

public enum Statistics {
    public enum Preset: String, CaseIterable, Sendable {
        case thisMonth, lastMonth, threeMonths, thisYear, allTime, custom
        public var label: String {
            switch self {
            case .thisMonth: "Bu ay"
            case .lastMonth: "Geçen ay"
            case .threeMonths: "Son 3 ay"
            case .thisYear: "Bu yıl"
            case .allTime: "Tüm zamanlar"
            case .custom: "Özel"
            }
        }
    }

    public struct Average: Equatable, Sendable {
        public var total: Double
        public var daily: Double
        public var monthly: Double
        public var yearly: Double
    }

    public struct Rank: Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var color: String
        public var amount: Double
        public var pct: Double
    }

    public struct Counts: Equatable, Sendable {
        public var expense = 0, income = 0, transfer = 0, refund = 0, total = 0
    }

    public struct Result: Equatable, Sendable {
        public var from: String
        public var to: String
        public var days: Int
        public var counts: Counts
        public var expense: Average
        public var income: Average
        public var topExpenseCategories: [Rank]
        public var topIncomeCategories: [Rank]
        public var topExpensePayees: [Rank]
        public var topIncomePayees: [Rank]
    }

    public static func isRealizedInvestmentPnl(_ t: Transaction) -> Bool {
        t.icon != nil && (t.description.hasSuffix("Satış Kârı") || t.description.hasSuffix("Satış Zararı")
                          || t.description.hasSuffix("Satış Stopajı"))
    }

    /// Ön ayarın aralığı; "Tüm zamanlar" işlemlerin ilk/son gününden.
    public static func range(_ p: Preset, customFrom: String, customTo: String, transactions: [Transaction],
                             today: String = DateUtil.today()) -> (from: String, to: String) {
        guard let d = DateUtil.parseDay(today) else { return (today, today) }
        let my = MonthYear.current(d)
        switch p {
        case .thisMonth: return DateUtil.monthRange(my)
        case .lastMonth: return DateUtil.monthRange(my.previous)
        case .threeMonths: return (DateUtil.monthRange(my.previous.previous).from, DateUtil.monthRange(my).to)
        case .thisYear: return DateUtil.yearRange(my.year)
        case .allTime:
            let days = transactions.map { String($0.date.prefix(10)) }.filter { !$0.isEmpty }
            if let mn = days.min(), let mx = days.max() { return (mn, mx) }
            return DateUtil.yearRange(my.year)
        case .custom:
            return (customFrom.isEmpty ? DateUtil.monthRange(my).from : customFrom,
                    customTo.isEmpty ? DateUtil.monthRange(my).to : customTo)
        }
    }

    /// Kategori yolu "Üst > Alt" (web resolveCategoryPath, en çok 3 seviye)
    public static func categoryPath(_ id: String, _ cats: [Category]) -> String {
        var names: [String] = []
        var cur = cats.first { $0.id == id }
        var depth = 0
        while let c = cur, depth < 3 {
            names.insert(c.name, at: 0)
            cur = c.parentId.flatMap { p in cats.first { $0.id == p } }
            depth += 1
        }
        return names.isEmpty ? "Kategorisiz" : names.joined(separator: " > ")
    }

    public static func compute(reportTransactions: [Transaction], from: String, to: String, accountId: String?,
                               categories: [Category], people: [Person], fx: FX, includeFundGain: Bool,
                               asOf: String = DateUtil.today()) -> Result {
        let filtered = Calc.excludeFuture(reportTransactions, asOf: asOf).filter { t in
            let d = String(t.date.prefix(10))
            guard d >= from && d <= to else { return false }
            if let a = accountId, t.accountId != a && t.toAccountId != a { return false }
            return true
        }
        // Etkin başlangıç: dönemdeki ilk işlem (ortalamalar gerçek etkinlikten)
        let first = filtered.map { String($0.date.prefix(10)) }.min()
        let effFrom = first.map { $0 > from ? $0 : from } ?? from
        let txs = filtered.filter { !Calc.isReconciliation($0) }

        var c = Counts()
        for t in txs {
            switch t.type {
            case .expense: if t.amount < 0 { c.refund += 1 } else { c.expense += 1 }
            case .income: c.income += 1
            case .transfer: c.transfer += 1
            }
        }
        c.total = txs.count

        let days = max(1, Deposit.daysBetween(effFrom, to) + 1)
        func avg(_ total: Double) -> Average {
            Average(total: total, daily: total / Double(days),
                    monthly: total / max(1, Double(days) / 30.44), yearly: total / max(1, Double(days) / 365))
        }
        func gate(_ t: Transaction) -> Bool { !Calc.isPrincipalMove(t) && (includeFundGain || !isRealizedInvestmentPnl(t)) }
        let expense = Money.sum(txs.filter { $0.type == .expense && gate($0) }) { fx.baseAmount($0) }
        let income = Money.sum(txs.filter { $0.type == .income && gate($0) }) { fx.baseAmount($0) }

        let distExpense = Money.sum(txs.filter { $0.type == .expense && $0.icon == nil }) { fx.baseAmount($0) }
        let distIncome = Money.sum(txs.filter { $0.type == .income && $0.icon == nil }) { fx.baseAmount($0) }

        func topCategories(_ type: TransactionType, _ total: Double) -> [Rank] {
            var minor: [String: Int] = [:]
            for t in txs where t.type == type && t.icon == nil {
                for s in Calc.categorySlices(t) {
                    minor[s.categoryId ?? "", default: 0] += Money.toMinor(s.amountTry ?? fx.toBaseTry(s.amount, t.currency))
                }
            }
            return minor.map { k, m in
                let amount = Money.toMajor(m)
                let cat = categories.first { $0.id == k }
                return Rank(id: k.isEmpty ? "__none__" : k, name: k.isEmpty ? "Kategorisiz" : categoryPath(k, categories),
                            color: cat?.color ?? "#8C8C8C", amount: amount, pct: total > 0 ? amount / total * 100 : 0)
            }
            .sorted { $0.amount != $1.amount ? $0.amount > $1.amount : $0.name < $1.name }
            .prefix(5).map { $0 }
        }

        func topPayees(_ type: TransactionType, _ total: Double) -> [Rank] {
            var groups: [String: (name: String, minor: Int)] = [:]
            for t in txs where t.type == type && t.icon == nil {
                let person = t.recipientId.flatMap { id in people.first { $0.id == id }?.name }
                guard let name = person ?? t.merchant?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { continue }
                let key = person != nil ? "p:\(t.recipientId!)" : "m:\(name)"
                groups[key, default: (name, 0)].minor += Money.toMinor(fx.baseAmount(t))
            }
            return groups.map { k, g in
                let amount = Money.toMajor(g.minor)
                return Rank(id: k, name: g.name, color: "#8C8C8C", amount: amount, pct: total > 0 ? amount / total * 100 : 0)
            }
            .sorted { $0.amount != $1.amount ? $0.amount > $1.amount : $0.name < $1.name }
            .prefix(5).map { $0 }
        }

        return Result(from: effFrom, to: to, days: days, counts: c, expense: avg(expense), income: avg(income),
                      topExpenseCategories: topCategories(.expense, distExpense),
                      topIncomeCategories: topCategories(.income, distIncome),
                      topExpensePayees: topPayees(.expense, distExpense),
                      topIncomePayees: topPayees(.income, distIncome))
    }
}
