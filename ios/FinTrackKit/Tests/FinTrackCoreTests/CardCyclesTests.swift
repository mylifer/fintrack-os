import Foundation
import Testing
@testable import FinTrackCore

/* Web src/lib/payments/card-cycles.test.ts ve bank-rules.test.ts ile AYNI
   girdiler ve beklenen sonuçlar. Biri değişirse diğeri de değişmeli. */

private func nextDay(_ iso: String) -> String {
    let d = DateUtil.parseDay(iso)!
    return DateUtil.day(DateUtil.calendar.date(byAdding: .day, value: 1, to: d)!)
}

@Suite("card-cycles — lastClosingBefore")
struct LastClosingBeforeTests {
    @Test func sonOdemedenOncekiSonKesim() {
        #expect(CardCycles.lastClosingBefore("2026-10-04", 24) == "2026-09-24")
        #expect(CardCycles.lastClosingBefore("2026-10-16", 11) == "2026-10-11")
        #expect(CardCycles.lastClosingBefore("2026-10-17", 17) == "2026-09-17")
        #expect(CardCycles.lastClosingBefore("2026-03-10", 31) == "2026-02-28")
        #expect(CardCycles.lastClosingBefore("2026-10-10", nil) == "2026-09-30")   // kesim günü yok → ay sonu
    }
}

@Suite("card-cycles — varsayılan günler")
struct CardCycleDefaultTests {
    @Test func kesim24SonOdeme4() {
        #expect(CardCycles.cardCycle(CardDays(statementDay: 24, dueDay: 4), "2026-10") == CardCycle(
            month: "2026-10", from: "2026-08-25", closing: "2026-09-24", dueDate: "2026-10-04",
            closingCustom: false, dueCustom: false, closingShifted: false, dueShifted: false, invalid: false))
    }

    @Test func kesim11SonOdeme16AyniAy() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 11, dueDay: 16), "2026-10")
        #expect(c.from == "2026-09-12")
        #expect(c.closing == "2026-10-11")
        #expect(c.dueDate == "2026-10-16")
    }

    @Test func sonOdemeYoksaKesimAyi() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 1, dueDay: nil), "2026-10")
        #expect(c.from == "2026-09-02")
        #expect(c.closing == "2026-10-01")
        #expect(c.dueDate == nil)
        #expect(c.invalid == false)
    }

    @Test func kisaAydaAySonunaSikisir() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 31, dueDay: 10), "2026-03")
        #expect(c.closing == "2026-02-28")
        #expect(c.dueDate == "2026-03-10")
        #expect(c.from == "2026-02-01")
    }
}

@Suite("card-cycles — ay bazında özel tarih")
struct CardCycleOverrideTests {
    @Test func ozelSonOdemeKesimVarsayilanKalir() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 24, dueDay: 4), "2026-10",
                                     override: CycleOverride(dueDate: "2026-10-05"))
        #expect(c.closing == "2026-09-24")
        #expect(c.dueDate == "2026-10-05")
        #expect(c.dueCustom == true)
        #expect(c.closingCustom == false)
    }

    @Test func ozelKesimSonrakiDonemBasiniKaydirir() {
        let cs = CardCycles.cardCycles(CardDays(statementDay: 24, dueDay: 4),
                                       overrides: ["2026-10": CycleOverride(statementDate: "2026-09-23")],
                                       from: "2026-10", to: "2026-11")
        #expect(cs.count == 2)
        #expect(cs[0].closing == "2026-09-23")
        #expect(cs[0].closingCustom == true)
        #expect(cs[1].from == "2026-09-24")
        #expect(cs[1].closing == "2026-10-24")
    }

    @Test func kesimSonOdemedenSonraysaIsaretlenir() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 24, dueDay: 4), "2026-10",
                                     override: CycleOverride(statementDate: "2026-10-06"))
        #expect(c.invalid == true)
    }

    @Test func ardisikDongulerBosluksuz() {
        let cs = CardCycles.cardCycles(CardDays(statementDay: 28, dueDay: 7), from: "2026-01", to: "2026-12")
        #expect(cs.count == 12)
        for i in 1..<cs.count { #expect(cs[i].from == nextDay(cs[i - 1].closing)) }
    }
}

@Suite("tr-holidays")
struct TRHolidaysTests {
    @Test func sabitVeDiniTatillerArifeIsGunu() {
        #expect(TRHolidays.isHoliday("2026-04-23"))
        #expect(TRHolidays.isHoliday("2026-10-29"))
        #expect(TRHolidays.isHoliday("2026-03-20"))    // Ramazan Bayramı 1. gün
        #expect(TRHolidays.isHoliday("2026-05-27"))    // Kurban Bayramı 1. gün
        #expect(!TRHolidays.isHoliday("2026-03-19"))   // arife — yarım gün, bankalar açık
        #expect(TRHolidays.isHoliday("2027-03-09"))
    }

    @Test func haftaSonuVeTatilSonrasiIlkIsGunu() {
        #expect(!TRHolidays.isBusinessDay("2026-10-04"))                       // Pazar
        #expect(TRHolidays.nextBusinessDay("2026-10-03") == "2026-10-05")      // Cumartesi → Pazartesi
        #expect(TRHolidays.nextBusinessDay("2026-05-27") == "2026-06-01")      // Kurban Bayramı + hafta sonu
        #expect(TRHolidays.nextBusinessDay("2026-10-28") == "2026-10-28")      // 28 Ekim yarım gün → iş günü
    }
}

