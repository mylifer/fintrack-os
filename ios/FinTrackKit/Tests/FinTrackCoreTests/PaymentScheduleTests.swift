import Foundation
import Testing
@testable import FinTrackCore

/* ────────────────────────────────────────────────────────────────────────
   Ödeme takibi çizelgesi — web src/lib/payments/schedule.test.ts,
   description.test.ts ve card-payments.test.ts'in buildSchedule'a bağlı iki
   vakasıyla AYNI girdiler ve beklenen sonuçlar. Biri değişirse diğeri de
   değişmeli.

   Kritik değişmezler: (1) kartta kullanıcının vermediği gün/tutar VARSAYILMAZ —
   ödeme günü girilmemiş kart satır üretmez, tutarı girilmemiş ay "tutar yok"
   olur; (2) ödeme penceresine düşen işlem o ayı ödendi sayar ama başka ayı
   saymaz; (3) takip başlangıcından önce yanlış "gecikti" alarmı çıkmaz;
   (4) borç kalan tutarı tükenince aylar biter.
──────────────────────────────────────────────────────────────────────── */

private let TODAY = "2026-10-05"
private typealias PS = PaymentSchedule

private func merged(_ base: JSONObject, _ o: JSONObject) -> JSONObject {
    var raw = base
    for (k, v) in o { raw[k] = v }
    return raw
}

private func card(_ o: JSONObject = [:]) -> Account {
    Account(raw: merged([
        "id": "card1", "name": "Bonus", "type": "credit_card", "currency": "TRY", "balance": -12_000,
        "initialBalance": 0, "color": "#10b981", "isArchived": false, "createdAt": "2026-01-01T00:00:00.000Z",
        "creditLimit": 50_000, "statementDay": 28, "dueDay": 10,
    ], o))
}

private func debt(_ o: JSONObject = [:]) -> Debt {
    Debt(raw: merged([
        "id": "debt1", "name": "Araba Kredisi", "type": "bank_loan", "direction": "owe", "totalAmount": 30_000,
        "paidAmount": 0, "startDate": "2026-09-15", "monthlyPayment": 5_000, "totalInstallments": 6,
        "accountId": "chk", "isSettled": false, "createdAt": "2026-09-01T00:00:00.000Z",
    ], o))
}

/// Web testindeki tx: gider, TRY, 'chk' hesabı, açıklama 'x'.
private func ptx(_ id: String, _ date: String, _ amount: Double, _ o: JSONObject = [:]) -> Transaction {
    tx(merged([
        "id": .string(id), "date": .string(date), "amount": .number(amount), "accountId": "chk",
        "description": "x", "createdAt": "2026-01-01", "updatedAt": "2026-01-01",
    ], o))
}

private func cardPayment(_ id: String, _ date: String, _ amount: Double) -> Transaction {
    ptx(id, date, amount, ["type": "transfer", "accountId": "chk", "toAccountId": "card1"])
}

private func occ(_ kind: PaymentTargetKind, _ targetId: String, _ month: String, _ o: JSONObject = [:]) -> PaymentOccurrence {
    PaymentOccurrence(raw: merged([
        "id": .string(PS.occurrenceIdFor(kind, targetId, month)), "targetKind": .string(kind.rawValue),
        "targetId": .string(targetId), "month": .string(month), "createdAt": "2026-10-01", "updatedAt": "2026-10-01",
    ], o))
}

private func plan(_ kind: PaymentTargetKind, _ targetId: String, _ o: JSONObject = [:]) -> PaymentPlan {
    PaymentPlan(raw: merged([
        "id": .string(PS.planIdFor(kind, targetId)), "targetKind": .string(kind.rawValue),
        "targetId": .string(targetId), "isActive": true, "createdAt": "2026-10-01", "updatedAt": "2026-10-01",
    ], o))
}

/// Ödeme günü 10 olarak kurulmuş kart planı (kartın varsayılan kurulumu).
private func cardPlan(_ o: JSONObject = [:]) -> PaymentPlan {
    plan(.card, "card1", merged(["dayOfMonth": 10], o))
}

