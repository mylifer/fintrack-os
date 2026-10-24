import Foundation
import Testing
@testable import FinTrackCore

/* Web src/lib/utils/forecast.test.ts ile AYNI girdiler ve beklenen sonuçlar.
   Biri değişirse diğeri de değişmeli. Web hesabındaki çalışma anı `balance`
   alanı burada ham satıra "balance" olarak yazılır ve `balances` sözlüğüne
   çevrilir. Kurlar web testindeki setBaseRates ile aynı. */

private let fcFX = FX(rates: FXRates(usdTry: 30, eurTry: 35, gbpTry: 40))
private let TODAY = "2026-01-01"

private func fcAccount(_ o: JSONObject = [:]) -> Account {
    var raw: JSONObject = [
        "id": "acc-1", "name": "Vadesiz", "type": "checking", "currency": "TRY", "balance": 1000,
        "initialBalance": 1000, "color": "#1A5CA3", "isArchived": false, "createdAt": "2026-01-01T00:00:00.000Z",
    ]
    for (k, v) in o { raw[k] = v }
    return Account(raw: raw)
}

private func fcRec(_ o: JSONObject = [:]) -> RecurringTransaction {
    let id = UUID().uuidString
    var raw: JSONObject = [
        "id": .string("r-\(id)"), "name": .string("Şablon \(id.prefix(4))"), "type": "expense", "amount": 100,
        "currency": "TRY", "accountId": "acc-1", "description": "", "frequency": "monthly",
        "startDate": "2026-01-01", "nextDueDate": "2026-02-01", "isActive": true,
        "createdAt": "2026-01-01T00:00:00.000Z",
    ]
    for (k, v) in o { raw[k] = v }
    return RecurringTransaction(raw: raw)
}

private func fcDebt(_ o: JSONObject = [:]) -> Debt {
    let id = UUID().uuidString
    var raw: JSONObject = [
        "id": .string("d-\(id)"), "name": .string("Borç \(id.prefix(4))"), "type": "bank_loan", "direction": "owe",
        "totalAmount": 12000, "paidAmount": 0, "startDate": "2026-01-01", "monthlyPayment": 1000,
        "totalInstallments": 12, "accountId": "acc-1", "isSettled": false, "createdAt": "2026-01-01T00:00:00.000Z",
    ]
    for (k, v) in o { raw[k] = v }
    return Debt(raw: raw)
}

private func fcTx(_ o: JSONObject) -> Transaction {
    var raw: JSONObject = ["id": .string("t-\(UUID().uuidString)"), "accountId": "acc-1", "date": .string(TODAY)]
    for (k, v) in o { raw[k] = v }
    return tx(raw)
}

/// Web buildForecast çağrısı: hesap bakiyeleri ham satırdaki "balance"tan.
private func forecast(accounts: [Account], recurring: [RecurringTransaction] = [], transactions: [Transaction] = [],
                      debts: [Debt] = [], investmentsTry: Double = 0, fundsTry: Double = 0,
                      horizonMonths: Int, mode: ForecastMode = .total) -> ForecastResult {
    var balances: [String: Double] = [:]
    for a in accounts { balances[a.id] = a.raw.num("balance") ?? 0 }
    return Forecast.build(accounts: accounts, balances: balances, recurring: recurring, transactions: transactions,
                          debts: debts, fx: fcFX, investmentsTry: investmentsTry, fundsTry: fundsTry,
                          horizonMonths: horizonMonths, today: TODAY, mode: mode)
}

private func pt(_ date: String, _ balance: Double) -> ForecastPoint { ForecastPoint(date: date, balance: balance) }

/// Web `toEqual` ile kıyaslanan olay alanları (kaynak iOS'a özgü, ayrıca sınanır).
private struct Row: Equatable {
    var date: String, name: String, type: ForecastFlow, amountTry: Double, balanceAfter: Double
}
private func rows(_ f: ForecastResult) -> [Row] {
    f.events.map { Row(date: $0.date, name: $0.name, type: $0.type, amountTry: $0.amountTry, balanceAfter: $0.balanceAfter) }
}

