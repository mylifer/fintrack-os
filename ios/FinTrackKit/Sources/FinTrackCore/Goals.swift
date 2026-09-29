import Foundation

/// Birikim hedefi ilerlemesi — web src/lib/utils/goals.ts karşılığı. İlerleme
/// saklanmaz: bağlı hesap varsa onun bakiyesi (TRY'ye çevrilmiş), yoksa elle
/// girilen savedAmount.
public enum Goals {
    public struct Progress: Hashable, Sendable {
        public var current: Double
        public var remaining: Double
        public var percent: Double
        public var done: Bool
        public var overdue: Bool
        public var monthsLeft: Int?
        public var monthlyNeeded: Double?
        public var linkedAccountId: String?
    }

    /// Yalnız yıl-ay farkı, en az 1 (25 Eyl → Ara = 3).
    public static func monthsLeft(today: String, target: String) -> Int {
        let a = today.prefix(7).split(separator: "-").compactMap { Int($0) }
        let b = target.prefix(7).split(separator: "-").compactMap { Int($0) }
        guard a.count == 2, b.count == 2 else { return 1 }
        return max(1, (b[0] - a[0]) * 12 + (b[1] - a[1]))
    }

    /// `balances`: hesap id → kendi para birimindeki bakiye.
    public static func progress(_ g: SavingsGoal, accounts: [Account], balances: [String: Double],
                                fx: FX, today: String = DateUtil.today()) -> Progress {
        let linked = g.accountId.flatMap { id in accounts.first { $0.id == id && !$0.isArchived } }
        let current: Double
        if let a = linked {
            current = max(0, fx.toBaseTry(balances[a.id] ?? a.initialBalance, a.currency))
        } else {
            current = max(0, g.savedAmount ?? 0)
        }
        let remaining = max(0, Money.sub(g.targetAmount, current))
        let done = g.targetAmount > 0 && current >= g.targetAmount
        let percent = g.targetAmount > 0 ? min(100, current / g.targetAmount * 100) : 0
        let target = g.targetDate.map { String($0.prefix(10)) }
        let overdue = !done && target.map { $0 < today } == true
        let left = target != nil && !overdue ? monthsLeft(today: today, target: target!) : nil
        let monthly = left != nil && !done ? (remaining / Double(left!) * 100).rounded() / 100 : nil
        return Progress(current: current, remaining: remaining, percent: percent, done: done,
                        overdue: overdue, monthsLeft: left, monthlyNeeded: monthly, linkedAccountId: linked?.id)
    }

    /// Liste sırası: tamamlanmayanlar önce, sonra hedef tarihi (tarihsiz en sona), sonra ad.
    public static func sorted(_ goals: [SavingsGoal], progress: (SavingsGoal) -> Progress) -> [SavingsGoal] {
        let tr = Locale(identifier: "tr_TR")
        return goals.map { ($0, progress($0).done) }.sorted { a, b in
            if a.1 != b.1 { return !a.1 }
            let da = a.0.targetDate ?? "9999", db = b.0.targetDate ?? "9999"
            if da != db { return da < db }
            return a.0.name.compare(b.0.name, locale: tr) == .orderedAscending
        }.map(\.0)
    }

    /// "Ekle / Çıkar": savedAmount 0'ın altına inmez; işlem oluşturmaz.
    public static func adjusted(_ g: SavingsGoal, by delta: Double) -> SavingsGoal {
        var out = g
        out.savedAmount = max(0, Money.add(g.savedAmount ?? 0, delta))
        return out
    }
}
