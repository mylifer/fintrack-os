import Testing
@testable import FinTrackCore

/* Web cross-workspace-debt.test.ts ve debts/page tahsilat kuralı ile aynı girdiler. */

private func account(_ id: String, _ ws: String, _ cur: String = "TRY") -> Account {
    Account(raw: ["id": .string(id), "name": .string(id), "type": "checking", "currency": .string(cur),
                  "initialBalance": 0, "workspaceId": .string(ws)])
}

private func debt(_ o: JSONObject = [:]) -> Debt {
    var raw: JSONObject = ["id": "borc", "name": "Kredi", "type": "bank_loan", "direction": "owe",
                           "totalAmount": 10_000, "paidAmount": 2_000, "paidInstallments": 2,
                           "startDate": "2026-01-01", "isSettled": false, "workspaceId": "ws-b"]
    for (k, v) in o { raw[k] = v }
    return Debt(raw: raw)
}

@Suite("alanlar arası transfer — borç ödemesi")
struct WorkspaceTransferTests {
    let ids = ["o", "i", "p", "link"]
    func input(_ amount: Double = 1_500, debt d: Debt? = debt()) -> WorkspaceTransfer.Input {
        .init(source: account("kaynak", "ws-a"), sourceWorkspaceId: "ws-a", target: account("ara", "ws-b"),
              targetWorkspaceId: "ws-b", amount: amount, date: "2026-03-01", description: "Kredi ödemesi", targetDebt: d)
    }

    @Test func threeRowsAndDebt() throws {
        let r = try WorkspaceTransfer.make(input(), fx: fx, now: "n", ids: ids)
        #expect(r.rows.count == 3)
        let out = r.rows[0], inc = r.rows[1], pay = r.rows[2]
        #expect(out.type == .expense && out.accountId == "kaynak" && out.workspaceId == "ws-a" && out.amount == 1_500)
        #expect(inc.type == .income && inc.accountId == "ara" && inc.workspaceId == "ws-b" && inc.amount == 1_500)
        #expect(pay.type == .transfer && pay.accountId == "ara" && pay.workspaceId == "ws-b" && pay.debtId == "borc")
        #expect(pay.icon == nil && pay.toAccountId == nil)
        #expect(Set(r.rows.compactMap(\.workspaceTransferId)) == ["link"])
        #expect(r.debt?.paidAmount == 3_500 && r.debt?.paidInstallments == 3 && r.debt?.isSettled == false)
        // Hiçbiri akışa girmez; hedef hesabın bakiyesi net değişmez
        #expect(r.rows.allSatisfy { !Calc.isFlow($0, asOf: "2026-12-31") })
        #expect(Calc.transactionEffect(accountId: "ara", currency: .TRY, r.rows, fx: fx) == 0)
        #expect(Calc.transactionEffect(accountId: "kaynak", currency: .TRY, r.rows, fx: fx) == -1_500)
    }

    @Test func settlingPayment() throws {
        let r = try WorkspaceTransfer.make(input(8_000), fx: fx, now: "n", ids: ids)
        #expect(r.debt?.paidAmount == 10_000 && r.debt?.isSettled == true)
    }

    @Test func plainTwoLegs() throws {
        let r = try WorkspaceTransfer.make(input(debt: nil), fx: fx, now: "n", ids: ids)
        #expect(r.rows.count == 2 && r.debt == nil)
    }

