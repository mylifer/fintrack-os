import Foundation
import Testing
@testable import FinTrackCore

/* Web src/lib/utils/card-statement.test.ts ile AYNI girdiler ve beklenen
   sonuçlar. Biri değişirse diğeri de değişmeli. Son suite (forCard) iOS'a
   özgü: web CardStatementPanel'in bağlantısını doğrular. */

/// Web testindeki `tx`: kimlik rastgele (ödeme kimlik kümesine takılmasın),
/// varsayılan kart 'cc'.
private func ctx(_ o: JSONObject = [:]) -> Transaction {
    var raw: JSONObject = [
        "id": .string(UUID().uuidString), "type": "expense", "amount": 0, "currency": "TRY", "date": "2026-09-01",
        "accountId": "cc", "description": "", "isInstallment": false, "createdAt": "", "updatedAt": "",
    ]
    for (k, v) in o { raw[k] = v }
    return Transaction(raw: raw)
}

private func card(_ statementDay: Int, _ extra: JSONObject = [:]) -> Account {
    var raw: JSONObject = ["id": "cc", "name": "Kart", "type": "credit_card", "currency": "TRY",
                           "statementDay": .number(Double(statementDay))]
    for (k, v) in extra { raw[k] = v }
    return Account(raw: raw)
}

private let noFX = FX()

@Suite("buildCardStatements")
struct BuildCardStatementsTests {
    let account = card(15)

    @Test func donemBorcuOdemelerVeMutabakatHaric() {
        let payment = ctx(["id": "pay", "type": "transfer", "accountId": "bank", "toAccountId": "cc", "amount": 1000, "date": "2026-09-20"])
        let incomePay = ctx(["id": "pay2", "type": "income", "amount": 200, "date": "2026-09-01", "description": "Kredi Kartı Ödemesi"])
        let rows = [
            ctx(["amount": 1500, "date": "2026-08-20"]),
            ctx(["type": "transfer", "toAccountId": "cash", "amount": 300, "date": "2026-09-01"]),   // nakit avans
            ctx(["type": "income", "amount": 100, "date": "2026-09-10"]),                             // iade
            ctx(["amount": 999, "date": "2026-09-10", "systemKind": "reconciliation"]),
            ctx(["amount": 50, "date": "2026-09-10", "accountId": "baska-kart"]),
            incomePay,
            payment,
        ]
        let r = CardStatements.buildCardStatements(
            account: account, transactions: rows, payments: [payment, incomePay],
            dueDay: 25, minPayPct: 20, today: "2026-09-26", count: 1, fx: noFX)
        let s = r.statements[0]
        #expect(s.period == StatementPeriod(from: "2026-08-16", to: "2026-09-15"))
        #expect(s.total == 1700)
        #expect(s.dueDate == "2026-09-25")
        #expect(s.minPayment == 340)
        #expect(s.paid == 1000)
        // son ödeme geçti ama asgari (340) ödendi → gecikmiş değil, kısmi
        #expect(s.status == .partial)
    }

    @Test func durumlar() {
        let rows = [ctx(["amount": 500, "date": "2026-09-01"])]
        func pay(_ amount: Double, _ date: String) -> Transaction {
            ctx(["type": "transfer", "accountId": "bank", "toAccountId": "cc", "amount": .number(amount), "date": .string(date)])
        }
        func first(_ txs: [Transaction], _ payments: [Transaction], _ today: String) -> CardStatement {
            CardStatements.buildCardStatements(account: account, transactions: txs, payments: payments,
                                               dueDay: 25, minPayPct: nil, today: today, count: 1, fx: noFX).statements[0]
        }
        #expect(first([], [], "2026-09-26").status == .clear)
        let p1 = pay(500, "2026-09-24")
        #expect(first(rows, [p1], "2026-09-26").status == .paid)
        #expect(first(rows, [], "2026-09-26").status == .overdue)
        #expect(first(rows, [], "2026-09-20").status == .open)

        let noDue = CardStatements.buildCardStatements(account: account, transactions: rows, payments: [],
                                                       dueDay: nil, minPayPct: nil, today: "2026-09-26", count: 1, fx: noFX)
        #expect(noDue.statements[0].dueDate == nil)
        #expect(noDue.statements[0].status == .open)
    }

    @Test func acikDonemGelecekTaksitSayilmaz() {
        let rows = [
            ctx(["amount": 80, "date": "2026-09-20"]),
            ctx(["amount": 70, "date": "2026-10-10", "isInstallment": true, "installGroupId": "g"]),
        ]
        let r = CardStatements.buildCardStatements(account: account, transactions: rows, payments: [],
                                                   dueDay: nil, minPayPct: nil, today: "2026-09-26", fx: noFX)
        #expect(r.open.period == StatementPeriod(from: "2026-09-16", to: "2026-10-15"))
        #expect(r.open.total == 80)
    }

    @Test func durumEtiketleri() {
        #expect(StatementStatus.clear.label == "Borç yok")
        #expect(StatementStatus.paid.label == "Ödendi")
        #expect(StatementStatus.overdue.label == "Gecikti")
        #expect(StatementStatus.partial.label == "Kısmi")
        #expect(StatementStatus.open.label == "Bekliyor")
    }
}

