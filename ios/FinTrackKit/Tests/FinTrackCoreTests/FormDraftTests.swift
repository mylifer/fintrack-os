import Testing
@testable import FinTrackCore

/* Web AccountFormModal ve debts/page handleSave kuralları. */

@Suite("hesap formu")
struct AccountDraftTests {
    @Test func creditCardDebtStoredNegative() {
        var d = AccountDraft()
        d.name = "Bonus"; d.type = .credit_card; d.initialBalanceText = "1.250,50"; d.limitText = "50.000"
        d.statementDay = 5; d.dueDayText = "15"
        #expect(d.validationError() == nil)
        let a = d.build(editing: nil, workspaceId: "w", id: "k", now: "n")
        #expect(a.initialBalance == -1250.5 && a.creditLimit == 50_000 && a.statementDay == 5)
        // 5 + 10 (Garanti kuralı) = 15 → fark kalıcı yazılır
        #expect(a.dueGapDays == 10)
        let plan = d.cardPlan(for: a, existing: nil, workspaceId: "w", now: "n")
        #expect(plan?.dayOfMonth == 15 && plan?.targetKind == "card" && plan?.id == PaymentSchedule.planIdFor(.card, "k"))
        // Elle başka gün → dueGapDays boş
        d.dueDayText = "20"
        #expect(d.build(editing: nil, workspaceId: "w", id: "k", now: "n").dueGapDays == nil)
    }

    @Test func limitRequired() {
        var d = AccountDraft()
        d.name = "Kart"; d.type = .credit_card
        #expect(d.validationError() == "Limit girin.")
    }

    @Test func depositTerms() {
        var d = AccountDraft()
        d.name = "Vadeli"; d.type = .savings; d.depositRateText = "45"
        #expect(d.validationError() != nil)
        d.depositStart = "2026-01-01"; d.depositEnd = "2026-02-01"
        let a = d.build(editing: nil, workspaceId: "w", id: "v", now: "n")
        #expect(a.raw.num("depositRate") == 45 && a.raw.num("depositTaxPct") == 17.5)
        #expect(Deposit.terms(a) != nil)
        // Koşul silinince sütunlar boşaltılır
        var e = AccountDraft(editing: a, cardPlan: nil)
        e.depositRateText = ""; e.depositStart = ""; e.depositEnd = ""
        let b = e.build(editing: a, workspaceId: "w", now: "n")
        #expect(b.raw["depositRate"] == .null && b.raw["depositEnd"] == .null)
    }

    @Test func keepsUnknownColumns() {
        let a = Account(raw: ["id": "x", "name": "Eski", "type": "checking", "currency": "TRY", "initialBalance": 10,
                              "logoUrl": "https://…", "isArchived": true])
        var d = AccountDraft(editing: a, cardPlan: nil)
        d.name = "Yeni"
        let b = d.build(editing: a, workspaceId: nil, now: "n")
        #expect(b.raw.str("logoUrl") == "https://…" && b.name == "Yeni" && !b.isArchived && b.initialBalance == 10)
    }
}

@Suite("borç formu")
struct DebtDraftTests {
    let acc = Account(raw: ["id": "a", "name": "Vadesiz", "type": "checking", "currency": "TRY", "initialBalance": 0])

    @Test func settledOnlyWhenPaid() {
        var d = DebtDraft()
        d.name = "Kredi"; d.totalText = "10.000"; d.paidText = "10.000"
        #expect(d.build(editing: nil, workspaceId: "w", id: "d", now: "n").isSettled)
        d.paidText = "9.999"
        #expect(!d.build(editing: nil, workspaceId: "w", id: "d", now: "n").isSettled)
    }

    @Test func principalRow() {
        var d = DebtDraft()
        d.name = "Kredi"; d.totalText = "10.000"; d.depositAccountId = "a"; d.borrowDate = "2026-01-10"
        let debt = d.build(editing: nil, workspaceId: "w", id: "d", now: "n")
        #expect(debt.accountId == "a")
        let tx = DebtDraft.principalTx(for: debt, account: acc, borrowDate: d.borrowDate, fx: fx, now: "n", id: "p", today: "2026-02-01")
        #expect(tx.type == .income && tx.icon == "🏦" && tx.description == "Kredi — borç girişi")
        #expect(tx.raw.str("debtPrincipalId") == "d" && tx.debtId == nil)
        #expect(Calc.isDebtPrincipal(tx) && !Calc.isFlow(tx, asOf: "2026-12-31"))
        #expect(DebtDraft.findPrincipal(debt, in: [tx])?.id == "p")
        // Verilen borç: gider, 🤝
        var o = d
        o.direction = "owed"
        let lent = o.build(editing: nil, workspaceId: "w", id: "o", now: "n")
        let out = DebtDraft.principalTx(for: lent, account: acc, borrowDate: "2026-01-10", fx: fx, now: "n", today: "2026-02-01")
        #expect(out.type == .expense && out.description == "Kredi — verilen borç")
    }

