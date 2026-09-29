import Testing
@testable import FinTrackCore

/// Web goals.test.ts — kurlar usd 40, eur 45, gbp 52; bugün 2026-09-25.
@Suite("birikim hedefleri")
struct GoalsTests {
    let gfx = FX(rates: FXRates(usdTry: 40, eurTry: 45, gbpTry: 52))
    let today = "2026-09-25"

    func goal(_ o: JSONObject) -> SavingsGoal {
        var raw: JSONObject = ["id": "g", "name": "Tatil", "targetAmount": 50000]
        for (k, v) in o { raw[k] = v }
        return SavingsGoal(raw: raw)
    }
    func acct(_ o: JSONObject) -> Account {
        var raw: JSONObject = ["id": "a", "name": "Hesap", "type": "savings", "currency": "TRY", "isArchived": false]
        for (k, v) in o { raw[k] = v }
        return Account(raw: raw)
    }

    @Test func kalanAy() {
        #expect(Goals.monthsLeft(today: today, target: "2026-12-31") == 3)
        #expect(Goals.monthsLeft(today: today, target: "2026-09-30") == 1)
        #expect(Goals.monthsLeft(today: today, target: "2027-09-01") == 12)
    }

    @Test func elleTakip() {
        let p = Goals.progress(goal(["savedAmount": 20000, "targetDate": "2026-12-31"]), accounts: [], balances: [:], fx: gfx, today: today)
        #expect(p.current == 20000)
        #expect(p.remaining == 30000)
        #expect(p.percent == 40)
        #expect(p.monthsLeft == 3)
        #expect(p.monthlyNeeded == 10000)
        #expect(!p.done)
    }

    @Test func bagliHesap() {
        let p = Goals.progress(goal(["accountId": "a", "savedAmount": 1]), accounts: [acct(["currency": "USD"])],
                               balances: ["a": 500], fx: gfx, today: today)
        #expect(p.current == 20000)
        #expect(p.linkedAccountId == "a")
        #expect(p.monthlyNeeded == nil)
    }

    @Test func eksikArsivVeEksiBakiye() {
        #expect(Goals.progress(goal(["accountId": "yok", "savedAmount": 700]), accounts: [], balances: [:], fx: gfx, today: today).current == 700)
        #expect(Goals.progress(goal(["accountId": "a", "savedAmount": 700]), accounts: [acct(["isArchived": true])],
                               balances: ["a": 9], fx: gfx, today: today).current == 700)
        #expect(Goals.progress(goal(["accountId": "a"]), accounts: [acct([:])], balances: ["a": -300], fx: gfx, today: today).current == 0)
    }

    @Test func tamamVeGecikme() {
        let d = Goals.progress(goal(["savedAmount": 60000, "targetDate": "2026-12-31"]), accounts: [], balances: [:], fx: gfx, today: today)
        #expect(d.done && d.percent == 100 && d.remaining == 0 && d.monthlyNeeded == nil)
        let o = Goals.progress(goal(["savedAmount": 100, "targetDate": "2026-08-31"]), accounts: [], balances: [:], fx: gfx, today: today)
        #expect(o.overdue && o.monthlyNeeded == nil)
    }

    @Test func ekleCikarSifirAltinaInmez() {
        #expect(Goals.adjusted(goal(["savedAmount": 100]), by: -250).savedAmount == 0)
        #expect(Goals.adjusted(goal([:]), by: 99.99).savedAmount == 99.99)
    }
}