/// Web fikstüründe bakiye hesapta durur; burada ham satırdaki "balance" haritaya çıkarılır.
private func balances(_ accounts: [Account]) -> [String: Double] {
    var out: [String: Double] = [:]
    for a in accounts { if let b = a.raw.num("balance") { out[a.id] = b } }
    return out
}

private func targets(_ accounts: [Account] = [], _ debts: [Debt] = [], _ plans: [PaymentPlan] = []) -> [PaymentTarget] {
    PS.buildTargets(accounts: accounts, debts: debts, plans: plans, balances: balances(accounts))
}

private func schedule(accounts: [Account] = [], debts: [Debt] = [], plans: [PaymentPlan] = [],
                      transactions: [Transaction] = [], occurrences: [PaymentOccurrence] = [],
                      from: String, to: String? = nil) -> [PaymentRow] {
    PS.buildSchedule(targets: targets(accounts, debts, plans), occurrences: occurrences,
                     transactions: transactions, from: from, to: to ?? from, today: TODAY, fx: fx)
}

private struct MonthState: Equatable { let month: String; let state: PaymentState }
private func ms(_ rows: [PaymentRow]) -> [MonthState] { rows.map { MonthState(month: $0.month, state: $0.state) } }

// MARK: - schedule.test.ts

@Suite("ödeme takibi — ay yardımcıları")
struct PaymentMonthHelperTests {
    @Test func yilSinirindaAyKaydirir() {
        #expect(PS.shiftMonth("2026-12", 1) == "2027-01")
        #expect(PS.shiftMonth("2026-01", -1) == "2025-12")
        #expect(PS.shiftMonth("2026-10", -13) == "2025-09")
    }

    @Test func ayAraliginiIkiUcDahilUretir() {
        #expect(PS.monthKeys("2026-11", "2027-02") == ["2026-11", "2026-12", "2027-01", "2027-02"])
        #expect(PS.monthKeys("2026-11", "2026-10") == [])
    }

    @Test func vadeGunuKisaAylardaAySonunaSikistirilir() {
        #expect(PS.dueDateFor("2026-02", 31) == "2026-02-28")
        #expect(PS.dueDateFor("2028-02", 30) == "2028-02-29")
        #expect(PS.dueDateFor("2026-09", 31) == "2026-09-30")
        #expect(PS.dueDateFor("2026-10", 5) == "2026-10-05")
    }
}

@Suite("ödeme takibi — buildTargets")
struct PaymentTargetsTests {
    @Test func yalnizArsivlenmemisKartlarVeOdenecekBorclar() {
        let t = targets(
            [card(), card(["id": "old", "isArchived": true]), card(["id": "chk", "type": "checking"])],
            [debt(), debt(["id": "lent", "direction": "owed"])]
        )
        #expect(t.map(\.key) == ["card:card1", "debt:debt1"])
    }

    @Test func kartta_dueDayKullanilmaz_planGunuYoksaKurulumBekler() {
        let t = targets([card(["dueDay": 10])])[0]
        #expect(t.dayOfMonth == nil)
        #expect(t.needsSetup)
        #expect(t.defaultAmount == nil)
        #expect(t.outstanding == 12_000)
        #expect(t.startMonth == "2026-09")   // TRACKING_EPOCH, kart daha eski
    }

    @Test func borctaAlanlarBorctanTuretilir() {
        let t = targets([], [debt()])[0]
        #expect(t.defaultAmount == 5_000)
        #expect(t.defaultAmountSource == .derived)
        #expect(t.defaultFromAccountId == "chk")
        #expect(t.dayOfMonth == 15)
        #expect(!t.needsSetup)
        #expect(t.endMonth == "2027-02")
    }

    @Test func planVarsayilanlariUygulanir() {
        let t = targets([card()], [], [
            cardPlan(["amount": 7_500, "dayOfMonth": 3, "fromAccountId": "sav", "startMonth": "2026-06", "isActive": false]),
        ])[0]
        #expect(t.defaultAmount == 7_500)
        #expect(t.defaultAmountSource == .plan)
        #expect(t.dayOfMonth == 3)
        #expect(!t.needsSetup)
        #expect(t.defaultFromAccountId == "sav")
        #expect(t.startMonth == "2026-06")
        #expect(!t.isActive)
    }
}

