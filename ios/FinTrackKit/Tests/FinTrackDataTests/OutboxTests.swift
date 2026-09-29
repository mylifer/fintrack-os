import Foundation
import Testing
import FinTrackCore
@testable import FinTrackData

@Suite("çevrimdışı kuyruk", .serialized)
struct OutboxTests {
    let uid = "test-\(UUID().uuidString)"

    @Test func ayniSatirinEskiSurumuDusur() {
        var o = Outbox(userId: uid)
        defer { o.clear() }
        o.enqueue(table: "transactions", row: ["id": "t1", "amount": 10, "updatedAt": "a"])
        o.enqueue(table: "transactions", row: ["id": "t2", "amount": 5])
        o.enqueue(table: "transactions", row: ["id": "t1", "amount": 20, "updatedAt": "b"])
        #expect(o.count == 2)
        #expect(o.entries.last?.row["amount"] == 20)
        #expect(o.entries.map(\.seq) == [2, 3])
    }

    @Test func diskteKalirVeKullaniciyaOzel() {
        var o = Outbox(userId: uid)
        o.enqueue(table: "savings_goals", row: ["id": "g"])
        #expect(Outbox(userId: uid).count == 1)
        #expect(Outbox(userId: uid + "-baska").count == 0)
        let e = o.entries[0]
        o.remove(e)
        #expect(Outbox(userId: uid).isEmpty)
    }

    @Test func bulutGoruntusununUstuneYerlesir() {
        var snap = Snapshot()
        snap.transactions = [Transaction(raw: ["id": "t1", "amount": 10])]
        snap.overlay(table: "transactions", row: ["id": "t1", "amount": 99])
        snap.overlay(table: "transactions", row: ["id": "yeni", "amount": 1])
        snap.overlay(table: "recurring_transactions", row: ["id": "r", "name": "Kira"])
        #expect(snap.transactions.map(\.amount) == [99, 1])
        #expect(snap.recurring.first?.name == "Kira")
    }
}
