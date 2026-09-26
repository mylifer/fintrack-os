import Testing
@testable import FinTrackCore

/* Web src/lib/utils/calculations.test.ts ve money.test.ts ile AYNI girdiler ve
   beklenen sonuçlar. Biri değişirse diğeri de değişmeli. */

let fx = FX(rates: FXRates(usdTry: 34.5, eurTry: 37, gbpTry: 43))

func tx(_ o: JSONObject = [:]) -> Transaction {
    var raw: JSONObject = [
        "id": "x", "type": "expense", "amount": 0, "currency": "TRY", "date": "2026-01-15",
        "accountId": "a", "description": "", "isInstallment": false, "createdAt": "", "updatedAt": "",
    ]
    for (k, v) in o { raw[k] = v }
    return Transaction(raw: raw)
}

func budget(_ o: JSONObject = [:]) -> Budget {
    var raw: JSONObject = ["id": "b", "categoryId": "c", "amount": 1000, "period": "monthly",
                           "rollover": true, "alertThreshold": 80]
    for (k, v) in o { raw[k] = v }
    return Budget(raw: raw)
}

func cat(_ id: String, parent: String? = nil) -> Category {
    Category(raw: ["id": .string(id), "parentId": JSONValue(parent)])
}

@Suite("money — tam sayı kuruş (S8)")
struct MoneyTests {
    @Test func noFloatDrift() {
        #expect(Money.sum([0.1, 0.2, 0.3]) == 0.6)
        #expect(Money.sum(Array(repeating: 0.01, count: 10_000)) == 100)
    }
    @Test func netsNegatives() {
        #expect(Money.sum([500, -120]) == 380)
        #expect(Money.sum([100, -100]) == 0)
    }
    @Test func addSubMul() {
        #expect(Money.add(0.1, 0.2) == 0.3)
        #expect(Money.sub(5000, 4999.99) == 0.01)
        #expect(Money.mul(100, 34.5) == 3450)
        #expect(Money.mul(12.34, 2) == 24.68)
    }
    @Test func minorMajorRound() {
        #expect(Money.toMinor(12.34) == 1234)
        #expect(Money.toMajor(1234) == 12.34)
        #expect(Money.round(1.005) == 1.01)
        #expect(Money.round(19.990000000000002) == 19.99)
    }
    @Test func split() {
        #expect(Money.split(1000, 2) == [500, 500])
        #expect(Money.split(1000, 3) == [333.34, 333.33, 333.33])
        #expect(Money.split(0.05, 3) == [0.02, 0.02, 0.01])
        #expect(Money.sum(Money.split(4999.99, 12)) == 4999.99)
    }
}

@Suite("isPosted / excludeFuture")
struct PostedTests {
    @Test func dateRule() {
        #expect(!Calc.isPosted(tx(["date": "2026-01-16"]), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(["date": "2026-01-15"]), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(["date": "2026-01-14"]), asOf: "2026-01-15"))
    }
    @Test func fullIsoTolerance() {
        #expect(!Calc.isPosted(tx(["date": "2026-02-01T09:30:00.000Z"]), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(["date": "2026-01-15T23:59:00.000Z"]), asOf: "2026-01-15"))
    }
    @Test func approvalGate() {
        #expect(!Calc.isPosted(tx(["date": "2026-01-10", "approvalStatus": "pending"]), asOf: "2026-01-15"))
        #expect(!Calc.isPosted(tx(["date": "2026-01-15", "approvalStatus": "pending"]), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(["date": "2026-01-10", "approvalStatus": "approved"]), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(["date": "2026-01-10", "approvalStatus": nil]), asOf: "2026-01-15"))
        #expect(!Calc.isPosted(tx(["date": "2026-01-16", "approvalStatus": "approved"]), asOf: "2026-01-15"))
    }
    @Test func installmentsSkipGate() {
        let inst: JSONObject = ["approvalStatus": "pending", "isInstallment": true, "installGroupId": "G"]
        #expect(!Calc.awaitsApproval(tx(inst)))
        #expect(Calc.awaitsApproval(tx(["approvalStatus": "pending"])))
        #expect(Calc.isPosted(tx(inst.merging(["date": "2026-01-10"]) { $1 }), asOf: "2026-01-15"))
        #expect(!Calc.isPosted(tx(inst.merging(["date": "2026-01-16"]) { $1 }), asOf: "2026-01-15"))
        #expect(Calc.isPosted(tx(inst.merging(["isInstallment": false, "date": "2026-01-10"]) { $1 }), asOf: "2026-01-15"))
    }
    @Test func excludeFutureDropsPending() {
        let txs = [
            tx(["id": "legacy-past", "date": "2026-01-01"]),
            tx(["id": "pending-past", "date": "2026-01-02", "approvalStatus": "pending"]),
            tx(["id": "approved", "date": "2026-01-03", "approvalStatus": "approved"]),
        ]
        #expect(Calc.excludeFuture(txs, asOf: "2026-01-15").map(\.id) == ["legacy-past", "approved"])
    }
    @Test func balanceIgnoresFuture() {
        let txs = [
            tx(["type": "income", "amount": 1000, "accountId": "a", "date": "2026-01-10"]),
            tx(["type": "expense", "amount": 400, "accountId": "a", "date": "2026-02-20"]),
        ]
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY,
                                       Calc.excludeFuture(txs, asOf: "2026-01-15"), fx: fx) == 1000)
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY,
                                       Calc.excludeFuture(txs, asOf: "2026-02-20"), fx: fx) == 600)
    }
}