@Suite("ödeme takibi — uygulamadaki kart harcamaları (kısayol)")
struct PaymentStatementShortcutTests {
    @Test func vadedenOncekiSonKesimdeKapananDonem() {
        #expect(PS.statementWindow(statementDay: 28, dueDate: "2026-10-10") == StatementPeriod(from: "2026-08-29", to: "2026-09-28"))
        #expect(PS.statementWindow(statementDay: 5, dueDate: "2026-10-10") == StatementPeriod(from: "2026-09-06", to: "2026-10-05"))
        #expect(PS.statementWindow(statementDay: 31, dueDate: "2026-10-10") == StatementPeriod(from: "2026-09-01", to: "2026-09-30"))
        #expect(PS.statementWindow(statementDay: nil, dueDate: "2026-10-10") == StatementPeriod(from: "2026-09-01", to: "2026-09-30"))
    }

    @Test func donemHarcamasiniToplar_odemeVeDonemDisiSayilmaz() {
        let txs = [
            ptx("a", "2026-09-02", 1_000, ["accountId": "card1"]),
            ptx("b", "2026-09-20", 200, ["accountId": "card1", "type": "income"]),
            ptx("c", "2026-09-10", 5_000, ["accountId": "chk", "type": "transfer", "toAccountId": "card1"]),
            ptx("d", "2026-09-29", 900, ["accountId": "card1"]),
            ptx("e", "2026-09-15", 300, ["accountId": "card1", "systemKind": "reconciliation"]),
        ]
        #expect(PS.estimateStatement(account: card(), dueDate: "2026-10-10", transactions: txs, fx: fx) == 800)
    }
}

@Suite("ödeme takibi — buildSchedule kart")
struct PaymentScheduleCardTests {
    let charge = ptx("ch", "2026-09-05", 3_000, ["accountId": "card1"])

    @Test func odemeGunuGirilmemisKartSatirUretmez() {
        #expect(schedule(accounts: [card()], transactions: [charge], from: "2026-09", to: "2026-12").isEmpty)
    }

    @Test func gunuGirilmisTutariGirilmemisKart_tutarYok_tahminYapmaz() {
        let row = schedule(accounts: [card()], plans: [cardPlan()], transactions: [charge], from: "2026-10")[0]
        // Son ödeme günü 10; 10 Ekim 2026 Cumartesi → bankalar gibi ilk iş günü 12 Ekim
        #expect(row.dueDate == "2026-10-12")
        #expect(row.amount == nil)
        #expect(row.amountSource == nil)
        #expect(row.state == .open)
        #expect(row.timing == .soon)
        #expect(row.daysLeft == 7)
        #expect(row.remaining == 0)
        #expect(row.occurrence == nil)
    }

    @Test func pencereyeDusenKartaTransferOdendiSayilir() {
        let row = schedule(accounts: [card()], plans: [cardPlan()],
                           transactions: [charge, cardPayment("p1", "2026-10-03", 3_000)], from: "2026-10")[0]
        #expect(row.state == .paid)
        #expect(row.paidVia == .detected)
        #expect(row.transactionIds == ["p1"])
        #expect(row.timing == .done)
    }

    @Test func eksikOdemeKismi_kalanHesaplanir() {
        let row = schedule(accounts: [card()], plans: [cardPlan(["amount": 3_000])],
                           transactions: [cardPayment("p1", "2026-10-01", 1_000)], from: "2026-10")[0]
        #expect(row.state == .partial)
        #expect(row.remaining == 2_000)
    }

    @Test func odemeYalnizKendiPenceresindekiAyaYazilir() {
        // Eylül penceresi (17 Ağu, 17 Eyl]; 16 Eylül'deki ödeme Ekim'i ödemez.
        let rows = schedule(accounts: [card()], plans: [cardPlan(["amount": 2_000])],
                            transactions: [cardPayment("p1", "2026-09-16", 2_000)], from: "2026-09", to: "2026-10")
        #expect(ms(rows) == [MonthState(month: "2026-09", state: .paid), MonthState(month: "2026-10", state: .open)])
    }

