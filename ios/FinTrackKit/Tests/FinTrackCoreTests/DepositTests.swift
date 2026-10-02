import Testing
@testable import FinTrackCore

/// web src/lib/utils/deposit.test.ts karşılığı (+ faizi işleme)
@Suite("vadeli mevduat")
struct DepositTests {
    func acc(_ o: JSONObject) -> Account {
        var raw: JSONObject = ["id": "v", "name": "Vadeli", "type": "savings", "currency": "TRY", "initialBalance": 0,
                               "color": "#000", "customField": "korunur"]
        for (k, v) in o { raw[k] = v }
        return Account(raw: raw)
    }
    let t = Deposit.Terms(rate: 45, start: "2026-09-01", end: "2026-10-03", taxPct: 17.5)   // 32 gün

    @Test func kosullar() {
        #expect(Deposit.terms(acc(["depositRate": 45, "depositStart": "2026-09-01", "depositEnd": "2026-10-03"]))
                == Deposit.Terms(rate: 45, start: "2026-09-01", end: "2026-10-03", taxPct: Deposit.defaultTax))
        #expect(Deposit.terms(acc(["type": "checking", "depositRate": 45, "depositStart": "2026-09-01", "depositEnd": "2026-10-03"])) == nil)
        #expect(Deposit.terms(acc(["depositRate": 0, "depositStart": "2026-09-01", "depositEnd": "2026-10-03"])) == nil)
        #expect(Deposit.terms(acc(["depositRate": 45, "depositStart": "2026-10-03", "depositEnd": "2026-09-01"])) == nil)
        #expect(Deposit.terms(acc(["depositRate": 45, "depositStart": "2026-09-01"])) == nil)
        #expect(Deposit.terms(acc(["depositRate": 45, "depositStart": "2026-09-01", "depositEnd": .null])) == nil)
    }

    @Test func basitFaizStopajNet() {
        let p = Deposit.project(100_000, t, asOf: "2026-09-17")
        // 100.000 × 0,45 × 32 / 365 = 3.945,21
        #expect(p.days == 32 && p.gross == 3945.21 && p.tax == 690.41 && p.net == 3254.8 && p.maturityValue == 103254.8)
        #expect(p.daysLeft == 16)
        #expect(abs(p.accruedNet - 1627.4) < 0.05)
        #expect(!p.matured)
    }

    @Test func vadeGunuVeSonrasi() {
        let p = Deposit.project(100_000, t, asOf: "2026-10-05")
        #expect(p.matured && p.daysLeft == 0 && p.accruedNet == p.net)
        #expect(Deposit.project(100_000, t, asOf: "2026-10-03").matured)
    }

    @Test func negatifBakiyeFaizUretmez() {
        #expect(Deposit.project(-500, t, asOf: "2026-09-10").gross == 0)
    }

    @Test func yenilenir() {
        #expect(Deposit.rolled(t) == Deposit.Terms(rate: 45, start: "2026-10-03", end: "2026-11-04", taxPct: 17.5))
    }

    @Test func faiziIsleYenile() throws {
        let a = acc(["depositRate": 45, "depositStart": "2026-09-01", "depositEnd": "2026-10-03", "depositTaxPct": 17.5])
        let cats = [FinTrackCore.Category(raw: ["id": "c-maas", "name": "Maaş", "scope": "income"]),
                    FinTrackCore.Category(raw: ["id": "c-faiz", "name": "Mevduat FAİZİ", "scope": "income"])]
        let r = try #require(Deposit.process(account: a, balance: 100_000, categories: cats, renew: true,
                                             fx: FX(), workspaceId: "w", now: "2026-10-04T08:00:00.000Z"))
        let tx = try #require(r.interest)
        #expect(tx.amount == 3254.8 && tx.type == .income && tx.date == "2026-10-03" && tx.accountId == "v")
        #expect(tx.categoryId == "c-faiz")
        #expect(tx.description == "Vadeli mevduat faizi (net, %45)")
        #expect(tx.amountTry == 3254.8 && tx.workspaceId == "w")
        // Aynı vade → aynı kimlik (tekrar denemede ikinci faiz satırı yok)
        let again = try #require(Deposit.process(account: a, balance: 100_000, categories: cats, renew: true,
                                                 fx: FX(), workspaceId: "w", now: "x"))
        #expect(again.interest?.id == tx.id)
        // Koşullar ileri kaydı; ham alanlar korunur
        #expect(Deposit.terms(r.account) == Deposit.Terms(rate: 45, start: "2026-10-03", end: "2026-11-04", taxPct: 17.5))
        #expect(r.account.raw["customField"] == "korunur")
    }

    @Test func faiziIsleBitir() throws {
        let a = acc(["depositRate": 42.5, "depositStart": "2026-09-01", "depositEnd": "2026-10-03"])
        let r = try #require(Deposit.process(account: a, balance: 50_000, categories: [], renew: false,
                                             fx: FX(), workspaceId: nil, now: "n"))
        #expect(r.interest?.categoryId == nil)
        #expect(r.interest?.description == "Vadeli mevduat faizi (net, %42,5)")
        #expect(Deposit.terms(r.account) == nil)
        #expect(r.account.raw["depositEnd"] == .null && r.account.raw["depositRate"] == .null)
        // Sıfır bakiye: faiz satırı yok, koşullar yine kapanır
        let z = try #require(Deposit.process(account: a, balance: 0, categories: [], renew: false, fx: FX(), workspaceId: nil, now: "n"))
        #expect(z.interest == nil && Deposit.terms(z.account) == nil)
    }

    /// Web'in rastgele kimlikli faiz satırı da tanınır (çift faiz yok)
    @Test func islenmisFaizTaninir() {
        let web = tx(["id": "rastgele", "type": "income", "accountId": "v", "date": "2026-10-03",
                      "description": "Vadeli mevduat faizi (net, %45)", "amount": 3254.8])
        #expect(Deposit.interestBooked([web], accountId: "v", end: "2026-10-03"))
        #expect(!Deposit.interestBooked([web], accountId: "v", end: "2026-11-04"))
        #expect(!Deposit.interestBooked([web], accountId: "baska", end: "2026-10-03"))
        let silinmis = tx(["id": "s", "type": "income", "accountId": "v", "date": "2026-10-03",
                           "description": "Vadeli mevduat faizi (net, %45)", "deleted_at": "2026-10-04T00:00:00Z"])
        #expect(!Deposit.interestBooked([silinmis], accountId: "v", end: "2026-10-03"))
    }

    @Test func yalnizVadeSutunlari() {
        let c = Deposit.nextColumns(t, renew: true)
        #expect(Set(c.keys) == ["depositRate", "depositStart", "depositEnd", "depositTaxPct"])
        #expect(c["depositEnd"] == "2026-11-04")
        #expect(Deposit.nextColumns(t, renew: false).values.allSatisfy { $0 == .null })
    }
}
