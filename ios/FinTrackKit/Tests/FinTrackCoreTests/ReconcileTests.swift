import Testing
@testable import FinTrackCore

@Suite("bakiye eşitleme")
struct ReconcileTests {
    let bank = Account(raw: ["id": "b", "name": "Banka", "type": "checking", "currency": "TRY"])
    let card = Account(raw: ["id": "k", "name": "Kart", "type": "credit_card", "currency": "TRY"])
    let usd = Account(raw: ["id": "u", "name": "Dolar", "type": "savings", "currency": "USD"])

    @Test func fazlaGelirEksikGider() throws {
        let up = try Reconcile.make(account: bank, input: 1120.5, balance: 1000, fx: fx, workspaceId: "ws", now: "N", today: "2026-09-30")
        #expect(up.type == .income && up.amount == 120.5 && up.amountTry == 120.5)
        #expect(up.systemKind == "reconciliation" && up.tags == ["#BakiyeEşitleme"])
        #expect(up.description == "Sistem: Bakiye Eşitleme" && up.categoryId == nil && up.date == "2026-09-30")
        #expect(Calc.isReconciliation(up) && !Calc.isFlow(up, asOf: "2026-09-30"))
        #expect(up.isPlainReconciliation && up.canDeleteOnIOS)
        let down = try Reconcile.make(account: bank, input: 900, balance: 1000, fx: fx, workspaceId: nil, now: "N")
        #expect(down.type == .expense && down.amount == 100)
        // bakiyeyi düzeltir
        #expect(Calc.balance(of: Account(raw: ["id": "b", "initialBalance": 1000]), posted: [down], fx: fx) == 900)
    }

    @Test func kartBorcuEksiSayilir() throws {
        // uygulamada −4.000, bankada borç 4.500 → 500 gider
        let t = try Reconcile.make(account: card, input: 4500, balance: -4000, fx: fx, workspaceId: nil, now: "N")
        #expect(t.type == .expense && t.amount == 500)
        #expect(Reconcile.actualSigned(-300, account: card) == -300)
    }

    @Test func sifirFarkVeDoviz() throws {
        #expect(throws: Reconcile.ReconcileError.alreadyBalanced) {
            try Reconcile.make(account: bank, input: 1000, balance: 1000.004, fx: fx, workspaceId: nil, now: "N")
        }
        let u = try Reconcile.make(account: usd, input: 110, balance: 100, fx: fx, workspaceId: nil, now: "N")
        #expect(u.currency == .USD && u.amount == 10 && u.amountTry == 345)
        let noRate = try Reconcile.make(account: usd, input: 110, balance: 100, fx: FX(), workspaceId: nil, now: "N")
        #expect(noRate.raw["amountTry"] == nil)
    }
}