@Suite("bakiye tahmini — saf nakit akışı projeksiyonu")
struct ForecastTests {
    @Test func tekrarlayanYoksaDuzCizgi() {
        let f = forecast(accounts: [fcAccount(["balance": 5000])], horizonMonths: 6)
        #expect(f.points == [pt(TODAY, 5000)])
        #expect(f.start == 5000)
        #expect(f.horizonEnd == "2026-07-01")
        #expect(f.shortfallDate == nil)
        #expect(f.totalIncome == 0)
        #expect(f.totalExpense == 0)
        #expect(f.net == 0)
        #expect(f.drivers.isEmpty)
    }

    @Test func yatirimBaslangicaEklenirVeTasinir() {
        let f = forecast(accounts: [fcAccount(["balance": 1000])],
                         recurring: [fcRec(["amount": 1500, "nextDueDate": "2026-02-01"])],
                         investmentsTry: 2000, horizonMonths: 1)
        #expect(f.points.first == pt(TODAY, 3000))
        #expect(f.points.last?.balance == 1500)   // 3000 − 1500
        #expect(f.shortfallDate == nil)            // yatırım gideri karşılar
    }

    @Test func bakiyedenBuyukAylikGiderIlkDonemdeAcik() {
        let f = forecast(accounts: [fcAccount(["balance": 1000])],
                         recurring: [fcRec(["amount": 1500, "nextDueDate": "2026-02-01"])], horizonMonths: 3)
        // Dönemler 02-01, 03-01, 04-01 (horizonEnd = 2026-04-01, dahil).
        #expect(f.points.count == 4)   // başlangıç + 3
        #expect(f.shortfallDate == "2026-02-01")
        #expect(f.points[1] == pt("2026-02-01", -500))
        #expect(f.points[3].balance == -3500)
        #expect(f.totalExpense == 4500)
    }

    @Test func gelirVeGiderUfuktaNetlesir() {
        let f = forecast(accounts: [fcAccount(["balance": 0])], recurring: [
            fcRec(["type": "income", "amount": 5000, "nextDueDate": "2026-02-01"]),
            fcRec(["type": "expense", "amount": 1500, "nextDueDate": "2026-02-01"]),
        ], horizonMonths: 3)
        #expect(f.totalIncome == 15000)   // 5000 × 3
        #expect(f.totalExpense == 4500)   // 1500 × 3
        #expect(f.net == 10500)
        // Aynı günün olayları tek noktaya katlanır: başlangıç + 3 gün.
        #expect(f.points.count == 4)
        #expect(f.points.last?.balance == 10500)
        #expect(f.shortfallDate == nil)
    }

    @Test func dovizCanliKurlaTRYye() {
        let f = forecast(accounts: [fcAccount(["balance": 0])],
                         recurring: [fcRec(["type": "income", "currency": "USD", "amount": 100, "nextDueDate": "2026-02-01"])],
                         horizonMonths: 1)   // horizonEnd 2026-02-01 → tam bir dönem
        #expect(f.totalIncome == 3000)   // 100 USD × 30
        #expect(f.points.last?.balance == 3000)
        #expect(f.drivers[0].monthlyTry == 3000)   // aylık × 1
    }

    @Test func transferlerHaric() {
        let f = forecast(accounts: [fcAccount(["balance": 1000])],
                         recurring: [fcRec(["type": "transfer", "amount": 900, "toAccountId": "acc-2", "nextDueDate": "2026-02-01"])],
                         horizonMonths: 3)
        #expect(f.points == [pt(TODAY, 1000)])
        #expect(f.drivers.isEmpty)   // transferler asla sürücü olmaz
    }

