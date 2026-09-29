import Foundation
import Testing
@testable import FinTrackCore

/* Web src/lib/payments/card-payments.test.ts ile AYNI girdiler ve beklenen
   sonuçlar (buildSchedule'a bağlı iki vakanın yalnız atama kısmı — Ödeme
   Takibi takvimi ayrı taşınacak). */

private func acc(_ id: String, _ name: String, _ type: String, _ extra: JSONObject = [:]) -> Account {
    var raw: JSONObject = [
        "id": .string(id), "name": .string(name), "type": .string(type), "currency": "TRY",
        "initialBalance": 0, "color": "#000", "isArchived": false, "createdAt": "2026-01-01T00:00:00.000Z",
    ]
    for (k, v) in extra { raw[k] = v }
    return Account(raw: raw)
}

private func ptx(_ id: String, _ date: String, _ amount: Double, _ extra: JSONObject = [:]) -> Transaction {
    var raw: JSONObject = [
        "id": .string(id), "date": .string(date), "amount": .number(amount), "type": "expense",
        "currency": "TRY", "accountId": "chk", "description": "x", "isInstallment": false,
        "createdAt": "2026-01-01", "updatedAt": "2026-01-01",
    ]
    for (k, v) in extra { raw[k] = v }
    return Transaction(raw: raw)
}

private let chk = acc("chk", "Vadesiz Hesap", "checking")
private let bonus = acc("bonus", "Garanti Bonus", "credit_card")
private let axess = acc("axess", "Akbank Axess", "credit_card")

private func ids(_ m: [String: [Transaction]], _ card: String) -> [String] { (m[card] ?? []).map(\.id) }

@Suite("isCardPaymentText")
struct IsCardPaymentTextTests {
    @Test func buyukKucukHarfVeTurkceKarakterdenBagimsiz() {
        #expect(CardPayments.isCardPaymentText("Kredi Kartı Ödemesi"))
        #expect(CardPayments.isCardPaymentText("kredi karti odemesi"))
        #expect(CardPayments.isCardPaymentText("KREDİ KARTI ÖDEME"))
        #expect(CardPayments.isCardPaymentText("Kredi Kartı Ödemesi - Bonus"))
        #expect(CardPayments.isCardPaymentText("Kredi kart ödemesi"))
    }

    @Test func ilgisizAciklamalariTanimaz() {
        #expect(!CardPayments.isCardPaymentText("Market"))
        #expect(!CardPayments.isCardPaymentText("Kredi Kartı Aidatı"))
        #expect(!CardPayments.isCardPaymentText(nil))
    }
}

@Suite("assignCardPayments")
struct AssignCardPaymentsTests {
    @Test func kartaTransferAciklamadanBagimsiz() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, axess], transactions: [
            ptx("t1", "2026-08-10", 500, ["type": "transfer", "toAccountId": "bonus", "description": "Aktarım"]),
        ])
        #expect(ids(m, "bonus") == ["t1"])
    }

    @Test func baskaHesabaGidenTransferKartOdemesiDegil() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, acc("sav", "Birikim", "savings")], transactions: [
            ptx("t1", "2026-08-10", 500, ["type": "transfer", "toAccountId": "sav", "description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(m.isEmpty)
    }

    @Test func tekKartVarsaOKartaYazilir() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus], transactions: [
            ptx("t1", "2026-08-10", 500, ["description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(ids(m, "bonus") == ["t1"])
    }

    @Test func birdenFazlaKartAdGecmiyorsaYazilmaz() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, axess], transactions: [
            ptx("t1", "2026-08-10", 500, ["description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(m.isEmpty)
    }

    @Test func aciklamadaYaDaNottaKartAdi() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, axess], transactions: [
            ptx("t1", "2026-08-10", 500, ["description": "Kredi Kartı Ödemesi - Akbank Axess"]),
            ptx("t2", "2026-08-11", 700, ["description": "Kredi Kartı Ödemesi", "notes": "garanti bonus"]),
        ])
        #expect(ids(m, "axess") == ["t1"])
        #expect(ids(m, "bonus") == ["t2"])
    }

    @Test func kartinKendiHesabinaGelir() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, axess], transactions: [
            ptx("in", "2026-08-10", 500, ["type": "income", "accountId": "axess", "description": "Kredi kartı ödemesi"]),
            ptx("ex", "2026-08-10", 500, ["type": "expense", "accountId": "axess", "description": "Kredi kartı ödemesi"]),
        ])
        #expect(ids(m, "axess") == ["in"])
    }

    @Test func borcOdemesiVeNakitHesabaGirenPara() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus], transactions: [
            ptx("d", "2026-08-10", 500, ["type": "transfer", "debtId": "x", "description": "Kredi Kartı Ödemesi"]),
            ptx("i", "2026-08-10", 500, ["type": "income", "description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(m.isEmpty)
    }

    @Test func arsivliKartVeKartEklenmedenOnceki() {
        let old = acc("old", "Eski World", "credit_card", ["isArchived": true])
        let late = acc("late", "Yeni Kart", "credit_card", ["createdAt": "2026-08-01T00:00:00.000Z"])
        let m = CardPayments.assignCardPayments(accounts: [chk, old, late], transactions: [
            ptx("o", "2026-08-10", 500, ["description": "Kredi Kartı Ödemesi Eski World"]),
            ptx("early", "2026-07-10", 500, ["description": "Kredi Kartı Ödemesi"]),
            ptx("ok", "2026-08-10", 500, ["description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(m["old"] == nil)
        #expect(ids(m, "late") == ["ok"])
    }

    // buildSchedule vakası 1'in atama kısmı: takip öncesi aylarda bulunan ödemeler
    @Test func gecmisKartOdemeleriAtanir() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus], transactions: [
            ptx("jun", "2026-06-14", 4_100, ["type": "transfer", "toAccountId": "bonus", "description": "Kredi Kartı Ödemesi"]),
            ptx("aug", "2026-08-13", 6_800, ["description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(ids(m, "bonus") == ["jun", "aug"])
    }

    // buildSchedule vakası 2'nin atama kısmı: hedef listesi filtrelense de TÜM
    // hesaplardan hesaplanır — iki kart var → belirsiz ödeme yazılmaz.
    @Test func tumHesaplardanHesaplanir() {
        let m = CardPayments.assignCardPayments(accounts: [chk, bonus, axess], transactions: [
            ptx("amb", "2026-08-13", 1_000, ["description": "Kredi Kartı Ödemesi"]),
        ])
        #expect(m.isEmpty)
    }
}