    @Test func onayBekleyenIleriTarihliTransferOdemeSayilmaz() {
        let pending = ptx("p1", "2026-10-08", 3_000,
                          ["type": "transfer", "toAccountId": "card1", "approvalStatus": "pending"])
        let row = schedule(accounts: [card()], plans: [cardPlan(["amount": 3_000])], transactions: [pending], from: "2026-10")[0]
        #expect(row.state == .open)
    }

    @Test func elleBaglanmisIslemBaskaAydaTespitEdilmez() {
        let rows = schedule(
            accounts: [card()], plans: [cardPlan(["amount": 2_000])],
            transactions: [cardPayment("p1", "2026-11-12", 2_000)],
            occurrences: [occ(.card, "card1", "2026-10", ["status": "paid", "paidAmount": 2_000, "transactionId": "p1"])],
            from: "2026-10", to: "2026-11"
        )
        #expect(rows.first { $0.month == "2026-10" }?.paidVia == .manual)
        #expect(rows.first { $0.month == "2026-11" }?.state == .open)
    }

    @Test func ayKaydiTutarTarihVeHesabiEzer() {
        let row = schedule(
            accounts: [card()], plans: [cardPlan()],
            occurrences: [occ(.card, "card1", "2026-10", ["amount": 4_500, "dueDate": "2026-10-20", "fromAccountId": "sav"])],
            from: "2026-10"
        )[0]
        #expect(row.amount == 4_500)
        #expect(row.amountSource == .custom)
        #expect(row.dueDate == "2026-10-20")
        #expect(row.fromAccountId == "sav")
        #expect(row.custom == PaymentRowCustom(amount: true, dueDate: true, fromAccount: true))
        #expect(row.remaining == 4_500)
        #expect(row.timing == .later)
    }

    @Test func atlananAyKalanVeGecikmeUretmez() {
        let row = schedule(accounts: [card()], plans: [cardPlan(["amount": 3_000])],
                           occurrences: [occ(.card, "card1", "2026-10", ["status": "skipped"])], from: "2026-10")[0]
        #expect(row.state == .skipped)
        #expect(row.remaining == 0)
        #expect(row.timing == .done)
    }

    @Test func gecmisVadeliOdenmemisAyGecikmis() {
        let row = schedule(accounts: [card()], plans: [cardPlan(["amount": 1_500])], from: "2026-09")[0]
        #expect(row.dueDate == "2026-09-10")
        #expect(row.timing == .overdue)
        #expect(row.daysLeft == -25)
    }

    @Test func takipBaslangicindanOnceAcikSatirYok_odenmisGecmisOlarakGorunur() {
        let p = cardPlan(["amount": 1_000])
        #expect(schedule(accounts: [card()], plans: [p], from: "2026-07").isEmpty)
        let row = schedule(accounts: [card()], plans: [p], transactions: [cardPayment("old", "2026-07-09", 1_000)], from: "2026-07")[0]
        #expect(row.state == .paid)
        #expect(row.outOfRange)
    }

    @Test func sifirGirilenAyBorcYokSatiri() {
        let row = schedule(accounts: [card()], plans: [cardPlan()],
                           occurrences: [occ(.card, "card1", "2026-10", ["amount": 0])], from: "2026-10")[0]
        #expect(row.amount == 0)
        #expect(row.state == .clear)
        #expect(row.timing == .done)
    }

    @Test func takiptenCikarilmisHedefSatirUretmez() {
        #expect(schedule(accounts: [card()], plans: [cardPlan(["isActive": false])], from: "2026-10").isEmpty)
    }
}

@Suite("ödeme takibi — buildSchedule borç")
struct PaymentScheduleDebtTests {
    @Test func kalanTukeninceAylarBiter_sonAyKuculur() {
        let rows = schedule(debts: [debt(["paidAmount": 18_000])], from: "2026-09", to: "2027-02")
        #expect(rows.map(\.month) == ["2026-09", "2026-10", "2026-11"])
        #expect(rows.map(\.amount) == [5_000, 5_000, 2_000])
    }