@Suite("transactionEffect (S2 bakiyeler)")
struct EffectTests {
    @Test func incomeExpense() {
        let txs = [tx(["type": "income", "amount": 1000]), tx(["type": "expense", "amount": 250])]
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY, txs, fx: fx) == 750)
    }
    @Test func sameCurrencyTransfer() {
        let txs = [tx(["type": "transfer", "amount": 500, "accountId": "a", "toAccountId": "b"])]
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY, txs, fx: fx) == -500)
        #expect(Calc.transactionEffect(accountId: "b", currency: .TRY, txs, fx: fx) == 500)
    }
    @Test func crossCurrencyTransfer() {
        let txs = [tx(["type": "transfer", "amount": 100, "currency": "USD", "accountId": "usd",
                       "toAccountId": "try", "amountTry": 3450])]
        #expect(Calc.transactionEffect(accountId: "usd", currency: .USD, txs, fx: fx) == -100)
        #expect(Calc.transactionEffect(accountId: "try", currency: .TRY, txs, fx: fx) == 3450)
    }
    @Test func touchesAccount() {
        let t = tx(["type": "transfer", "accountId": "A", "toAccountId": "B"])
        #expect(Calc.touchesAccount(t, "A"))
        #expect(Calc.touchesAccount(t, "B"))
        #expect(!Calc.touchesAccount(t, "C"))
    }
}

@Suite("calcPeriodFlow (S2/S3)")
struct FlowTests {
    @Test func sumsAmountTryNetsRefundsExcludesGhosts() {
        let txs = [
            tx(["type": "income", "amount": 1000, "amountTry": 1000]),
            tx(["type": "expense", "amount": 300, "amountTry": 300]),
            tx(["type": "expense", "amount": -100, "amountTry": -100]),
            tx(["type": "income", "amount": 50, "currency": "USD", "amountTry": 1725]),
            tx(["type": "expense", "amount": 9999, "amountTry": 9999, "systemKind": "reconciliation"]),
        ]
        let r = Calc.periodFlow(txs, from: "2026-01-01", to: "2026-01-31", fx: fx, asOf: "2026-01-31")
        #expect(r.income == 2725)
        #expect(r.expense == 200)
        #expect(r.net == 2525)
    }
    @Test func principalMovesExcluded() {
        let txs = [
            tx(["type": "income", "amount": 5000, "amountTry": 5000, "icon": "cash", "description": "Kredi borç girişi"]),
            tx(["type": "expense", "amount": 800, "amountTry": 800, "icon": "x", "description": "AFA Alımı"]),
            tx(["type": "income", "amount": 120, "amountTry": 120, "icon": "x", "description": "AFA Satış Kârı"]),
        ]
        let r = Calc.periodFlow(txs, from: "2026-01-01", to: "2026-01-31", fx: fx, asOf: "2026-01-31")
        #expect(r.income == 120)
        #expect(r.expense == 0)
    }
    @Test func legacyReconcileTag() {
        #expect(Calc.isReconciliation(tx(["tags": .array(["#bakiyeeşitleme"])])))
    }
}

