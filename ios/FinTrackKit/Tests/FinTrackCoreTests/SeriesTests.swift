import Testing
@testable import FinTrackCore

@Suite("aylık seri ve dönem karşılaştırması")
struct SeriesTests {
    let txs: [Transaction] = [
        tx(["type": "expense", "amount": 100, "amountTry": 100, "date": "2026-08-05"]),
        tx(["type": "expense", "amount": 50, "amountTry": 50, "date": "2026-08-20"]),   // 20'sinden sonra: karşılaştırmaya girmez
        tx(["type": "income", "amount": 1000, "amountTry": 1000, "date": "2026-08-01"]),
        tx(["type": "expense", "amount": 70, "amountTry": 70, "date": "2026-09-10"]),
        tx(["type": "expense", "amount": 30, "amountTry": 30, "date": "2026-09-25"]),   // gelecek (bugün 19'u)
    ]

    @Test func seriEskidenYeniye() {
        let s = Calc.monthlySeries(txs, endingAt: MonthYear(month: 9, year: 2026), count: 3, fx: fx, asOf: "2026-09-30")
        #expect(s.map(\.month.month) == [7, 8, 9])
        #expect(s[1].flow.expense == 150)
        #expect(s[1].flow.income == 1000)
        #expect(s[2].flow.expense == 100)
    }

    @Test func yilDonumu() {
        let s = Calc.monthlySeries([], endingAt: MonthYear(month: 2, year: 2026), count: 4, fx: fx)
        #expect(s.map(\.month.month) == [11, 12, 1, 2])
        #expect(s.first?.month.year == 2025)
    }

    @Test func gecenAyinAyniDonemi() {
        let r = Calc.monthToDateExpense(txs, fx: fx, today: "2026-09-19")
        #expect(r.current == 70)
        #expect(r.previous == 100)
    }

    @Test func kisaAydaSonGun() {
        // 31 Mart → Şubat'ın 28'i
        let list = [tx(["type": "expense", "amount": 10, "amountTry": 10, "date": "2026-02-28"])]
        #expect(Calc.monthToDateExpense(list, fx: fx, today: "2026-03-31").previous == 10)
    }
}

@Suite("kategoriye göre toplam")
struct AmountByCategoryTests {
    @Test func gelirVeGider() {
        let txs = [
            tx(["type": "expense", "amount": 100, "amountTry": 100, "categoryId": "m"]),
            tx(["type": "expense", "amount": 50, "amountTry": 50, "categoryId": "m"]),
            tx(["type": "income", "amount": 1000, "amountTry": 1000, "categoryId": "s"]),
            tx(["type": "income", "amount": 7, "amountTry": 7]),
            tx(["type": "expense", "amount": 999, "amountTry": 999, "categoryId": "m", "icon": "📈"]),   // yatırım bağlı
        ]
        #expect(Calc.amountByCategory(txs, type: .expense, fx: fx) == ["m": 150])
        #expect(Calc.amountByCategory(txs, type: .income, fx: fx) == ["s": 1000, "": 7])
        #expect(Calc.expenseByCategory(txs, fx: fx) == ["m": 150])
    }
}
