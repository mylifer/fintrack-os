import Foundation
import Testing
@testable import FinTrackCore

/// "Öde" — web payRow. Kritik: gecikmiş ayı bugün ödeyince O AY ödendi olur;
/// otomatik tespit bu ödemeyi sonraki aya yazıyordu.
@Suite("ödeme takibi — öde")
struct PaymentActionsTests {
    let today = "2026-09-30"
    let bank = Account(raw: ["id": "chk", "name": "Banka", "type": "checking", "currency": "TRY"])
    let usd = Account(raw: ["id": "usd", "name": "Dolar", "type": "savings", "currency": "USD"])
    let card = Account(raw: ["id": "card1", "name": "Bonus", "type": "credit_card", "currency": "TRY",
                             "statementDay": 28, "createdAt": "2026-01-01T00:00:00.000Z"])
    var plan: PaymentPlan {
        PaymentPlan(raw: ["id": .string(PaymentSchedule.planIdFor(.card, "card1")), "targetKind": "card",
                          "targetId": "card1", "dayOfMonth": 5, "amount": 3000, "isActive": true])
    }

    func rows(_ txs: [Transaction], _ occs: [PaymentOccurrence], from: String = "2026-09", to: String = "2026-10") -> [PaymentRow] {
        let targets = PaymentSchedule.buildTargets(accounts: [bank, card], debts: [], plans: [plan], balances: [:])
        return PaymentSchedule.buildSchedule(targets: targets, occurrences: occs, transactions: txs,
                                             from: from, to: to, today: today, fx: fx)
    }

    @Test func gecikmisAyBugunOdeninceOAyOdenir() throws {
        let sep = rows([], []).first { $0.month == "2026-09" }!
        #expect(sep.timing == .overdue)
        let out = try PaymentActions.pay(row: sep, input: .init(amount: 3000, fromAccountId: "chk", date: today, createTransaction: true),
                                         from: bank, occurrences: [], existingTransactionIds: [], fx: fx,
                                         workspaceId: "ws", now: "N", transactionId: "p1", today: today)
        let t = try #require(out.transaction)
        #expect(t.type == .transfer && t.toAccountId == "card1" && t.amount == 3000)
        #expect(t.description == "Kredi Kartı Ödemesi")
        let o = out.occurrence
        #expect(o.id == PaymentSchedule.occurrenceIdFor(.card, "card1", "2026-09"))
        #expect(o.status == "paid" && o.transactionId == "p1" && o.paidAmount == 3000 && o.paidDate == today)
        #expect(o.dueDate == sep.dueDate)
        // Yeniden hesap: Eylül ödendi, Ekim AÇIK kalır (işlem Ekim'e sayılmaz)
        let after = rows([t], [o])
        #expect(after.first { $0.month == "2026-09" }?.state == .paid)
        #expect(after.first { $0.month == "2026-10" }?.state == .open)
    }

    @Test func mevcutKayitBirlesir() throws {
        let existing = PaymentOccurrence(raw: [
            "id": .string(PaymentSchedule.occurrenceIdFor(.card, "card1", "2026-10")), "targetKind": "card",
            "targetId": "card1", "month": "2026-10", "statementDate": "2026-09-27", "note": "eski not",
            "createdAt": "C", "workspaceId": "ws",
        ])
        let oct = rows([], [existing]).first { $0.month == "2026-10" }!
        let out = try PaymentActions.pay(row: oct, input: .init(amount: 3000, fromAccountId: nil, date: today, createTransaction: false),
                                         from: nil, occurrences: [existing], existingTransactionIds: [], fx: fx,
                                         workspaceId: "ws", now: "N", today: today)
        #expect(out.transaction == nil)
        #expect(out.occurrence.statementDate == "2026-09-27")
        #expect(out.occurrence.note == "eski not")
        #expect(out.occurrence.raw["createdAt"] == "C")
        #expect(out.occurrence.transactionId == nil)
        #expect(out.occurrence.status == "paid")
    }

    @Test func dovizHesaptanVeMukerrerKimlik() throws {
        let sep = rows([], []).first { $0.month == "2026-09" }!
        let out = try PaymentActions.pay(row: sep, input: .init(amount: 3450, fromAccountId: "usd", date: today, createTransaction: true),
                                         from: usd, occurrences: [], existingTransactionIds: [], fx: fx,
                                         workspaceId: nil, now: "N", today: today)
        #expect(out.transaction?.amount == 100)          // 3450 TRY → 100 USD (34,5)
        #expect(out.transaction?.currency == .USD)
        let dup = try PaymentActions.pay(row: sep, input: .init(amount: 3000, fromAccountId: "chk", date: today, createTransaction: true),
                                         from: bank, occurrences: [], existingTransactionIds: ["x"], fx: fx,
                                         workspaceId: nil, now: "N", transactionId: "x", today: today)
        #expect(dup.transaction == nil)
        #expect(dup.occurrence.transactionId == "x")
    }

    @Test func borcOdemesiTRYDegeri() throws {
        let d = Debt(raw: ["id": "debt1", "name": "Araba Kredisi", "direction": "owe", "totalAmount": 30000,
                           "paidAmount": 0, "startDate": "2026-09-15", "monthlyPayment": 5000, "totalInstallments": 6, "accountId": "chk"])
        let targets = PaymentSchedule.buildTargets(accounts: [bank], debts: [d], plans: [], balances: [:])
        let row = PaymentSchedule.buildSchedule(targets: targets, occurrences: [], transactions: [], from: "2026-09",
                                                to: "2026-09", today: today, fx: fx).first!
        let out = try PaymentActions.pay(row: row, input: .init(amount: 5000, fromAccountId: "chk", date: today, createTransaction: true),
                                         from: bank, occurrences: [], existingTransactionIds: [], fx: fx,
                                         workspaceId: nil, now: "N", today: today)
        #expect(out.transaction?.debtId == "debt1")
        #expect(out.transaction?.toAccountId == nil)
        #expect(out.transaction?.description == "Araba Kredisi Ödemesi")
        #expect(out.debtDeltaTry == 5000)
    }
}