    @Test func principalDateMoves() {
        let debt = Debt(raw: ["id": "d", "name": "Kredi", "direction": "owe", "totalAmount": 1000])
        let tx = DebtDraft.principalTx(for: debt, account: acc, borrowDate: "2026-03-10", fx: fx, now: "n", id: "p", today: "2026-01-01")
        #expect(tx.approvalStatus == .pending)
        let moved = DebtDraft.movedPrincipal(before: debt, borrowDate: "2026-01-01", txs: [tx], now: "n2", today: "2026-01-01")
        #expect(moved?.date == "2026-01-01" && moved?.approvalStatus == .approved)
        #expect(DebtDraft.movedPrincipal(before: debt, borrowDate: "2026-03-10", txs: [tx], now: "n") == nil)
    }

    @Test func linkedTransactionsIncludePaymentsAndPrincipal() throws {
        let debt = Debt(raw: ["id": "d", "name": "Kredi", "direction": "owe", "totalAmount": 1000])
        let p = DebtDraft.principalTx(for: debt, account: acc, borrowDate: "2026-01-01", fx: fx, now: "n", id: "p")
        let pay = try DebtPayments.pay(debt, from: acc, amount: 100, date: "2026-02-01", fx: fx, workspaceId: nil, now: "n", id: "q")
        #expect(Set(DebtDraft.linkedTransactions(debt, in: [p, pay.transaction, tx(["id": "z"])]).map(\.id)) == ["p", "q"])
    }
}

@Suite("yatırım alım / satımı")
struct InvestmentTradeTests {
    let acc = Account(raw: ["id": "a", "name": "Vadesiz", "type": "checking", "currency": "TRY", "initialBalance": 0])
    let usd = Account(raw: ["id": "u", "name": "Dolar", "type": "checking", "currency": "USD", "initialBalance": 0])
    let ids = ["inv", "led", "pnl", "tax"]

    func inv(_ id: String, _ type: String, _ q: Double, _ p: Double, _ d: String, asset: String = "GOLD_GRAM") -> InvestmentTransaction {
        InvestmentTransaction(raw: ["id": .string(id), "type": .string(type), "asset": .string(asset), "quantity": .number(q),
                                    "pricePerUnit": .number(p), "date": .string(d), "createdAt": .string(d + "T10:00:00.000Z")])
    }

    @Test func buyWritesLinkedExpense() throws {
        let out = try InvestmentTrade.make(.init(type: "buy", asset: "GOLD_GRAM", quantity: 10, pricePerUnit: 3000,
                                                 date: "2026-01-10", accountId: "a", note: nil),
                                           editing: nil, account: acc, investments: [], fundTax: .init(), categories: [],
                                           fx: fx, workspaceId: "w", now: "n", ids: ids, today: "2026-02-01")
        #expect(out.ledger.count == 1)
        let l = out.ledger[0]
        #expect(l.type == .expense && l.amount == 30_000 && l.icon == "Au" && l.description == "10 Gr Altın Alımı")
        #expect(Calc.isInvestmentPrincipal(l) && !Calc.isFlow(l, asOf: "2026-12-31"))
        #expect(out.investment.linkedTransactionId == "led" && out.investment.sourceAccountId == "a")
    }

