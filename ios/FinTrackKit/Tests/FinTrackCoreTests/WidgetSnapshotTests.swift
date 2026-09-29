import Foundation
import Testing
@testable import FinTrackCore

@Suite("widget özeti")
struct WidgetSnapshotTests {
    @Test func eskiOzetOkunur() throws {
        let old = """
        {"month":"2026-09","monthTitle":"Eylül 2026","expense":1,"income":2,"net":1,"netWorth":5,
         "budgetSpent":0,"budgetLimit":0,"budgets":[],"amountsHidden":false,"updatedAt":0}
        """
        let s = try JSONDecoder().decode(WidgetSnapshot.self, from: Data(old.utf8))
        #expect(s.pendingCount == 0)
        #expect(s.expense == 1)
    }

    @Test func gidipGelir() throws {
        let s = WidgetSnapshot(month: "2026-09", monthTitle: "Eylül 2026", expense: 1, income: 2, net: 1, netWorth: 5,
                               budgetSpent: 0, budgetLimit: 0, budgets: [], amountsHidden: true, updatedAt: Date(timeIntervalSince1970: 0),
                               pendingCount: 3)
        let back = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(s))
        #expect(back == s)
    }
}
