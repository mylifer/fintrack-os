import Testing
@testable import FinTrackCore

/* Web src/lib/utils/recurrence.test.ts ile aynı girdiler. startDate verilmezse
   nextDueDate'e eşit (çapa günü = nextDueDate'in günü). */
func rec(_ o: JSONObject) -> RecurringTransaction {
    var raw: JSONObject = ["id": "r1", "name": "Kira", "type": "expense", "amount": 100, "currency": "TRY",
                           "accountId": "a", "description": "Kira", "isActive": true, "createdAt": "2026-01-01",
                           "frequency": "monthly"]
    for (k, v) in o { raw[k] = v }
    if raw["startDate"] == nil { raw["startDate"] = raw["nextDueDate"] }
    return RecurringTransaction(raw: raw)
}

@Suite("tekrarlama")
struct RecurrenceTests {
    @Test(arguments: [
        ("2026-03-10", RecurringFrequency.daily, nil as Int?, "2026-03-11"),
        ("2026-03-10", .weekly, nil, "2026-03-17"),
        ("2026-03-10", .monthly, nil, "2026-04-10"),
        ("2026-03-10", .yearly, nil, "2027-03-10"),
        ("2026-12-31", .daily, nil, "2027-01-01"),
        ("2026-12-15", .monthly, nil, "2027-01-15"),
        ("2028-02-28", .daily, nil, "2028-02-29"),
        ("2027-02-28", .daily, nil, "2027-03-01"),
        ("2026-01-31", .monthly, 31, "2026-02-28"),
        ("2026-02-28", .monthly, 31, "2026-03-31"),
        ("2026-02-28", .monthly, nil, "2026-03-28"),
        ("2026-02-28", .weekly, 31, "2026-03-07"),
    ])
    func advance(input: String, freq: RecurringFrequency, anchor: Int?, expected: String) {
        #expect(Recurrence.advance(input, freq, anchor: anchor) == expected)
    }