@Suite("bütçe")
struct BudgetTests {
    let feb = MonthYear(month: 2, year: 2026)

    @Test func rolloverAddsUnspent() {
        let b = Calc.enrichBudget(budget(), [
            tx(["amount": 700, "amountTry": 700, "categoryId": "c", "date": "2026-01-10"]),
            tx(["amount": 900, "amountTry": 900, "categoryId": "c", "date": "2026-02-10"]),
        ], feb, categories: [], fx: fx, asOf: "2026-02-28")
        #expect(b.carryover == 300)
        #expect(b.limit == 1300)
        #expect(b.remaining == 400)
        #expect(abs(b.percentUsed - 69.23) < 0.05)
        #expect(b.status == .ok)
    }
    @Test func rolloverOff() {
        let b = Calc.enrichBudget(budget(["rollover": false]), [
            tx(["amount": 100, "amountTry": 100, "categoryId": "c", "date": "2026-01-10"]),
        ], feb, categories: [], fx: fx, asOf: "2026-02-28")
        #expect(b.carryover == 0)
        #expect(b.limit == 1000)
    }
    @Test func overspendDoesNotCarry() {
        let b = Calc.enrichBudget(budget(), [
            tx(["amount": 1500, "amountTry": 1500, "categoryId": "c", "date": "2026-01-10"]),
        ], feb, categories: [], fx: fx, asOf: "2026-02-28")
        #expect(b.carryover == 0)
    }
    @Test func emptyMonthBeforeTracking() {
        let b = Calc.enrichBudget(budget(), [
            tx(["amount": 200, "amountTry": 200, "categoryId": "c", "date": "2026-02-03"]),
        ], feb, categories: [], fx: fx, asOf: "2026-02-28")
        #expect(b.carryover == 0)
    }
    @Test func januaryLooksAtDecember() {
        let txs = [tx(["amount": 1, "amountTry": 1, "categoryId": "other", "date": "2025-11-01"])]
        let b = Calc.enrichBudget(budget(), txs, MonthYear(month: 1, year: 2026), categories: [], fx: fx, asOf: "2026-01-31")
        #expect(b.carryover == 1000)
    }
    @Test func spentRemainingStatus() {
        let b = Calc.enrichBudget(budget(["rollover": false]),
                                  [tx(["amount": 600, "amountTry": 600, "categoryId": "c"])],
                                  MonthYear(month: 1, year: 2026), categories: [], fx: fx, asOf: "2026-01-31")
        #expect(b.spent == 600)
        #expect(b.remaining == 400)
        #expect(b.status == .ok)
    }
    @Test func parentIncludesSubcategories() {
        let cats = [cat("shopping"), cat("clothing", parent: "shopping"), cat("shoes", parent: "clothing"), cat("unrelated")]
        #expect(Calc.expandCategoryIds(["shopping"], cats) == ["shopping", "clothing", "shoes"])
        let b = Calc.enrichBudget(budget(["categoryId": "shopping", "rollover": false]), [
            tx(["amount": 100, "amountTry": 100, "categoryId": "shopping"]),
            tx(["amount": 200, "amountTry": 200, "categoryId": "clothing"]),
            tx(["amount": 50, "amountTry": 50, "categoryId": "shoes"]),
            tx(["amount": 999, "amountTry": 999, "categoryId": "unrelated"]),
        ], MonthYear(month: 1, year: 2026), categories: cats, fx: fx, asOf: "2026-01-31")
        #expect(b.spent == 350)
    }
    @Test func approvalGate() {
        let b = budget(["categoryId": "market", "amount": 2000, "month": 1, "year": 2026, "rollover": false])
        let jan = MonthYear(month: 1, year: 2026)
        func inMonth(_ o: JSONObject) -> Transaction {
            tx(["categoryId": "market", "date": "2026-01-20"].merging(o) { $1 })
        }
        #expect(Calc.budgetSpent(b, [inMonth(["amount": 1000, "amountTry": 1000, "approvalStatus": "pending"])],
                                 jan, categories: [], fx: fx, asOf: "2026-01-31") == 0)
        #expect(Calc.budgetSpent(b, [
            inMonth(["amount": 300, "amountTry": 300, "approvalStatus": "approved"]),
            inMonth(["amount": 200, "amountTry": 200]),
            inMonth(["amount": -50, "amountTry": -50]),
        ], jan, categories: [], fx: fx, asOf: "2026-01-31") == 450)
    }
    @Test func categorySplits() {
        let split = tx(["date": "2026-01-20", "amount": 1000, "amountTry": 1000, "categoryId": "market",
                        "categorySplits": .array([
                            .object(["categoryId": "market", "amount": 700]),
                            .object(["categoryId": "temizlik", "amount": 300]),
                        ])])
        let jan = MonthYear(month: 1, year: 2026)
        let m = Calc.budgetSpent(budget(["categoryId": "market"]), [split], jan, categories: [], fx: fx, asOf: "2026-01-31")
        let t = Calc.budgetSpent(budget(["categoryId": "temizlik"]), [split], jan, categories: [], fx: fx, asOf: "2026-01-31")
        #expect(m == 700)
        #expect(t == 300)
    }
    @Test func multiCategoryJSON() {
        #expect(Calc.budgetCategoryIds(budget(["categoryId": #"["a","b"]"#])) == ["a", "b"])
        #expect(Calc.budgetCategoryIds(budget(["categoryId": "a"])) == ["a"])
    }
}