    @Test func debtIdliIslemOAyinOdemesi() {
        let rows = schedule(
            debts: [debt(["paidAmount": 5_000])],
            transactions: [ptx("dp", "2026-09-14", 5_000, ["type": "transfer", "debtId": "debt1"])],
            from: "2026-09", to: "2026-10"
        )
        #expect(ms(rows) == [MonthState(month: "2026-09", state: .paid), MonthState(month: "2026-10", state: .open)])
        #expect(rows[1].amount == 5_000)
    }

    @Test func kapanmisBorcAcikSatirUretmez() {
        #expect(schedule(debts: [debt(["paidAmount": 30_000, "isSettled": true])], from: "2026-10", to: "2026-12").isEmpty)
    }

    @Test func taksitSayisiBitinceSatirYok() {
        let rows = schedule(debts: [debt(["totalInstallments": 2, "totalAmount": 100_000])], from: "2026-09", to: "2026-12")
        #expect(rows.map(\.month) == ["2026-09", "2026-10"])
    }

    @Test func aylikTutariOlmayanBorcTutarYokSatiri() {
        let row = schedule(debts: [debt(["monthlyPayment": nil, "totalInstallments": nil])], from: "2026-10")[0]
        #expect(row.amount == nil)
        #expect(row.state == .open)
    }
}

@Suite("ödeme takibi — summarizeRows")
struct PaymentSummaryTests {
    @Test func odenenKalanGecikmisVeSiradaki_tutarsizAyriSayilir() {
        let rows = schedule(
            accounts: [card(), card(["id": "card2", "name": "Axess"]), card(["id": "card3", "name": "World"])],
            debts: [debt()],
            plans: [
                plan(.card, "card1", ["amount": 2_000, "dayOfMonth": 1]),
                plan(.card, "card2", ["amount": 1_000, "dayOfMonth": 20]),
                plan(.card, "card3", ["dayOfMonth": 25]),
            ],
            transactions: [ptx("dp", "2026-10-02", 5_000, ["type": "transfer", "debtId": "debt1"])],
            from: "2026-10"
        )
        let s = PS.summarizeRows(rows, fx: fx)
        #expect(s.count == 4)
        #expect(s.totalTry == 8_000)
        #expect(s.paidTry == 5_000)
        #expect(s.remainingTry == 3_000)
        #expect(s.overdueCount == 1)     // card1 — 1 Ekim
        #expect(s.overdueTry == 2_000)
        #expect(s.unknownCount == 1)     // card3 — tutar girilmedi
        #expect(s.next?.target.id == "card2")
    }
}

// MARK: - description.test.ts

@Suite("ödeme takibi — paymentDescription")
struct PaymentDescriptionTests {
    @Test func karttaKartAdindanBagimsiz() {
        #expect(PS.paymentDescription(kind: .card, name: "Garanti Bonus") == "Kredi Kartı Ödemesi")
    }

    @Test func borctaAdOdemesi() {
        #expect(PS.paymentDescription(kind: .debt, name: "İhtiyaç Kredisi") == "İhtiyaç Kredisi Ödemesi")
        #expect(PS.paymentDescription(kind: .debt, name: "  Araba Kredisi ") == "Araba Kredisi Ödemesi")
    }

    @Test func adZatenOdemesiIleBitiyorsaTekrarEklenmez() {
        #expect(PS.paymentDescription(kind: .debt, name: "Konut Kredisi Ödemesi") == "Konut Kredisi Ödemesi")
        #expect(PS.paymentDescription(kind: .debt, name: "Okul ödemesi") == "Okul ödemesi")
    }
}

@Suite("ödeme takibi — paymentTxIdFor")
struct PaymentTxIdTests {
    @Test func ayniHedefVeAyIcinAyniFarkliAyIcinFarkli() {
        let a = PS.paymentTxIdFor(.card, "c1", "2026-09")
        #expect(PS.paymentTxIdFor(.card, "c1", "2026-09") == a)
        #expect(PS.paymentTxIdFor(.card, "c1", "2026-10") != a)
        #expect(PS.paymentTxIdFor(.debt, "c1", "2026-09") != a)
    }