    @Test func gelecekTarihliTekSeferlikIslemlerTarihindeGirer() {
        let f = forecast(accounts: [fcAccount(["balance": 1000])], transactions: [
            fcTx(["type": "expense", "amount": 300, "date": "2026-02-10"]),                            // gelecek → dahil
            fcTx(["type": "income", "amount": 500, "date": "2026-03-05"]),                             // gelecek → dahil
            fcTx(["type": "expense", "amount": 999, "date": "2025-12-20"]),                            // geçmiş → bakiyede zaten var
            fcTx(["type": "expense", "amount": 111, "date": "2026-09-01"]),                            // ufuk dışı
            fcTx(["type": "transfer", "amount": 400, "date": "2026-02-15", "toAccountId": "acc-2"]),   // transfer → net sıfır
            fcTx(["type": "expense", "amount": 50, "date": "2026-02-20", "systemKind": "reconciliation"]), // hayalet
        ], horizonMonths: 6)
        #expect(f.points == [pt(TODAY, 1000), pt("2026-02-10", 700), pt("2026-03-05", 1200)])
        #expect(f.totalIncome == 500)
        #expect(f.totalExpense == 300)
    }

    @Test func olaylarTarihSirasindaYuruyenBakiyeyle() {
        let kira = fcRec(["name": "Kira", "type": "expense", "amount": 700, "nextDueDate": "2026-02-01"])
        let prim = fcTx(["id": "t-prim", "type": "income", "amount": 500, "date": "2026-02-15", "description": "Prim"])
        let f = forecast(accounts: [fcAccount(["balance": 1000])], recurring: [kira], transactions: [prim], horizonMonths: 2)
        #expect(rows(f) == [
            Row(date: "2026-02-01", name: "Kira", type: .expense, amountTry: 700, balanceAfter: 300),
            Row(date: "2026-02-15", name: "Prim", type: .income, amountTry: 500, balanceAfter: 800),
            Row(date: "2026-03-01", name: "Kira", type: .expense, amountTry: 700, balanceAfter: 100),
        ])
        // Her günün son olayı o günün grafik noktasıyla aynı.
        #expect(f.points.last?.balance == 100)
        // iOS'a özgü: kaynak türü ve kimliği
        #expect(f.events.map(\.source) == [.recurring, .transaction, .recurring])
        #expect(f.events.map(\.sourceId) == [kira.id, "t-prim", kira.id])
        #expect(f.events.map(\.delta) == [-700, 500, -700])
    }

    @Test func frekanslarAylikEsdegerAzalanSirada() {
        let f = forecast(accounts: [fcAccount()], recurring: [
            fcRec(["name": "Maaş", "type": "income", "amount": 40000, "frequency": "monthly"]),
            fcRec(["name": "Kahve", "type": "expense", "amount": 50, "frequency": "daily"]),
            fcRec(["name": "Sigorta", "type": "expense", "amount": 12000, "frequency": "yearly"]),
        ], horizonMonths: 6)
        #expect(f.drivers.map(\.name) == ["Maaş", "Kahve", "Sigorta"])
        #expect(f.drivers[0].monthlyTry == 40000)     // aylık × 1
        #expect(f.drivers[1].monthlyTry == 1521.88)   // 50 × 30.4375
        #expect(f.drivers[2].monthlyTry == 1000)      // 12000 ÷ 12
    }

    @Test func ayEklemeAySonunaKirpar() {
        #expect(Forecast.addMonthsIso("2026-01-31", 1) == "2026-02-28")
        #expect(Forecast.addMonthsIso("2028-01-31", 1) == "2028-02-29")
        #expect(Forecast.addMonthsIso("2026-11-15", 3) == "2027-02-15")
        #expect(Forecast.addMonthsIso("2026-03-31", -1) == "2026-02-28")
        #expect(Forecast.addMonthsIso("2026-01-10", -13) == "2024-12-10")
    }
}

@Suite("bakiye tahmini — nakit modu (likidite görünümü)")
struct ForecastCashModeTests {
    let checking = fcAccount(["id": "acc-1", "type": "checking", "balance": 5000])
    let card = fcAccount(["id": "cc-1", "type": "credit_card", "balance": -3000, "name": "Kart"])