    @Test func sellAtProfitWithFundTax() throws {
        let history = [inv("b1", "buy", 100, 10, "2026-01-01", asset: "TEFAS:AFA")]
        let out = try InvestmentTrade.make(.init(type: "sell", asset: "TEFAS:AFA", quantity: 50, pricePerUnit: 14,
                                                 date: "2026-02-01", accountId: "a", note: "kısmi"),
                                           editing: nil, account: acc, investments: history,
                                           fundTax: .init(enabled: true, defaultRate: 10), categories: [],
                                           fx: fx, workspaceId: "w", now: "2026-02-01T12:00:00.000Z", ids: ids, today: "2026-02-01")
        #expect(out.ledger.map(\.description) == ["50 AFA Satışı", "AFA Satış Kârı", "AFA Satış Stopajı"])
        #expect(out.ledger.map(\.amount) == [500, 200, 20])
        #expect(out.ledger[1].type == .income && out.ledger[2].type == .expense)
        #expect(out.investment.pnlLinkedTransactionId == "pnl" && out.investment.taxLinkedTransactionId == "tax")
    }

    @Test func sellAtLossNoTax() throws {
        let history = [inv("b1", "buy", 10, 100, "2026-01-01")]
        let out = try InvestmentTrade.make(.init(type: "sell", asset: "GOLD_GRAM", quantity: 10, pricePerUnit: 90,
                                                 date: "2026-02-01", accountId: "a", note: nil),
                                           editing: nil, account: acc, investments: history,
                                           fundTax: .init(enabled: true, defaultRate: 10), categories: [],
                                           fx: fx, workspaceId: "w", now: "2026-02-01T12:00:00.000Z", ids: ids, today: "2026-02-01")
        #expect(out.ledger.map(\.description) == ["10 Gr Altın Satışı", "Gr Altın Satış Zararı"])
        #expect(out.ledger[1].type == .expense && out.ledger[1].amount == 100)
    }

    @Test func cannotSellMoreThanHeld() {
        #expect(throws: InvestmentTrade.TradeError.sellExceeds(5)) {
            try InvestmentTrade.make(.init(type: "sell", asset: "GOLD_GRAM", quantity: 6, pricePerUnit: 1, date: "2026-02-01",
                                           accountId: nil, note: nil), editing: nil, account: nil,
                                     investments: [inv("b", "buy", 5, 1, "2026-01-01")], fundTax: .init(), categories: [],
                                     fx: fx, workspaceId: nil, now: "n", ids: ids)
        }
    }

    @Test func foreignAccountConverted() throws {
        let out = try InvestmentTrade.make(.init(type: "buy", asset: "GOLD_GRAM", quantity: 1, pricePerUnit: 3450,
                                                 date: "2026-01-10", accountId: "u", note: nil),
                                           editing: nil, account: usd, investments: [], fundTax: .init(), categories: [],
                                           fx: fx, workspaceId: "w", now: "n", ids: ids, today: "2026-02-01")
        #expect(out.ledger[0].currency == .USD && out.ledger[0].amount == 100)
        #expect(throws: InvestmentTrade.TradeError.noRate("USD")) {
            try InvestmentTrade.make(.init(type: "buy", asset: "GOLD_GRAM", quantity: 1, pricePerUnit: 3450,
                                           date: "2026-01-10", accountId: "u", note: nil),
                                     editing: nil, account: usd, investments: [], fundTax: .init(), categories: [],
                                     fx: FX(), workspaceId: "w", now: "n", ids: ids)
        }
    }

    @Test func avgCostAtIgnoresLaterBuys() {
        let txs = [inv("b1", "buy", 10, 100, "2026-01-01"), inv("b2", "buy", 10, 300, "2026-03-01")]
        #expect(InvestmentTrade.avgCostAt(txs, asset: "GOLD_GRAM", date: "2026-02-01", createdAt: "z") == 100)
        #expect(InvestmentTrade.avgCostAt(txs, asset: "GOLD_GRAM", date: "2026-04-01", createdAt: "z") == 200)
    }

    @Test func cleanupIds() {
        var raw = inv("s", "sell", 1, 1, "2026-02-01").raw
        raw["targetAccountId"] = "a"; raw["linkedTransactionId"] = "x"; raw["taxLinkedTransactionId"] = "t"
        let pnl = tx(["id": "p", "accountId": "a", "date": "2026-02-01", "description": "Gr Altın Satış Kârı"])
        #expect(InvestmentTrade.linkedLedgerIds(InvestmentTransaction(raw: raw), in: [pnl]) == ["x", "p", "t"])
    }

    @Test func quantityText() {
        #expect(Fmt.quantity(1000) == "1.000")
        #expect(Fmt.quantity(2.5) == "2,5")
        #expect(Fmt.quantity(0.12345) == "0,1235")
    }
}
