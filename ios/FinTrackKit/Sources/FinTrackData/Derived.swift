import Foundation
import FinTrackCore

/// Özet / widget / bütçe ekranlarının pahalı türetimleri — veri değişince bir kez,
/// ana iş parçacığı dışında hesaplanır (20 bin işlemde her çizimde yeniden
/// hesaplamak takılma yaratıyordu). Girdiler değer tipleri: yarış yok.
public struct Derived: Sendable {
    public struct MonthFlow: Sendable { public var month: MonthYear; public var flow: Calc.Flow }

    public var month: MonthYear
    /// Hesaplandığı gün ("gecikmiş", "bugün" gibi değerler güne bağlı)
    public var day: String
    /// Hangi alan ve bütçe kümesi için hesaplandı (eşleşmezse kullanılmaz)
    var workspaceId: String?
    var budgetsSignature: Int
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
    /// Ödeme Takibi: bu ayın özeti ve önceki aylardan gecikmiş sayısı
    public var paymentSummary: PaymentSummary
    public var paymentCarryOverdue: Int
    /// Hızlı ekleme önerileri için açıklama dizini
    public var suggestionIndex: Suggestions.Index
    /// Kullanılan etiketler (işlem sayısı ↓) — web aggregateTags
    public var tags: [Tags.Aggregate]

    struct Input: Sendable {
        var transactions: [Transaction]
        var reportTransactions: [Transaction]
        var accounts: [Account]
        var categories: [FinTrackCore.Category]
        var budgets: [Budget]
        var plans: [PaymentPlan]
        var occurrences: [PaymentOccurrence]
        var fx: FX
        var workspaceId: String?
        var debts: [Debt]
        var balances: [String: Double]
    }

    /// Bütçe kümesinin özeti — ekleme/düzenlemeden sonra eski durumlar gösterilmesin
    static func signature(_ budgets: [Budget]) -> Int {
        var h = Hasher()
        for b in budgets {
            h.combine(b.id); h.combine(b.categoryId); h.combine(b.amount)
            h.combine(b.rollover); h.combine(b.alertThreshold); h.combine(b.period)
        }
        return h.finalize()
    }

    static func paymentBoard(_ i: Input, month: String) -> (summary: PaymentSummary, carry: Int) {
        let rows = AppModel.paymentRows(accounts: i.accounts, debts: i.debts, plans: i.plans, occurrences: i.occurrences,
                                        transactions: i.transactions, balances: i.balances, fx: i.fx, month: month)
        return (PaymentSchedule.summarizeRows(rows.monthRows, fx: i.fx), rows.carryRows.count)
    }

    static func compute(_ i: Input) -> Derived {
        let my = MonthYear.current()
        let r = DateUtil.monthRange(my)
        let inMonth = i.reportTransactions.filter { Calc.isFlow($0) && DateUtil.isInRange($0.date, r.from, r.to) }
        let board = paymentBoard(i, month: String(DateUtil.today().prefix(7)))
        var cards: [String: CardStatementResult] = [:]
        for a in i.accounts where a.type == .credit_card && !a.isArchived {
            cards[a.id] = CardStatements.forCard(a, accounts: i.accounts, transactions: i.transactions,
                                                 plans: i.plans, occurrences: i.occurrences, fx: i.fx, count: 12)
        }
        return Derived(
            month: my,
            day: DateUtil.today(),
            workspaceId: i.workspaceId,
            budgetsSignature: signature(i.budgets),
            monthFlow: Calc.monthlyFlow(i.reportTransactions, my, fx: i.fx),
            series: Calc.monthlySeries(i.reportTransactions, endingAt: my, count: 6, fx: i.fx)
                .map { MonthFlow(month: $0.month, flow: $0.flow) },
            monthToDate: Calc.monthToDateExpense(i.reportTransactions, fx: i.fx),
            expenseByCategory: Calc.expenseByCategory(inMonth, fx: i.fx),
            budgetStates: AppModel.budgetStates(i.budgets, i.reportTransactions, my, categories: i.categories, fx: i.fx),
            cards: cards,
            paymentSummary: board.summary,
            paymentCarryOverdue: board.carry,
            suggestionIndex: Suggestions.Index(i.transactions),
            tags: Tags.aggregate(i.transactions, fx: i.fx))
    }
}
