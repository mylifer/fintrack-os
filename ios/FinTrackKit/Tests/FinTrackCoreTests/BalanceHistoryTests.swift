import Testing
@testable import FinTrackCore

@Suite("bakiye seyri")
struct BalanceHistoryTests {
    let a = Account(raw: ["id": "a", "name": "Banka", "type": "checking", "currency": "TRY", "initialBalance": 1000])

    @Test func geriyeDogru() {
        let posted = [
            tx(["type": "income", "amount": 500, "date": "2026-09-28", "accountId": "a"]),
            tx(["type": "expense", "amount": 200, "date": "2026-09-30", "accountId": "a"]),
            tx(["type": "transfer", "amount": 100, "date": "2026-09-29", "accountId": "b", "toAccountId": "a"]),
            tx(["type": "expense", "amount": 999, "date": "2026-09-29", "accountId": "baska"]),
        ]
        let current = Calc.balance(of: a, posted: posted, fx: fx)   // 1000 + 500 + 100 − 200 = 1400
        #expect(current == 1400)
        let h = Calc.balanceHistory(a, current: current, posted: posted, fx: fx, days: 3, today: "2026-09-30")
        #expect(h.map(\.date) == ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"])
        #expect(h.map(\.balance) == [1000, 1500, 1600, 1400])
    }
}