    @Test func rejectsReceivable() {
        #expect(throws: WorkspaceTransfer.TransferError.debt) {
            try WorkspaceTransfer.make(input(debt: debt(["direction": "owed"])), fx: fx, now: "n", ids: ids)
        }
    }

    @Test func crossCurrencyFreezesTarget() throws {
        var i = input(debt: nil)
        i.target = account("usd", "ws-b", "USD")
        let r = try WorkspaceTransfer.make(i, fx: fx, now: "n", ids: ids)
        #expect(r.rows[1].currency == .USD)
        #expect(r.rows[1].amount == Money.mul(1_500, 1 / 34.5))
        #expect(r.rows[1].amountTry == 1_500)
    }

    @Test func peersAcrossWorkspaces() throws {
        let r = try WorkspaceTransfer.make(input(), fx: fx, now: "n", ids: ids)
        let other = tx(["id": "z"])
        #expect(WorkspaceTransfer.peers(of: [r.rows[1]], in: r.rows + [other]).map(\.id) == ["o", "p"])
        #expect(r.rows.allSatisfy { $0.canDeleteOnIOS })
    }
}

@Suite("alacak tahsilatı ve borç düzenleme")
struct DebtCollectTests {
    let receivable = debt(["direction": "owed", "totalAmount": 5_000, "paidAmount": 1_000, "paidInstallments": 1])
    let acc = account("a", "ws-b")

    @Test func collectRow() throws {
        let r = try DebtPayments.collect(receivable, into: acc, amount: 1_500, date: "2026-03-01", fx: fx,
                                         workspaceId: "ws-b", now: "n", id: "c1")
        #expect(r.transaction.type == .income && r.transaction.debtId == "borc" && r.transaction.icon == "🤝")
        #expect(r.transaction.description == "Kredi tahsilatı" && r.transaction.categoryId == nil)
        #expect(Calc.isDebtCollection(r.transaction) && !Calc.isFlow(r.transaction, asOf: "2026-12-31"))
        #expect(r.transaction.isPlainDebtCollection && r.transaction.canDeleteOnIOS && !r.transaction.isPlainDebtPayment)
        #expect(r.debt.paidAmount == 2_500 && r.debt.paidInstallments == 2)
    }

    @Test func overflowRejected() {
        #expect(throws: (any Error).self) {
            try DebtPayments.collect(receivable, into: acc, amount: 4_000.01, date: "2026-03-01", fx: fx,
                                     workspaceId: "ws-b", now: "n")
        }
    }

    @Test func editSameDebtAdjustsOnly() throws {
        let old = try DebtPayments.collect(receivable, into: acc, amount: 1_000, date: "2026-03-01", fx: fx,
                                           workspaceId: "ws-b", now: "n", id: "c1")
        var raw = old.transaction.raw
        raw["amount"] = 1_200; raw["amountTry"] = 1_200
        let out = DebtPayments.reconcileEdit(old: old.transaction, new: Transaction(raw: raw), debts: [old.debt], fx: fx)
        #expect(out.count == 1 && out[0].paidAmount == 2_200 && out[0].paidInstallments == 2)
    }

    @Test func editMovesBetweenDebts() throws {
        let a = debt(["id": "A", "paidAmount": 1_000, "paidInstallments": 1])
        let b = debt(["id": "B", "paidAmount": 0, "paidInstallments": 0])
        let pay = try DebtPayments.pay(a, from: acc, amount: 500, date: "2026-03-01", fx: fx, workspaceId: "w", now: "n")
        var raw = pay.transaction.raw
        raw["debtId"] = "B"
        let out = DebtPayments.reconcileEdit(old: pay.transaction, new: Transaction(raw: raw), debts: [a, b], fx: fx)
        #expect(out.map(\.id) == ["A", "B"])
        #expect(out[0].paidAmount == 500 && out[0].paidInstallments == 0)
        #expect(out[1].paidAmount == 500 && out[1].paidInstallments == 1)
    }

    @Test func editRemovesLink() throws {
        let a = debt(["id": "A", "paidAmount": 1_000, "paidInstallments": 1])
        let pay = try DebtPayments.pay(a, from: acc, amount: 500, date: "2026-03-01", fx: fx, workspaceId: "w", now: "n")
        let out = DebtPayments.reconcileEdit(old: pay.transaction, new: tx(["type": "expense", "amount": 500]), debts: [a], fx: fx)
        #expect(out.count == 1 && out[0].paidAmount == 500)
    }
}

