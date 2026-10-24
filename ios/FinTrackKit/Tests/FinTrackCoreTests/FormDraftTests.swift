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

@Suite("iade")
struct RefundTests {
    let original = tx(["id": "o", "type": "expense", "amount": 1000, "amountTry": 1000, "categoryId": "c",
                       "description": "Kulaklık", "tags": .array(["#Tatil"])])

    @Test func fullRefundNetsOriginal() throws {
        let r = try Refund.make(original, amount: nil, date: "2026-01-20", all: [original], fx: fx, now: "n", id: "r", today: "2026-02-01")
        #expect(r.amount == -1000 && r.type == .expense && r.refundOfId == "o" && r.categoryId == "c")
        #expect(r.description == "[İade] Kulaklık" && r.tags == ["#Tatil", "#İade"])
        let flow = Calc.periodFlow([original, r], from: "2026-01-01", to: "2026-01-31", fx: fx, asOf: "2026-02-01")
        #expect(flow.expense == 0 && flow.income == 0)
        #expect(r.isPlainRefund && r.canDeleteOnIOS)
    }

    @Test func cumulativeGuard() throws {
        let p = try Refund.make(original, amount: 400, date: "2026-01-20", all: [original], fx: fx, now: "n", id: "p1")
        #expect(Refund.remaining(original, in: [original, p]) == 600)
        #expect(throws: Refund.RefundError.exceeds(600)) {
            try Refund.make(original, amount: 700, date: "2026-01-21", all: [original, p], fx: fx, now: "n")
        }
        let rest = try Refund.make(original, amount: nil, date: "2026-01-21", all: [original, p], fx: fx, now: "n", id: "p2")
        #expect(rest.amount == -600)
        #expect(throws: Refund.RefundError.alreadyRefunded) {
            try Refund.make(original, amount: nil, date: "2026-01-22", all: [original, p, rest], fx: fx, now: "n")
        }
    }

    @Test func splitsRescaled() {
        let s = Refund.rescaleSplits([.init(categoryId: "a", amount: 300), .init(categoryId: "b", amount: 700)], to: -500)
        #expect(s.map(\.amount) == [-150, -350])
    }
}

@Suite("net varlık trendi")
struct NetWorthHistoryTests {
    @Test func walksBackFromToday() {
        let acc = Account(raw: ["id": "a", "type": "checking", "currency": "TRY", "initialBalance": 0])
        let txs = [tx(["id": "1", "type": "income", "amount": 1000, "amountTry": 1000, "date": "2026-08-15"]),
                   tx(["id": "2", "type": "expense", "amount": 300, "amountTry": 300, "date": "2026-09-10"])]
        let bal = Calc.balance(of: acc, posted: txs, fx: fx)
        let s = NetWorthHistory.monthly(accounts: [acc], balances: ["a": bal], transactions: txs, investments: [],
                                        prices: PriceBook(), debts: [], fx: fx, months: 3, today: "2026-09-20")
        #expect(s.map(\.date) == ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-20"])
        #expect(s.map(\.value) == [0, 0, 1000, 700])
    }

    @Test func debtBurdenAddsBackLaterPayments() {
        let d = Debt(raw: ["id": "d", "direction": "owe", "totalAmount": 1000, "paidAmount": 400, "startDate": "2026-01-01"])
        let pay = tx(["id": "p", "type": "transfer", "amount": 400, "amountTry": 400, "debtId": "d", "date": "2026-03-01"])
        #expect(NetWorthHistory.debtBurdenSeries([d], [pay], dates: ["2025-12-31", "2026-02-01", "2026-04-01"], fx: fx) == [0, 1000, 600])
    }
}