    /// Web deterministicUuid ile hesaplanmış referans kimlikler.
    @Test func webIleAyniKimlikler() {
        #expect(PS.planIdFor(.card, "card1") == "56d4e0bc-65f4-4b8b-af88-210baa909ff9")
        #expect(PS.occurrenceIdFor(.card, "card1", "2026-10") == "5e4934d7-bd95-4ed4-8f88-da7132ce88ee")
        #expect(PS.occurrenceIdFor(.debt, "debt1", "2026-09") == "c057fdc2-db5d-41cc-91a1-defc4712dbd9")
        #expect(PS.paymentTxIdFor(.card, "c1", "2026-09") == "4e69d7fe-590e-4acd-a667-7dd223e21410")
    }
}

// MARK: - card-payments.test.ts — buildSchedule vakaları

private let CP_TODAY = "2026-09-11"

private func acc(_ id: String, _ name: String, _ type: String, _ o: JSONObject = [:]) -> Account {
    Account(raw: merged([
        "id": .string(id), "name": .string(name), "type": .string(type), "currency": "TRY", "balance": 0,
        "initialBalance": 0, "color": "#000", "isArchived": false, "createdAt": "2026-01-01T00:00:00.000Z",
    ], o))
}

private let chk = acc("chk", "Vadesiz Hesap", "checking")
private let bonus = acc("bonus", "Garanti Bonus", "credit_card")
private let axess = acc("axess", "Akbank Axess", "credit_card")

@Suite("ödeme takibi — geçmiş kart ödemeleri")
struct PaymentScheduleHistoryTests {
    let bonusPlan = PaymentPlan(raw: [
        "id": .string(PS.planIdFor(.card, "bonus")), "targetKind": "card", "targetId": "bonus", "dayOfMonth": 15,
        "isActive": true, "createdAt": .string(CP_TODAY), "updatedAt": .string(CP_TODAY),
    ])

    private struct Hist: Equatable { let month: String; let state: PaymentState; let paid: Double; let out: Bool }

    @Test func takipOncesiAylardakiOdemelerTutariylaOdendiGorunur() {
        let accounts = [chk, bonus]
        let transactions = [
            ptx("jun", "2026-06-14", 4_100, ["type": "transfer", "toAccountId": "bonus", "description": "Kredi Kartı Ödemesi"]),
            ptx("aug", "2026-08-13", 6_800, ["description": "Kredi Kartı Ödemesi"]),
        ]
        let t = PS.buildTargets(accounts: accounts, debts: [], plans: [bonusPlan], balances: balances(accounts))
        let rows = PS.buildSchedule(
            targets: t, occurrences: [], transactions: transactions, from: "2026-06", to: "2026-09", today: CP_TODAY,
            cardPayments: CardPayments.assignCardPayments(accounts: accounts, transactions: transactions), fx: fx
        )
        #expect(rows.map { Hist(month: $0.month, state: $0.state, paid: $0.paidAmount, out: $0.outOfRange) } == [
            Hist(month: "2026-06", state: .paid, paid: 4_100, out: true),
            Hist(month: "2026-08", state: .paid, paid: 6_800, out: true),
            Hist(month: "2026-09", state: .open, paid: 0, out: false),
        ])
    }

    @Test func filtrelenmisHedefListesindeTumHesaplardanEslemeKullanilir() {
        // Axess takip dışı bırakılsa bile "tek kart" sayılmaz: iki kart var → belirsiz ödeme yazılmaz.
        let accounts = [chk, bonus, axess]
        let transactions = [ptx("amb", "2026-08-13", 1_000, ["description": "Kredi Kartı Ödemesi"])]
        let t = PS.buildTargets(accounts: accounts, debts: [], plans: [bonusPlan], balances: balances(accounts))
            .filter { $0.id == "bonus" }
        let rows = PS.buildSchedule(
            targets: t, occurrences: [], transactions: transactions, from: "2026-08", to: "2026-08", today: CP_TODAY,
            cardPayments: CardPayments.assignCardPayments(accounts: accounts, transactions: transactions), fx: fx
        )
        #expect(rows.isEmpty)
    }
}
