import Testing
@testable import FinTrackCore

/* Web calculations.test.ts — "çalışma alanları arası transfer akıştan hariç" ve
   "alacak tahsilatı akıştan hariç" ile AYNI girdiler. */

@Suite("çalışma alanları arası transfer akıştan hariç")
struct WorkspaceTransferFlowTests {
    let legs = [
        tx(["type": "income", "amount": 1500, "amountTry": 1500, "icon": "⇄", "description": "Ev Kredisi ödemesi", "workspaceTransferId": "w1"]),
        tx(["type": "expense", "amount": 1500, "amountTry": 1500, "icon": "⇄", "description": "Ev Kredisi ödemesi", "workspaceTransferId": "w1"]),
    ]

    @Test func legsAreNotFlow() {
        for t in legs {
            #expect(Calc.isPrincipalMove(t))
            #expect(!Calc.isFlow(t, asOf: "2026-12-31"))
        }
    }

    @Test func periodFlowSkipsLegs() {
        let r = Calc.periodFlow(legs + [
            tx(["type": "income", "amount": 1000, "amountTry": 1000, "description": "Maaş"]),
            tx(["type": "expense", "amount": 300, "amountTry": 300, "description": "Market"]),
        ], from: "2026-01-01", to: "2026-01-31", fx: fx, asOf: "2026-12-31")
        #expect(r == Calc.Flow(income: 1000, expense: 300, net: 700))
    }

    @Test func balanceStillMoves() {
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY, [legs[0]], fx: fx) == 1500)
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY, [legs[1]], fx: fx) == -1500)
    }
}

@Suite("alacak tahsilatı akıştan hariç")
struct DebtCollectionFlowTests {
    let collection = tx(["type": "income", "amount": 5000, "amountTry": 5000, "icon": "🤝",
                         "description": "Ahmet geri ödeme", "debtId": "d1"])

    @Test func onlyIncomeWithDebtId() {
        #expect(Calc.isDebtCollection(collection))
        #expect(!Calc.isDebtCollection(tx(["type": "transfer", "debtId": "d1"])))
        #expect(!Calc.isDebtCollection(tx(["type": "income"])))
    }

    @Test func notFlowEvenWithoutIcon() {
        #expect(Calc.isPrincipalMove(collection))
        #expect(!Calc.isFlow(collection, asOf: "2026-12-31"))
        var raw = collection.raw
        raw["icon"] = nil
        #expect(!Calc.isFlow(Transaction(raw: raw), asOf: "2026-12-31"))
    }

    @Test func periodFlowSkipsCollection() {
        let r = Calc.periodFlow([collection, tx(["type": "income", "amount": 1000, "amountTry": 1000, "description": "Maaş"])],
                                from: "2026-01-01", to: "2026-01-31", fx: fx, asOf: "2026-12-31")
        #expect(r == Calc.Flow(income: 1000, expense: 0, net: 1000))
    }

    @Test func notInCategoryBreakdown() {
        var raw = collection.raw
        raw["icon"] = nil
        let m = Calc.amountByCategory([Transaction(raw: raw), tx(["type": "income", "amount": 1000, "amountTry": 1000, "categoryId": "c1"])],
                                      type: .income, fx: fx)
        #expect(m == ["c1": 1000])
    }

    @Test func balanceStillRises() {
        #expect(Calc.transactionEffect(accountId: "a", currency: .TRY, [collection], fx: fx) == 5000)
    }
}
