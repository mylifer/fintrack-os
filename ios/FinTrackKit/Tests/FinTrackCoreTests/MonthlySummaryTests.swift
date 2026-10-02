import Testing
@testable import FinTrackCore

/// web src/lib/utils/monthly-summary.test.ts karşılığı
@Suite("aylık özet")
struct MonthlySummaryTests {
    let ledger: [Transaction] = [
        tx(["id": "1", "type": "income", "amount": 50000, "date": "2025-09-01", "categoryId": "salary"]),
        tx(["id": "2", "amount": 20000, "date": "2025-09-02", "categoryId": "rent"]),
        tx(["id": "3", "amount": 6000, "date": "2025-09-10", "categoryId": "food"]),
        tx(["id": "4", "amount": 4000, "date": "2025-09-20", "categoryId": "food"]),
        tx(["id": "5", "amount": 1500, "date": "2025-09-30", "categoryId": "fun"]),
        tx(["id": "6", "type": "transfer", "amount": 9999, "date": "2025-09-05", "toAccountId": "b"]),
        // Ağustos
        tx(["id": "7", "type": "income", "amount": 40000, "date": "2025-08-01"]),
        tx(["id": "8", "amount": 20000, "date": "2025-08-02", "categoryId": "rent"]),
        tx(["id": "9", "amount": 5000, "date": "2025-08-31", "categoryId": "food"]),
        // Geçen yıl Eylül
        tx(["id": "10", "amount": 15000, "date": "2024-09-02", "categoryId": "rent"]),
    ]
    let sep = MonthYear(month: 9, year: 2025)

    @Test func tamAy() {
        let s = MonthlySummary.build(ledger, month: sep, fx: FX(), asOf: "2025-10-15")
        #expect(!s.partial)
        #expect(s.current.from == "2025-09-01" && s.current.to == "2025-09-30")
        #expect(s.current.income == 50000 && s.current.expense == 31500 && s.current.net == 18500)
        #expect(abs((s.current.savingsRate ?? 0) - 37) < 0.01)
        // 31 Ağustos da sayılır: kıyas ayı tam ay
        #expect(s.previous.to == "2025-08-31" && s.previous.income == 40000 && s.previous.expense == 25000)
        #expect(s.lastYear.to == "2024-09-30" && s.lastYear.expense == 15000 && s.lastYear.savingsRate == nil)
        #expect(s.txCount == 5)   // virman sayılmaz
        #expect(abs(s.dailyAvgExpense - 1050) < 0.01)
    }

    @Test func kategoriler() {
        let s = MonthlySummary.build(ledger, month: sep, fx: FX(), asOf: "2025-10-15")
        #expect(s.categories.map(\.categoryId) == ["rent", "food", "fun"])
        #expect(s.categories[0].amount == 20000 && s.categories[0].prevAmount == 20000
                && s.categories[0].yearAmount == 15000 && s.categories[0].change == 0)
        #expect(s.categories[1].amount == 10000 && s.categories[1].prevAmount == 5000 && s.categories[1].change == 100)
        #expect(s.categories[2].prevAmount == 0 && s.categories[2].change == nil)
        // artış listesi yalnız önceki ayda da harcanan kategoriler
        #expect(s.increases.map(\.categoryId) == ["food"])
        #expect(s.largestExpenses.map(\.amount) == [20000, 6000, 4000, 1500])
    }

    @Test func devamEdenAyKirpilir() {
        let withFuture = ledger + [tx(["id": "f", "amount": 999, "date": "2025-09-25", "categoryId": "fun"])]
        let s = MonthlySummary.build(withFuture, month: sep, fx: FX(), asOf: "2025-09-15")
        #expect(s.partial && s.daysCounted == 15)
        #expect(s.current.to == "2025-09-15" && s.current.expense == 26000)
        #expect(s.previous.from == "2025-08-01" && s.previous.to == "2025-08-15" && s.previous.expense == 20000)
        #expect(s.lastYear.to == "2024-09-15" && s.lastYear.expense == 15000)
    }

    @Test func kisaAyKirpmasi() {
        let mar = MonthYear(month: 3, year: 2025)
        let s = MonthlySummary.build([], month: mar, fx: FX(), asOf: "2025-03-31")
        #expect(!s.partial && s.previous.to == "2025-02-28")
        let p = MonthlySummary.build([], month: mar, fx: FX(), asOf: "2025-03-30")
        #expect(p.partial && p.previous.to == "2025-02-28")
    }

    @Test func taksitlerSatinAlmaAyinaRealizeKarDahil() {
        let txs = [
            tx(["id": "i1", "amount": 1000, "date": "2025-09-05", "isInstallment": true, "installGroupId": "g",
                "installIndex": 1, "installTotal": 3, "categoryId": "fun"]),
            tx(["id": "i2", "amount": 1000, "date": "2025-10-05", "isInstallment": true, "installGroupId": "g",
                "installIndex": 2, "installTotal": 3, "categoryId": "fun"]),
            tx(["id": "i3", "amount": 1000, "date": "2025-11-05", "isInstallment": true, "installGroupId": "g",
                "installIndex": 3, "installTotal": 3, "categoryId": "fun"]),
            tx(["id": "k", "type": "income", "amount": 700, "date": "2025-09-12", "icon": "📈", "description": "ABC Satış Kârı"]),
        ]
        let s = MonthlySummary.build(Installments.collapse(txs), month: sep, fx: FX(), asOf: "2025-09-30")
        #expect(s.current.expense == 3000)
        #expect(s.current.income == 700)
    }

    @Test func mutabakatVeOnayBekleyenHaric() {
        let txs = [
            tx(["id": "a", "amount": 100, "date": "2025-09-03", "categoryId": "food"]),
            tx(["id": "r", "amount": 500, "date": "2025-09-04", "systemKind": "reconciliation"]),
            tx(["id": "p", "amount": 900, "date": "2025-09-05", "approvalStatus": "pending"]),
        ]
        let s = MonthlySummary.build(txs, month: sep, fx: FX(), asOf: "2025-10-01")
        #expect(s.current.expense == 100)
        #expect(s.largestExpenses.map(\.id) == ["a"])
    }

    @Test func varsayilanAy() {
        #expect(MonthlySummary.defaultMonth(today: "2026-10-02") == MonthYear(month: 9, year: 2026))
        #expect(MonthlySummary.defaultMonth(today: "2026-10-08") == MonthYear(month: 10, year: 2026))
        #expect(MonthlySummary.defaultMonth(today: "2026-01-05") == MonthYear(month: 12, year: 2025))
    }
}