@Suite("işlem formu — borç bağı")
struct DraftDebtLinkTests {
    let acc = Account(raw: ["id": "a", "name": "a", "type": "checking", "currency": "TRY", "initialBalance": 0])

    @Test func newDebtPayment() {
        var d = TransactionDraft()
        d.type = .transfer; d.transferTarget = .debt; d.debtId = "D"; d.accountId = "a"; d.amountText = "500"
        d.toAccountId = "b"; d.categoryId = "c"
        #expect(d.validationError() == nil)
        let t = d.makeNew(id: "t", account: acc, workspaceId: "w", fx: fx, now: "n", today: "2026-01-01")
        #expect(t.type == .transfer && t.debtId == "D" && t.toAccountId == nil && t.categoryId == nil && t.icon == nil)
        #expect(t.isPlainDebtPayment)
        #expect(TransactionDraft(editing: t).isDebtPayment)
    }

    @Test func newCollection() {
        var d = TransactionDraft()
        d.type = .income; d.isCollection = true; d.accountId = "a"; d.amountText = "500"
        #expect(d.validationError() == "Alacak seçin.")
        d.debtId = "R"
        let t = d.makeNew(id: "t", account: acc, workspaceId: "w", fx: fx, now: "n", today: "2026-01-01")
        #expect(t.debtId == "R" && t.icon == "🤝" && t.categoryId == nil && t.isPlainDebtCollection)
        let back = TransactionDraft(editing: t)
        #expect(back.isDebtCollection && back.debtId == "R")
    }

    @Test func editCollectionToPlainIncomeClearsLink() {
        var d = TransactionDraft()
        d.type = .income; d.isCollection = true; d.debtId = "R"; d.accountId = "a"; d.amountText = "500"
        d.date = DateUtil.parseDay("2026-01-01")!
        let t = d.makeNew(id: "t", account: acc, workspaceId: "w", fx: fx, now: "n", today: "2026-01-01")
        var e = TransactionDraft(editing: t)
        e.isCollection = false; e.categoryId = "maas"
        let out = e.applying(to: t, account: acc, fx: fx)
        #expect(out.debtId == nil && out.icon == nil && out.categoryId == "maas" && Calc.isFlow(out, asOf: "2026-12-31"))
        let patches = DebtPayments.reconcileEdit(old: t, new: out,
                                                 debts: [Debt(raw: ["id": "R", "direction": "owed", "totalAmount": 1000, "paidAmount": 500, "paidInstallments": 1])], fx: fx)
        #expect(patches.first?.paidAmount == 0 && patches.first?.paidInstallments == 0)
    }

    @Test func crossWorkspaceValidation() {
        var d = TransactionDraft()
        d.type = .transfer; d.transferTarget = .workspace; d.accountId = "a"; d.amountText = "100"
        #expect(d.validationError() == "Çalışma alanı seçin.")
        d.targetWorkspaceId = "w2"
        #expect(d.validationError() == "Hedef hesabı seçin.")
        d.toAccountId = "b"
        #expect(d.validationError() == "Açıklama girin.")
        d.description = "Aile bütçesine"
        #expect(d.validationError() == nil)
        d.crossPayDebt = true
        #expect(d.validationError() == "Borç seçin.")
    }

    @Test func interestRateDefaults() {
        var d = TransactionDraft()
        d.amountText = "254,28"
        #expect(d.interestRate(account: acc) == 17.5)
        #expect(d.interestSplit(account: acc) == .init(gross: 308.22, tax: 53.94, net: 254.28))
        d.interestRateText = "15"
        #expect(d.interestRate(account: acc) == 15)
        let dep = Account(raw: ["id": "v", "type": "savings", "currency": "TRY", "depositTaxPct": 10])
        d.interestRateText = nil
        #expect(d.interestRate(account: dep) == 10)
    }
}