    func ccPayment() -> RecurringTransaction {
        fcRec(["name": "Kart Ödemesi", "type": "transfer", "amount": 3000, "accountId": "acc-1",
               "toAccountId": "cc-1", "nextDueDate": "2026-02-01"])
    }

    @Test func kartOdemesiToplamdaGorunmezNakitteCikis() {
        let p = ccPayment()
        let total = forecast(accounts: [checking, card], recurring: [p], horizonMonths: 1)
        #expect(total.points == [pt(TODAY, 2000)])   // 5000 − 3000 borç, transfer net sıfır
        #expect(total.events.isEmpty)

        let cash = forecast(accounts: [checking, card], recurring: [p], horizonMonths: 1, mode: .cash)
        #expect(cash.points == [
            pt(TODAY, 5000),          // kart borcu başlangıca dahil değil
            pt("2026-02-01", 2000),   // ödeme günü nakit düşer
        ])
        #expect(rows(cash) == [
            Row(date: "2026-02-01", name: "Kart Ödemesi", type: .expense, amountTry: 3000, balanceAfter: 2000),
        ])
        #expect(cash.drivers == [ForecastDriver(id: p.id, name: "Kart Ödemesi", type: .expense, monthlyTry: 3000)])
    }

    @Test func kartaYazilanGiderToplamiOynatirNakdiDegil() {
        let exp = fcRec(["name": "Market", "type": "expense", "amount": 400, "accountId": "cc-1", "nextDueDate": "2026-02-01"])
        #expect(forecast(accounts: [checking, card], recurring: [exp], horizonMonths: 1).points.last?.balance == 1600)   // 2000 − 400
        #expect(forecast(accounts: [checking, card], recurring: [exp], horizonMonths: 1, mode: .cash).points == [pt(TODAY, 5000)])
    }

    @Test func likittenLikideTransferVeYatirimNakitteYokTEFASVar() {
        let savings = fcAccount(["id": "sv-1", "type": "savings", "balance": 1000])
        let move = fcRec(["type": "transfer", "amount": 500, "accountId": "acc-1", "toAccountId": "sv-1", "nextDueDate": "2026-02-01"])
        let f = forecast(accounts: [checking, savings], recurring: [move],
                         investmentsTry: 9999, fundsTry: 2500, horizonMonths: 3, mode: .cash)
        #expect(f.points == [pt(TODAY, 8500)])   // 5000 + 1000 + 2500 TEFAS; altın/döviz (9999) hariç
        #expect(f.drivers.isEmpty)
    }

    @Test func toplamModTumPortfoyuTutarFonlariYokSayar() {
        let f = forecast(accounts: [checking], investmentsTry: 9999, fundsTry: 2500, horizonMonths: 1)
        #expect(f.points == [pt(TODAY, 14999)])   // 5000 + 9999 (fundsTry zaten içinde)
    }

    @Test func gelecekTekSeferlikKartOdemesiNakitProjeksiyonunaGirer() {
        let oneOff = tx(["id": "t-cc", "type": "transfer", "amount": 1500, "currency": "TRY", "date": "2026-02-10",
                         "accountId": "acc-1", "toAccountId": "cc-1", "description": "Şubat ekstresi"])
        let f = forecast(accounts: [checking, card], transactions: [oneOff], horizonMonths: 2, mode: .cash)
        #expect(rows(f) == [
            Row(date: "2026-02-10", name: "Şubat ekstresi", type: .expense, amountTry: 1500, balanceAfter: 3500),
        ])
    }
}