@Suite("kart limiti — taksitli alım")
struct CreditTests {
    @Test func installmentsBlockWholeAmount() {
        let card = Account(raw: ["id": "cc", "type": "credit_card", "currency": "TRY", "creditLimit": 60000, "initialBalance": 0])
        let asOf = "2026-01-15"
        let days = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15", "2026-05-15", "2026-06-15"]
        let group = days.enumerated().map { i, d in
            tx(["id": .string("i\(i)"), "accountId": "cc", "amount": 2000, "amountTry": 2000, "date": .string(d),
                "isInstallment": true, "installGroupId": "G", "approvalStatus": i > 0 ? "pending" : nil])
        }
        let bal = Calc.transactionEffect(accountId: "cc", currency: .TRY, Calc.excludeFuture(group, asOf: asOf), fx: fx)
        #expect(Calc.availableCredit(card, balance: bal, group, asOf: asOf) == 48000)
    }
}

@Suite("yazma satırı")
struct WriteRowTests {
    @Test func unknownColumnsSurviveAndClearedFieldsAreNull() {
        var t = tx(["receipt": .object(["path": "u/x.jpg"]), "notes": "eski", "futureColumn": 7])
        t.notes = nil
        let row = t.rowForWrite(updatedAt: "2026-09-27T10:00:00.000Z")
        #expect(row["receipt"] == .object(["path": "u/x.jpg"]))
        #expect(row["futureColumn"] == 7)
        #expect(row["notes"] == .null)
        #expect(row["updatedAt"] == "2026-09-27T10:00:00.000Z")
        #expect(row["deleted_at"] == .null)
        #expect(row["user_id"] == nil)
    }
    @Test func newFutureTransactionIsPending() {
        var d = TransactionDraft()
        d.amountText = "1.234,50"
        d.accountId = "a"
        d.date = DateUtil.parseDay("2099-01-01")!
        let acc = Account(raw: ["id": "a", "currency": "TRY"])
        let t = d.makeNew(id: "n", account: acc, workspaceId: "w", fx: FX(), now: "2026-09-27T10:00:00.000Z", today: "2026-09-27")
        #expect(t.amount == 1234.5)
        #expect(t.amountTry == 1234.5)
        #expect(t.approvalStatus == .pending)
        #expect(t.workspaceId == "w")
    }
    @Test func foreignWithoutRateLeavesAmountTryEmpty() {
        var d = TransactionDraft()
        d.amountText = "100"
        d.accountId = "u"
        let acc = Account(raw: ["id": "u", "currency": "USD"])
        let t = d.makeNew(account: acc, workspaceId: nil, fx: FX(), now: "n")
        #expect(t.amountTry == nil)
        #expect(t.raw["amountTry"] == nil)
    }
    @Test func parseAmount() {
        #expect(Fmt.parseAmount("1.234,56") == 1234.56)
        #expect(Fmt.parseAmount("1.234") == 1234)
        #expect(Fmt.parseAmount("1234.56") == 1234.56)
        #expect(Fmt.parseAmount("-12,5") == -12.5)
    }
}