@Suite("buildCardStatements — dönem sınırları ve aya özel tarihler")
struct CardStatementPeriodTests {
    @Test func kesimBugunseDonemAcikYilDonumu() {
        let a = CardStatements.buildCardStatements(account: card(25), transactions: [], payments: [],
                                                   dueDay: nil, minPayPct: nil, today: "2026-09-25", fx: noFX)
        #expect(a.open.period == StatementPeriod(from: "2026-08-26", to: "2026-09-25"))
        let r = CardStatements.buildCardStatements(account: card(28), transactions: [], payments: [],
                                                   dueDay: nil, minPayPct: nil, today: "2027-01-05", count: 1, fx: noFX)
        #expect(r.open.period == StatementPeriod(from: "2026-12-29", to: "2027-01-28"))
        #expect(r.statements[0].period == StatementPeriod(from: "2026-11-29", to: "2026-12-28"))
    }

    @Test func kartTakvimindeGirilenTarihlerEkstreyeYansir() {
        let rows = [ctx(["amount": 400, "date": "2026-09-23"]), ctx(["amount": 600, "date": "2026-09-24"])]
        let r = CardStatements.buildCardStatements(
            account: card(24), transactions: rows, payments: [], dueDay: 4, minPayPct: nil,
            today: "2026-10-10", count: 1,
            overrides: ["2026-10": CycleOverride(statementDate: "2026-09-23", dueDate: "2026-10-05")], fx: noFX)
        #expect(r.statements[0].period == StatementPeriod(from: "2026-08-25", to: "2026-09-23"))
        #expect(r.statements[0].dueDate == "2026-10-05")
        #expect(r.statements[0].total == 400)
        // 24 Eylül harcaması bir sonraki döneme kayar
        #expect(r.open.period.from == "2026-09-24")
        #expect(r.open.total == 600)
    }
}

@Suite("CardStatements.forCard — hesap sayfası bağlantısı")
struct CardStatementForCardTests {
    let accounts = [
        Account(raw: ["id": "chk", "name": "Vadesiz", "type": "checking", "currency": "TRY"]),
        card(24, ["name": "Garanti Bonus", "minPayPct": 3, "createdAt": "2026-01-01T00:00:00.000Z"]),
    ]

    @Test func farkTatilKuraliOdemeTespitiVeEskiAsgariOran() {
        // Plan son ödeme günü 4 → fark 10 (Garanti, 'due'); Ekim döngüsü: kesim 24 Eylül,
        // son ödeme 4 Ekim Pazar → 5 Ekim. minPayPct 3 = eski varsayılan → nil.
        let plan = PaymentPlan(raw: ["id": .string(DeterministicID.uuid("payplan:card:cc")), "targetKind": "card",
                                     "targetId": "cc", "dayOfMonth": 4, "isActive": true])
        let txs = [
            ctx(["amount": 1000, "date": "2026-09-10"]),
            ctx(["id": "p", "type": "expense", "accountId": "chk", "amount": 1000, "date": "2026-10-05",
                 "description": "Kredi Kartı Ödemesi"]),
            ctx(["amount": 5, "date": "2026-09-11", "deleted_at": "2026-09-12T00:00:00.000Z"]),
        ]
        let r = CardStatements.forCard(accounts[1], accounts: accounts, transactions: txs, plans: [plan],
                                       occurrences: [], fx: noFX, today: "2026-10-10", count: 1)
        let s = r.statements[0]
        #expect(s.period == StatementPeriod(from: "2026-08-25", to: "2026-09-24"))
        #expect(s.dueDate == "2026-10-05")
        #expect(s.total == 1000)
        #expect(s.paid == 1000)
        #expect(s.minPayment == nil)
        #expect(s.status == .paid)
    }

    @Test func ayaOzelTarihYalnizCanliSatirdan() {
        let occ = PaymentOccurrence(raw: ["id": "o1", "targetKind": "card", "targetId": "cc", "month": "2026-10",
                                          "statementDate": "2026-09-23", "dueDate": "2026-10-06"])
        let dead = PaymentOccurrence(raw: ["id": "o2", "targetKind": "card", "targetId": "cc", "month": "2026-11",
                                           "dueDate": "2026-11-20", "deleted_at": "2026-10-01T00:00:00.000Z"])
        let other = PaymentOccurrence(raw: ["id": "o3", "targetKind": "debt", "targetId": "cc", "month": "2026-09",
                                            "statementDate": "2026-08-01"])
        let ov = CardStatements.overrides(for: accounts[1], in: [occ, dead, other])
        #expect(ov == ["2026-10": CycleOverride(statementDate: "2026-09-23", dueDate: "2026-10-06")])

        let r = CardStatements.forCard(accounts[1], accounts: accounts, transactions: [], plans: [],
                                       occurrences: [occ, dead, other], fx: noFX, today: "2026-10-10", count: 1)
        // Plan yok → banka kuralı farkı (10): Ekim döngüsü özel tarihlerle
        #expect(r.statements[0].period == StatementPeriod(from: "2026-08-25", to: "2026-09-23"))
        #expect(r.statements[0].dueDate == "2026-10-06")
        #expect(r.statements[0].status == .clear)
    }

    @Test func dovizKartTutariKartParaBiriminde() {
        // USD kart; TRY harcama amountTry'dan USD'ye çevrilir (web inCurrency)
        let usdCard = card(15, ["currency": "USD"])
        let fx = FX(rates: FXRates(usdTry: 40, eurTry: 45, gbpTry: 52))
        let rows = [
            ctx(["amount": 10, "currency": "USD", "date": "2026-09-01"]),
            ctx(["amount": 400, "currency": "TRY", "amountTry": 400, "date": "2026-09-02"]),
        ]
        let r = CardStatements.buildCardStatements(account: usdCard, transactions: rows, payments: [],
                                                   dueDay: 25, minPayPct: 5, today: "2026-09-26", count: 1, fx: fx)
        #expect(r.statements[0].total == 20)
        #expect(r.statements[0].minPayment == 1)
    }
}