    @Test func occurrences() {
        let m = rec(["nextDueDate": "2026-01-15"])
        #expect(Recurrence.occurrences(m, asOf: "2026-04-20") == ["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"])
        #expect(Recurrence.occurrences(m, asOf: "2026-02-15") == ["2026-01-15", "2026-02-15"])
        #expect(Recurrence.occurrences(rec(["nextDueDate": "2026-01-15", "endDate": "2026-03-15"]), asOf: "2026-12-31")
                == ["2026-01-15", "2026-02-15", "2026-03-15"])
        #expect(Recurrence.occurrences(rec(["nextDueDate": "2026-06-01"]), asOf: "2026-03-01").isEmpty)
        #expect(Recurrence.occurrences(rec(["nextDueDate": "1990-01-01", "frequency": "daily"]), asOf: "2026-01-01").count == 1000)
        #expect(Recurrence.occurrences(rec(["nextDueDate": "2026-01-31"]), asOf: "2026-05-31")
                == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"])
        #expect(Recurrence.occurrences(rec(["startDate": "2026-01-31", "nextDueDate": "2026-09-28"]), asOf: "2026-11-30")
                == ["2026-09-28", "2026-10-31", "2026-11-30"])
        #expect(Recurrence.occurrences(rec(["startDate": "2026-01-20", "nextDueDate": "2026-03-10"]), asOf: "2026-04-15")
                == ["2026-03-10", "2026-04-10"])
        #expect(Recurrence.occurrences(rec(["nextDueDate": "2028-02-29", "frequency": "yearly"]), asOf: "2032-03-01")
                == ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"])
    }

    @Test func nextDueAfter() {
        let m = rec(["nextDueDate": "2026-01-15"])
        #expect(Recurrence.nextDueAfter(m, asOf: "2026-03-20") == "2026-04-15")
        #expect(Recurrence.nextDueAfter(m, asOf: "2026-01-15") == "2026-02-15")
        #expect(Recurrence.nextDueAfter(m, asOf: "2026-04-20") > Recurrence.occurrences(m, asOf: "2026-04-20").last!)
        #expect(Recurrence.nextDueAfter(rec(["nextDueDate": "2026-01-31"]), asOf: "2026-05-31") == "2026-06-30")
    }

    @Test func onayVeAtla() {
        let r = rec(["id": "t", "nextDueDate": "2026-01-01", "amount": 100])
        let existing: Set<String> = ["7af6fc89-0ac1-4afa-97d2-de0844573c46"]   // recur:t:2026-01-01
        let out = Recurrence.approve(r, asOf: "2026-02-10", existingIds: existing, workspaceId: "ws",
                                     fx: fx, now: "2026-02-10T09:00:00.000Z")
        #expect(out.transactions.map(\.id) == ["0e660ccf-23af-4dee-97a0-48edb176f187"])   // recur:t:2026-02-01
        let t = out.transactions[0]
        #expect(t.date == "2026-02-01")
        #expect(t.approvalStatus == .approved)
        #expect(t.amountTry == 100)
        #expect(t.workspaceId == "ws")
        #expect(out.template.nextDueDate == "2026-03-01")
        #expect(out.template.lastGeneratedDate == "2026-02-01")

        let s = Recurrence.skip(rec(["nextDueDate": "2026-01-15", "lastGeneratedDate": "2025-12-15"]), asOf: "2026-04-20")
        #expect(s.nextDueDate == "2026-05-15")
        #expect(s.lastGeneratedDate == "2025-12-15")
    }

    @Test func dovizKursuzAmountTryYazilmaz() {
        let r = rec(["nextDueDate": "2026-01-01", "currency": "USD"])
        let out = Recurrence.approve(r, asOf: "2026-01-01", existingIds: [], workspaceId: nil, fx: FX(), now: "x")
        #expect(out.transactions[0].raw["amountTry"] == nil)
    }

    @Test func vadesiGelen() {
        #expect(Recurrence.isDue(rec(["nextDueDate": "2026-03-01"]), asOf: "2026-03-01"))
        #expect(!Recurrence.isDue(rec(["nextDueDate": "2026-03-01", "isActive": false]), asOf: "2026-03-05"))
        #expect(!Recurrence.isDue(rec(["nextDueDate": "2026-03-01", "endDate": "2026-03-02"]), asOf: "2026-03-05"))
        #expect(Recurrence.isUpcoming(rec(["nextDueDate": "2026-03-08"]), today: "2026-03-01"))
        #expect(!Recurrence.isUpcoming(rec(["nextDueDate": "2026-03-09"]), today: "2026-03-01"))
    }

    @Test func satirYazimiYalnizImlec() {
        var r = rec(["nextDueDate": "2026-01-01", "user_id": "u", "dayOfMonth": 1])
        r.nextDueDate = "2026-02-01"
        let row = r.rowForWrite(updatedAt: "2026-01-02T00:00:00.000Z")
        #expect(row["nextDueDate"] == "2026-02-01")
        #expect(row["dayOfMonth"] == 1)
        #expect(row["user_id"] == nil)
        #expect(row["deleted_at"] == .null)
    }
}

@Suite("planlı tekrarlayan satırları")
struct PlannedRecurringTests {
    @Test func sanalSatirlar() {
        let r = rec(["id": "t", "nextDueDate": "2026-01-01", "amount": 100])
        // 01-01 zaten yazılmış; 02-01 ve 03-01 planlı
        let list = Recurrence.plannedTransactions([r], today: "2026-01-01", horizon: "2026-03-15",
                                                  existingIds: ["7af6fc89-0ac1-4afa-97d2-de0844573c46"], fx: fx)
        #expect(list.map(\.date) == ["2026-02-01", "2026-03-01"])
        #expect(list[0].id == "0e660ccf-23af-4dee-97a0-48edb176f187")
        #expect(list[0].plannedRecurringId == "t")
        #expect(list[0].isLinked)
        #expect(!list[0].canDeleteOnIOS)
    }
}
