import Testing
@testable import FinTrackCore

@Suite("borç ödemesi")
struct DebtPaymentTests {
    func debt(_ o: JSONObject = [:]) -> Debt {
        var raw: JSONObject = ["id": "d", "name": "Araba Kredisi", "direction": "owe", "totalAmount": 30000,
                               "paidAmount": 0, "startDate": "2026-09-15", "monthlyPayment": 5000,
                               "totalInstallments": 6, "isSettled": false]
        for (k, v) in o { raw[k] = v }
        return Debt(raw: raw)
    }
    let bank = Account(raw: ["id": "b", "name": "Banka", "type": "checking", "currency": "TRY"])
    let usd = Account(raw: ["id": "u", "name": "Dolar", "type": "savings", "currency": "USD"])

    @Test func plan() {
        let p = debt(["paidAmount": 7500]).paymentPlan(today: "2026-11-20")
        #expect(p.count == 6)
        #expect(p.map(\.date).prefix(3) == ["2026-09-15", "2026-10-15", "2026-11-15"])
        #expect(p.map(\.status).prefix(3) == [.paid, .partial, .overdue])
        #expect(p[3].status == .pending)
        #expect(debt(["paidAmount": 7500]).nextInstallmentAmount(today: "2026-11-20") == 5000)
        // son taksit kalan: 10.000 / aylık 3.000 → 3,3,3,1
        let q = debt(["totalAmount": 10000, "monthlyPayment": 3000, "totalInstallments": .null]).paymentPlan()
        #expect(q.map(\.amount) == [3000, 3000, 3000, 1000])
        #expect(debt(["monthlyPayment": .null, "paidAmount": 1000]).nextInstallmentAmount() == 29000)
    }

    @Test func odemeSatirlari() throws {
        let out = try DebtPayments.pay(debt(["paidAmount": 25000, "paidInstallments": 5]), from: bank, amount: 5000,
                                       date: "2026-09-30", fx: fx, workspaceId: "ws", now: "N", id: "t1", today: "2026-09-30")
        let row = out.transaction.rowForWrite(updatedAt: "N")
        #expect(row["type"] == "transfer")
        #expect(row["toAccountId"] == .null)
        #expect(row["debtId"] == "d")
        #expect(row["description"] == "Araba Kredisi ödemesi")
        #expect(row["amountTry"] == 5000)
        #expect(row["approvalStatus"] == .null)
        #expect(row["categoryId"] == .null)
        #expect(out.debt.paidAmount == 30000)
        #expect(out.debt.paidInstallments == 6)
        #expect(out.debt.isSettled)
        #expect(out.transaction.isPlainDebtPayment)
    }

    @Test func dovizVeGelecek() throws {
        let out = try DebtPayments.pay(debt(), from: usd, amount: 100, date: "2026-10-05", fx: fx,
                                       workspaceId: nil, now: "N", today: "2026-09-30")
        #expect(out.transaction.amountTry == 3450)       // 100 × 34,5
        #expect(out.debt.paidAmount == 3450)
        #expect(out.transaction.approvalStatus == .pending)
        #expect(throws: DebtPayments.PaymentError.self) {
            try DebtPayments.pay(debt(), from: usd, amount: 100, date: "2026-09-30", fx: FX(), workspaceId: nil, now: "N")
        }
    }

    @Test func geriAlma() throws {
        let d = debt(["paidAmount": 30000, "paidInstallments": 6, "isSettled": true])
        let t = tx(["type": "transfer", "amount": 5000, "amountTry": 5000, "debtId": "d"])
        let r = DebtPayments.revert(d, payment: t, fx: fx)
        #expect(r.paidAmount == 25000)
        #expect(r.paidInstallments == 5)
        #expect(!r.isSettled)
        // sıfırın altına inmez
        #expect(DebtPayments.revert(debt(["paidAmount": 100]), payment: t, fx: fx).paidAmount == 0)
    }
}