@Suite("bakiye tahmini — takip edilen borç taksitleri")
struct ForecastDebtTests {
    @Test func gelecekOdenmemisTaksitlerGider() {
        let f = forecast(accounts: [fcAccount(["balance": 5000])],
                         debts: [fcDebt(["id": "kredi", "name": "Araba Kredisi"])],   // 1000/ay, startDate=today, vade yok
                         horizonMonths: 3)
        // horizonEnd = 2026-04-01 → üç taksit projekte edilir.
        #expect(f.points == [pt(TODAY, 5000), pt("2026-02-01", 4000), pt("2026-03-01", 3000), pt("2026-04-01", 2000)])
        #expect(f.totalExpense == 3000)
        #expect(f.net == -3000)
        #expect(f.drivers == [ForecastDriver(id: "debt-kredi", name: "Araba Kredisi", type: .expense, monthlyTry: 1000)])
        #expect(f.events.allSatisfy { $0.source == .debt && $0.sourceId == "kredi" })
    }

    @Test func kismiOdenmisTaksitYalnizKalaniyla() {
        let f = forecast(accounts: [fcAccount(["balance": 5000])],
                         debts: [fcDebt(["name": "Kredi", "paidAmount": 1500])],   // ilk taksit tam, ikincinin 500'ü ödenmiş
                         horizonMonths: 3)
        // İlk taksit başlangıç gününde (= today) düşer, projeksiyona girmez.
        #expect(rows(f) == [
            Row(date: "2026-02-01", name: "Kredi", type: .expense, amountTry: 500, balanceAfter: 4500),
            Row(date: "2026-03-01", name: "Kredi", type: .expense, amountTry: 1000, balanceAfter: 3500),
            Row(date: "2026-04-01", name: "Kredi", type: .expense, amountTry: 1000, balanceAfter: 2500),
        ])
        #expect(f.totalExpense == 2500)
    }

    @Test func alacaklarGelenParaOlarak() {
        let f = forecast(accounts: [fcAccount(["balance": 0])], debts: [fcDebt(["direction": "owed"])], horizonMonths: 2)
        #expect(f.totalIncome == 2000)   // 02-01, 03-01
        #expect(f.totalExpense == 0)
        #expect(f.points.last?.balance == 2000)
        #expect(f.drivers[0].type == .income)
    }

    @Test func kapanmisVeAylikTutarsizBorclarUretmez() {
        let f = forecast(accounts: [fcAccount(["balance": 5000])], debts: [
            fcDebt(["id": "d-settled", "isSettled": true]),
            fcDebt(["id": "d-nomonthly", "monthlyPayment": nil]),
        ], horizonMonths: 6)
        #expect(f.points == [pt(TODAY, 5000)])
        #expect(f.drivers.isEmpty)
    }

    @Test func takvimBaslangictanIleriVadePlaniKaydirmaz() {
        let base: JSONObject = ["totalAmount": 3000, "monthlyPayment": 1000, "totalInstallments": 3]
        // startDate = 2026-01-01 → taksitler 01-01, 02-01, 03-01 (ilki today'de,
        // projeksiyona girmez). Vade girili olsun ya da olmasın sonuç aynı.
        let expected = [Forecast.DebtPayment(date: "2026-02-01", amount: 1000),
                        Forecast.DebtPayment(date: "2026-03-01", amount: 1000)]
        #expect(Forecast.futureDebtPayments(fcDebt(base), after: TODAY, until: "2026-06-01") == expected)
        var withDue = base
        withDue["dueDate"] = "2026-12-31"
        #expect(Forecast.futureDebtPayments(fcDebt(withDue), after: TODAY, until: "2026-06-01") == expected)
    }

    @Test func nakitModuLikitOlmayanHesaptanOdemeNakdiEritmez() {
        let invest = fcAccount(["id": "inv-1", "type": "investment", "balance": 0])
        let f = forecast(accounts: [fcAccount(["id": "acc-1", "type": "checking", "balance": 5000]), invest],
                         debts: [fcDebt(["accountId": "inv-1"])],   // yatırım hesabından ödeniyor → nakiti etkilemez
                         horizonMonths: 3, mode: .cash)
        #expect(f.points == [pt(TODAY, 5000)])
        #expect(f.totalExpense == 0)
    }
}
