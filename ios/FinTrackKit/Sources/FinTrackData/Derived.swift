import Foundation
import FinTrackCore

/// Özet / widget / bütçe ekranlarının pahalı türetimleri — veri değişince bir kez,
/// ana iş parçacığı dışında hesaplanır (20 bin işlemde her çizimde yeniden
/// hesaplamak takılma yaratıyordu). Girdiler değer tipleri: yarış yok.
public struct Derived: Sendable {
    public struct MonthFlow: Sendable { public var month: MonthYear; public var flow: Calc.Flow }

    public var month: MonthYear
    public var monthFlow: Calc.Flow
    /// Son 6 ay (eskiden yeniye)
    public var series: [MonthFlow]
    public var monthToDate: (current: Double, previous: Double)
    /// Bu ayın giderleri, kategori id → TRY (alt kategoriler ayrı)
    public var expenseByCategory: [String: Double]
    /// Bu ayın bütçe durumları (doluluk ↓)
    public var budgetStates: [Calc.BudgetState]
    /// Kredi kartı id → açık dönem + son 12 ekstre
    public var cards: [String: CardStatementResult]

    struct Input: Sendable {
        var transactions: [Transaction]
        var reportTransactions: [Transaction]
        var accounts: [Account]
        var categories: [FinTrackCore.Category]
        var budgets: [Budget]
        var plans: [PaymentPlan]
        var occurrences: [PaymentOccurrence]
        var fx: FX
    }

    static func compute(_ i: Input) -> Derived {
        let my = MonthYear.current()
        let r = DateUtil.monthRange(my)
        let inMonth = i.reportTransactions.filter { Calc.isFlow($0) && DateUtil.isInRange($0.date, r.from, r.to) }
        var cards: [String: CardStatementResult] = [:]
        for a in i.accounts where a.type == .credit_card && !a.isArchived {
            cards[a.id] = CardStatements.forCard(a, accounts: i.accounts, transactions: i.transactions,
                                                 plans: i.plans, occurrences: i.occurrences, fx: i.fx, count: 12)
        }
        return Derived(
            month: my,
            monthFlow: Calc.monthlyFlow(i.reportTransactions, my, fx: i.fx),
            series: Calc.monthlySeries(i.reportTransactions, endingAt: my, count: 6, fx: i.fx)
                .map { MonthFlow(month: $0.month, flow: $0.flow) },
            monthToDate: Calc.monthToDateExpense(i.reportTransactions, fx: i.fx),
            expenseByCategory: Calc.expenseByCategory(inMonth, fx: i.fx),
            budgetStates: AppModel.budgetStates(i.budgets, i.reportTransactions, my, categories: i.categories, fx: i.fx),
            cards: cards)
    }
}
