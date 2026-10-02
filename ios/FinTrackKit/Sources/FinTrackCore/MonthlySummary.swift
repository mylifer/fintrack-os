import Foundation

/// Aylık Özet — web src/lib/utils/monthly-summary.ts birebir: bir ayın
/// gelir/gider/net/tasarruf oranı, önceki ay ve geçen yılın aynı ayıyla kıyas,
/// en çok harcanan kategoriler ve en büyük tekil giderler.
///
/// Kural: taksitler satın alma ayına toplu (çağıran `Installments.collapse`
/// verir), yalnız işlenmiş satırlar, mutabakat hariç. Web'deki "Fon getirisi"
/// anahtarı iOS'ta yok; varsayılanı (açık → realize K/Z dahil) uygulanır.
///
/// DEVAM EDEN AY: kıyas dönemleri de aynı gün sayısına kırpılır (1–26 Eylül ↔
/// 1–26 Ağustos ↔ 1–26 Eylül geçen yıl); yarım ayı tam ayla kıyaslamak her ayı
/// "harcama düştü" gösterirdi.
public struct MonthlySummary: Sendable {
    public struct Flow: Sendable, Equatable {
        public var from: String
        public var to: String
        public var income: Double
        public var expense: Double
        public var net: Double
        /// net / gelir × 100; gelir yoksa nil
        public var savingsRate: Double?
    }

    public struct CategoryRow: Sendable, Identifiable {
        public var categoryId: String?
        public var amount: Double
        public var prevAmount: Double
        public var yearAmount: Double
        /// önceki aya göre % değişim; önceki ay 0 ise nil ("yeni")
        public var change: Double?
        public var id: String { categoryId ?? "__none__" }
    }

    public var current: Flow
    public var previous: Flow
    public var lastYear: Flow
    /// ay devam ediyorsa true — kıyaslar aynı gün sayısına kırpılmıştır
    public var partial: Bool
    public var daysCounted: Int
    public var daysInMonth: Int
    public var dailyAvgExpense: Double
    public var txCount: Int
    public var categories: [CategoryRow]
    /// önceki aya göre en çok artan 3 kategori (tutar farkına göre)
    public var increases: [CategoryRow]
    public var largestExpenses: [Transaction]

    /// web pctChange: önceki 0 ise (şimdiki de 0 → 0, değilse nil = "yeni")
    public static func pctChange(_ current: Double, _ prev: Double) -> Double? {
        if prev == 0 { return current == 0 ? 0 : nil }
        return (current - prev) / abs(prev) * 100
    }

    /// Ayın ilk 7 gününde varsayılan geçen ay: "ay sonu özeti" en çok o zaman açılır.
    public static func defaultMonth(today: String = DateUtil.today()) -> MonthYear {
        guard let d = DateUtil.parseDay(today) else { return .current() }
        let my = MonthYear.current(d)
        return DateUtil.calendar.component(.day, from: d) <= 7 ? my.previous : my
    }

    /// Ayın ilk `days` günü (ay kısaysa ay sonuna kırpılır).
    static func slice(_ my: MonthYear, days: Int) -> (from: String, to: String) {
        let r = DateUtil.monthRange(my)
        let last = Int(r.to.suffix(2)) ?? 28
        return (r.from, String(r.from.prefix(8)) + String(format: "%02d", min(days, last)))
    }

    /// `reportTransactions`: taksitleri toplanmış liste (AppModel.reportTransactions).
    public static func build(_ reportTransactions: [Transaction], month my: MonthYear, fx: FX,
                             asOf: String = DateUtil.today()) -> MonthlySummary {
        let ledger = Calc.excludeFuture(reportTransactions, asOf: asOf).filter { !Calc.isReconciliation($0) }

        let range = DateUtil.monthRange(my)
        let daysInMonth = Int(range.to.suffix(2)) ?? 30
        let partial = asOf >= range.from && asOf < range.to
        let daysCounted = partial ? (Int(asOf.prefix(10).suffix(2)) ?? daysInMonth) : daysInMonth

        let curRange = slice(my, days: daysCounted)
        // Tam ayda kıyas ayı da TAM (31 Ağustos'a karşı 30 Eylül değil, tüm Ağustos)
        var yearMy = my
        yearMy.year -= 1
        let prevRange = slice(my.previous, days: partial ? daysCounted : 31)
        let yearRange = slice(yearMy, days: partial ? daysCounted : 31)

        func flow(_ r: (from: String, to: String)) -> Flow {
            let f = Calc.periodFlow(ledger, from: r.from, to: r.to, fx: fx, asOf: asOf)
            return Flow(from: r.from, to: r.to, income: f.income, expense: f.expense, net: f.net,
                        savingsRate: f.income > 0 ? f.net / f.income * 100 : nil)
        }
        func within(_ r: (from: String, to: String)) -> [Transaction] {
            ledger.filter { DateUtil.isInRange($0.date, r.from, r.to) }
        }

        let curTxs = within(curRange)
        let byCur = Calc.expenseByCategory(curTxs, fx: fx)
        let byPrev = Calc.expenseByCategory(within(prevRange), fx: fx)
        let byYear = Calc.expenseByCategory(within(yearRange), fx: fx)

        var rows = byCur.keys.map { k -> CategoryRow in
            let amount = byCur[k] ?? 0, prev = byPrev[k] ?? 0
            return CategoryRow(categoryId: k.isEmpty ? nil : k, amount: amount, prevAmount: prev,
                               yearAmount: byYear[k] ?? 0, change: pctChange(amount, prev))
        }.filter { $0.amount > 0 }
        // Eşit tutarda web'deki gibi ilk görülme sırası (Map ekleme sırası, kararlı sıralama)
        var firstSeen: [String: Int] = [:]
        for t in curTxs where t.type == .expense && t.icon == nil {
            for sl in Calc.categorySlices(t) where firstSeen[sl.categoryId ?? ""] == nil {
                firstSeen[sl.categoryId ?? ""] = firstSeen.count
            }
        }
        rows.sort {
            if $0.amount != $1.amount { return $0.amount > $1.amount }
            return (firstSeen[$0.categoryId ?? ""] ?? .max) < (firstSeen[$1.categoryId ?? ""] ?? .max)
        }

        let increases = rows
            .filter { $0.amount - $0.prevAmount > 0 && $0.prevAmount > 0 }
            .enumerated()
            .sorted { a, b in
                let x = a.element.amount - a.element.prevAmount, y = b.element.amount - b.element.prevAmount
                return x != y ? x > y : a.offset < b.offset
            }
            .prefix(3)
            .map(\.element)

        let largest = curTxs
            .filter { $0.type == .expense && $0.icon == nil }
            .enumerated()
            .sorted { a, b in
                let x = fx.baseAmount(a.element), y = fx.baseAmount(b.element)
                return x != y ? x > y : a.offset < b.offset   // kararlı (web Array.sort)
            }
            .prefix(5)
            .map(\.element)

        let current = flow(curRange)
        return MonthlySummary(
            current: current, previous: flow(prevRange), lastYear: flow(yearRange),
            partial: partial, daysCounted: daysCounted, daysInMonth: daysInMonth,
            dailyAvgExpense: daysCounted > 0 ? current.expense / Double(daysCounted) : 0,
            txCount: curTxs.filter { $0.type != .transfer }.count,
            categories: rows, increases: Array(increases), largestExpenses: Array(largest))
    }
}
