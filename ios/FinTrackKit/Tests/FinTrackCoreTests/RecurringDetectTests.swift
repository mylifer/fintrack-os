import Testing
@testable import FinTrackCore

/* Web src/lib/utils/recurring-detect.test.ts ile AYNI girdiler. */

@Suite("geçmişten tekrarlayan tespiti")
struct RecurringDetectTests {
    let asOf = "2026-09-26"
    nonisolated(unsafe) static var n = 0
    func t(_ o: JSONObject) -> Transaction {
        RecurringDetectTests.n += 1
        var raw: JSONObject = ["id": .string("t\(RecurringDetectTests.n)"), "type": "expense", "amount": 100, "currency": "TRY",
                               "date": "2026-09-01", "accountId": "a", "description": "", "isInstallment": false]
        for (k, v) in o { raw[k] = v }
        return Transaction(raw: raw)
    }
    func monthly(_ desc: String, _ day: String, _ amounts: [Double], _ o: JSONObject = [:]) -> [Transaction] {
        amounts.enumerated().map { i, a in
            var x: JSONObject = ["description": .string(desc), "amount": .number(a),
                                 "date": .string("2026-0\(9 - amounts.count + 1 + i)-\(day)")]
            for (k, v) in o { x[k] = v }
            return t(x)
        }
    }

    @Test func keyText() {
        #expect(RecurringDetect.keyText("MİGROS 1234 KADIKÖY/İST") == "migros kadikoy ist")
        #expect(RecurringDetect.keyText("Kira - Eylül 2026") == "kira")
        #expect(RecurringDetect.keyText("EV KIRASI HAZİRAN") == RecurringDetect.keyText("Ev kirası temmuz"))
        #expect(RecurringDetect.suggestionName("EV KIRASI EYLUL") == "EV KIRASI")
        #expect(RecurringDetect.suggestionName("Kira - Eylül 2026") == "Kira")
        #expect(RecurringDetect.suggestionName("MAAS ODEMESI 202609") == "MAAS ODEMESI")
        #expect(RecurringDetect.suggestionName("2026/09") == "2026/09")
    }

    @Test func rentAndSalary() {
        let txs = monthly("Ev Kirası", "03", [15000, 15000, 15000, 15000])
            + monthly("MAAS ODEMESI 202609", "15", [60000, 60000, 62000], ["type": "income"])
        let s = RecurringDetect.detect(txs, recurring: [], asOf: asOf)
        #expect(s.map(\.name) == ["MAAS ODEMESI", "Ev Kirası"])
        #expect(s[1].amount == 15000 && s[1].count == 4 && s[1].lastDate == "2026-09-03"
                && s[1].nextDate == "2026-10-03" && s[1].dayOfMonth == 3 && !s[1].amountVaries)
        #expect(s[0].type == .income && s[0].amountVaries)
    }

    @Test func noisyRejected() {
        let market = monthly("Migros", "05", [800, 900, 750]) + monthly("Migros", "20", [600, 700, 650])
        let gun = [t(["description": "Spor", "date": "2026-07-02"]), t(["description": "Spor", "date": "2026-08-20"]),
                   t(["description": "Spor", "date": "2026-09-10"])]
        let tutar = monthly("Elektrik", "10", [300, 900, 400])
        #expect(RecurringDetect.detect(market + gun + tutar, recurring: [], asOf: asOf).isEmpty)
    }

    @Test func monthEndSameDay() {
        let txs = [t(["description": "Aidat", "date": "2026-06-30"]), t(["description": "Aidat", "date": "2026-07-31"]),
                   t(["description": "Aidat", "date": "2026-08-31"])]
        #expect(RecurringDetect.detect(txs, recurring: [], asOf: asOf).count == 1)
    }

    @Test func staleShortAndLinkedRejected() {
        let eski = [t(["description": "Gym", "date": "2026-04-05"]), t(["description": "Gym", "date": "2026-05-05"]),
                    t(["description": "Gym", "date": "2026-06-05"])]
        let iki = monthly("Netflix", "12", [229, 229])
        let taksit = monthly("Telefon", "08", [1000, 1000, 1000], ["isInstallment": true, "installGroupId": "g"])
        let yatirim = monthly("10 Gr Altın Alımı", "01", [5000, 5000, 5000], ["icon": "Au"])
        #expect(RecurringDetect.detect(eski + iki + taksit + yatirim, recurring: [], asOf: asOf).isEmpty)
    }

    @Test func existingTemplateAndDismissed() {
        let txs = monthly("Ev Kirası", "03", [15000, 15000, 15000]) + monthly("Su faturası 123", "11", [200, 210, 205], ["recipientId": "iski"])
        func tmpl(_ o: JSONObject) -> RecurringTransaction {
            var raw: JSONObject = ["id": "r", "name": "x", "type": "expense", "amount": 1, "currency": "TRY", "accountId": "a",
                                   "description": "", "frequency": "monthly", "startDate": "", "nextDueDate": "", "isActive": true]
            for (k, v) in o { raw[k] = v }
            return RecurringTransaction(raw: raw)
        }
        #expect(RecurringDetect.detect(txs, recurring: [tmpl(["name": "Ev kirası"])], asOf: asOf).map(\.name) == ["Su faturası"])
        #expect(RecurringDetect.detect(txs, recurring: [tmpl(["recipientId": "iski"])], asOf: asOf).map(\.name) == ["Ev Kirası"])
        let all = RecurringDetect.detect(txs, recurring: [], asOf: asOf)
        #expect(RecurringDetect.detect(txs, recurring: [], asOf: asOf, dismissed: [all[0].key]).count == 1)
    }

    @Test func templateStartsNext() {
        let s = RecurringDetect.detect(monthly("Ev Kirası", "03", [15000, 15000, 15000], ["categoryId": "kira"]), recurring: [], asOf: asOf)[0]
        let r = RecurringDetect.template(s, id: "id1", now: "now", workspaceId: nil)
        #expect(r.frequency == .monthly && r.startDate == "2026-10-03" && r.nextDueDate == "2026-10-03"
                && r.amount == 15000 && r.categoryId == "kira" && r.isActive)
    }
}