@Suite("bank-rules")
struct BankRulesTests {
    @Test func kartAdindanBanka() {
        let g = BankRules.bankRuleFor("Garanti Platinum")
        #expect(g.key == "garanti")
        #expect(g.gapDays == 10)
        #expect(g.holidayRule == .due)
        #expect(BankRules.bankRuleFor("Yapı Kredi Platinum").key == "yapikredi")
        #expect(BankRules.bankRuleFor("QNB").key == "qnb")
        #expect(BankRules.bankRuleFor("Kuveyt Türk").key == "kuveyt")
        #expect(BankRules.bankRuleFor("Odeabank Private").key == "odea")
        #expect(BankRules.bankRuleFor("Burgan").key == "burgan")
        #expect(BankRules.bankRuleFor("VakıfBank World").holidayRule == .both)
        #expect(BankRules.bankRuleFor("Getir").key == "other")
    }

    @Test func nominalSonOdemeGunuVeFark() {
        #expect(BankRules.nominalDueDay(24, 10) == 4)
        #expect(BankRules.nominalDueDay(1, 10) == 11)
        #expect(BankRules.nominalDueDay(28, 10) == 8)
        #expect(BankRules.gapBetween(24, 4) == 10)
        #expect(BankRules.gapBetween(11, 16) == 5)
        #expect(BankRules.gapBetween(17, 17) == 30)
    }

    @Test func kartinGunleri() {
        func acc(_ sd: Int, _ extra: JSONObject = [:]) -> Account {
            var raw: JSONObject = ["id": "c", "name": "Garanti Business", "type": "credit_card", "statementDay": .number(Double(sd))]
            for (k, v) in extra { raw[k] = v }
            return Account(raw: raw)
        }
        func plan(_ day: Int) -> PaymentPlan {
            PaymentPlan(raw: ["id": "p", "targetKind": "card", "targetId": "c", "dayOfMonth": .number(Double(day))])
        }
        let a = BankRules.resolveCardDays(account: acc(11), plan: nil).days
        #expect(a.gapDays == 10)
        #expect(a.holidayRule == .due)
        #expect(BankRules.resolveCardDays(account: acc(24), plan: plan(4)).days.gapDays == 10)
        let odd = BankRules.resolveCardDays(account: acc(11), plan: plan(16))
        #expect(odd.days.gapDays == nil)
        #expect(odd.inconsistent == CardDaysInconsistency(gap: 5, suggestDue: 21, suggestClosing: 6))
        #expect(BankRules.resolveCardDays(account: acc(11, ["dueGapDays": 12]), plan: plan(16)).days.gapDays == 12)
    }
}

@Suite("kesim + fark ve tatil kuralı")
struct GapHolidayTests {
    @Test func yalnizSonOdemeKayar() {
        let days = CardDays(statementDay: 24, dueDay: nil, gapDays: 10, holidayRule: .due)
        // Eylül 24 + 10 = 4 Ekim Pazar → 5 Ekim
        let oct = CardCycles.cardCycle(days, "2026-10")
        #expect(oct.closing == "2026-09-24")
        #expect(oct.dueDate == "2026-10-05")
        #expect(oct.dueShifted == true)
        #expect(oct.closingShifted == false)
        // Ay uzunluğu: 24 Şubat + 10 = 6 Mart (Cuma)
        let mar = CardCycles.cardCycle(days, "2026-03")
        #expect(mar.closing == "2026-02-24")
        #expect(mar.dueDate == "2026-03-06")
        #expect(mar.dueShifted == false)
    }

    @Test func kesimleAyniAyOdenenKart() {
        let c = CardCycles.cardCycle(CardDays(statementDay: 11, dueDay: nil, gapDays: 10, holidayRule: .due), "2026-10")
        #expect(c.closing == "2026-10-11")
        #expect(c.dueDate == "2026-10-21")
    }

    @Test func kesimDeKayarVakifBank() {
        func cycle(_ sd: Int, _ m: String) -> CardCycle {
            CardCycles.cardCycle(CardDays(statementDay: sd, dueDay: nil, gapDays: 10, holidayRule: .both), m)
        }
        // [kesim günü, ödeme ayı, beklenen kesim, beklenen son ödeme] — vakifkart.com.tr
        let rows: [(Int, String, String, String)] = [
            (5, "2026-02", "2026-02-06", "2026-02-16"),    // 15 Şubat Pazar
            (10, "2026-03", "2026-03-13", "2026-03-23"),   // 20–22 Mart Ramazan Bayramı
            (13, "2026-04", "2026-04-14", "2026-04-24"),   // 23 Nisan
            (5, "2026-04", "2026-04-05", "2026-04-15"),    // kesim Pazar olabilir
            (23, "2026-10", "2026-09-25", "2026-10-05"),   // 3 Ekim Cumartesi
            (30, "2026-05", "2026-05-01", "2026-05-11"),   // 10 Mayıs Pazar; kesim 1 Mayıs tatilinde olabilir
        ]
        for (sd, m, c, d) in rows {
            let r = cycle(sd, m)
            #expect(r.closing == c, "kesim \(sd) / \(m)")
            #expect(r.dueDate == d, "kesim \(sd) / \(m)")
        }
    }

    @Test func herOdemeAyinaTekEkstre() {
        let cs = CardCycles.cardCycles(CardDays(statementDay: 20, dueDay: nil, gapDays: 10, holidayRule: .due),
                                       from: "2026-01", to: "2026-12")
        #expect(Set(cs.map(\.closing)).count == 12)
        for i in 1..<cs.count { #expect(cs[i].from > cs[i - 1].closing) }
    }
}
