import Foundation
import Testing
@testable import FinTrackCore

/// Web spec'teki örnek: 1000 TL, 3 taksit, 2026-01-31, kategori C, "Buzdolabı".
@Suite("taksitli alışveriş")
struct InstallmentGroupTests {
    let card = Account(raw: ["id": "k", "name": "Kart", "type": "credit_card", "currency": "TRY"])

    func draft(_ amount: String = "1000") -> TransactionDraft {
        var d = TransactionDraft()
        d.amountText = amount; d.accountId = "k"; d.categoryId = "C"; d.description = "Buzdolabı "
        d.date = DateUtil.parseDay("2026-01-31")!
        return d
    }

    @Test func webOrnegi() throws {
        let rows = try Installments.makeGroup(draft(), count: 3, account: card, workspaceId: nil, fx: fx, now: "N",
                                              groupId: "G", ids: ["a", "b", "c"])
        #expect(rows.map(\.amount) == [333.34, 333.33, 333.33])
        #expect(rows.map(\.date) == ["2026-01-31", "2026-02-28", "2026-03-31"])
        #expect(rows.map(\.installIndex) == [1, 2, 3])
        #expect(rows.allSatisfy { $0.installTotal == 3 && $0.installGroupId == "G" && $0.isInstallment })
        #expect(rows.allSatisfy { $0.description == "Buzdolabı" && $0.approvalStatus == .approved })
        #expect(rows.allSatisfy { !Calc.awaitsApproval($0) })
        let row = rows[0].rowForWrite(updatedAt: "N")
        #expect(row["tags"] == .null && row["categorySplits"] == .null && row["notes"] == .null)
        #expect(row["amountTry"] == 333.34)
        #expect(rows[0].isPlainInstallment && rows[0].canDeleteOnIOS)
        // Kart limiti: gelecek taksitler bugünden düşer (web calcAvailableCredit)
        #expect(Calc.availableCredit(Account(raw: ["id": "k", "type": "credit_card", "creditLimit": 60000]),
                                     balance: -333.34, rows, asOf: "2026-01-31") == 60000 - 1000)
    }

    @Test func raporlardaTekSatir() throws {
        let rows = try Installments.makeGroup(draft("12000"), count: 6, account: card, workspaceId: "ws", fx: fx, now: "N")
        let collapsed = Installments.collapse(rows, fx: fx)
        #expect(collapsed.count == 1)
        #expect(collapsed[0].amount == 12000)
        #expect(collapsed[0].date == "2026-01-31")
    }

    @Test func dogrulama() {
        #expect(throws: Installments.InstallmentError.self) {
            try Installments.makeGroup(draft(), count: 1, account: card, workspaceId: nil, fx: fx, now: "N")
        }
        var d = draft(); d.categoryId = nil
        #expect(throws: Installments.InstallmentError.self) {
            try Installments.makeGroup(d, count: 3, account: card, workspaceId: nil, fx: fx, now: "N")
        }
        d = draft(); d.description = "  "
        #expect(throws: Installments.InstallmentError.self) {
            try Installments.makeGroup(d, count: 3, account: card, workspaceId: nil, fx: fx, now: "N")
        }
    }
}
