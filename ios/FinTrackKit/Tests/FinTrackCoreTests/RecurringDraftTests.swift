import Foundation
import Testing
@testable import FinTrackCore

@Suite("tekrarlayan formu")
struct RecurringDraftTests {
    let bank = Account(raw: ["id": "b", "name": "Banka", "type": "checking", "currency": "TRY"])
    let usd = Account(raw: ["id": "u", "name": "Dolar", "type": "savings", "currency": "USD"])

    func draft() -> RecurringDraft {
        var d = RecurringDraft()
        d.name = " Kira "; d.amountText = "22.000"; d.accountId = "b"; d.categoryId = "c"
        d.startDate = DateUtil.parseDay("2026-10-05")!
        return d
    }

    @Test func yeniSablon() {
        let r = draft().build(editing: nil, account: bank, workspaceId: "ws", id: "r1", now: "N")
        let row = r.rowForWrite(updatedAt: "N")
        #expect(row["name"] == "Kira")
        #expect(row["description"] == "Kira")      // açıklama boş → ad
        #expect(row["amount"] == 22000)
        #expect(row["nextDueDate"] == "2026-10-05")
        #expect(row["startDate"] == "2026-10-05")
        #expect(row["dayOfMonth"] == 5)
        #expect(row["isActive"] == true)
        #expect(row["workspaceId"] == "ws")
        #expect(row["createdAt"] == "N")
        #expect(row["endDate"] == .null)
        #expect(row["deleted_at"] == .null)
    }

    @Test func haftalikGunYok_paraBirimiHesaptan() {
        var d = draft(); d.frequency = .weekly; d.accountId = "u"
        let r = d.build(editing: nil, account: usd, workspaceId: nil, now: "N")
        #expect(r.dayOfMonth == nil)
        #expect(r.currency == .USD)
    }

    @Test func duzenlemeBaslangicDegisirseImlecSifirlanir() {
        let base = draft().build(editing: nil, account: bank, workspaceId: nil, id: "r1", now: "N")
        var moved = base; moved.nextDueDate = "2026-12-05"; moved.lastGeneratedDate = "2026-11-05"
        var d = RecurringDraft(editing: moved)
        d.amountText = "23.000"
        let same = d.build(editing: moved, account: bank, workspaceId: nil, now: "M")
        #expect(same.nextDueDate == "2026-12-05")       // başlangıç aynı → imleç korunur
        #expect(same.amount == 23000)
        d.startDate = DateUtil.parseDay("2027-01-10")!
        let shifted = d.build(editing: moved, account: bank, workspaceId: nil, now: "M")
        #expect(shifted.nextDueDate == "2027-01-10")
        #expect(shifted.lastGeneratedDate == "2026-11-05")
    }

    @Test func transferKategoriVeKisiTemizlenir() {
        let base = RecurringTransaction(raw: ["id": "r", "name": "X", "familyMemberId": "f", "categoryId": "c",
                                              "startDate": "2026-10-05", "nextDueDate": "2026-10-05"])
        var d = RecurringDraft(editing: base)
        d.type = .transfer; d.accountId = "b"; d.toAccountId = "u"; d.amountText = "5"
        let r = d.build(editing: base, account: bank, workspaceId: nil, now: "N")
        let row = r.rowForWrite(updatedAt: "N")
        #expect(row["categoryId"] == .null)
        #expect(row["familyMemberId"] == .null)
        #expect(row["toAccountId"] == "u")
    }

    @Test func dogrulama() {
        var d = draft(); d.name = "  "
        #expect(d.validationError() == "Ad girin.")
        d = draft(); d.type = .transfer
        #expect(d.validationError() == "Hedef hesabı seçin.")
        d.toAccountId = "b"
        #expect(d.validationError() == "Kaynak ve hedef hesap aynı olamaz.")
        d = draft(); d.hasEndDate = true; d.endDate = DateUtil.parseDay("2026-10-01")!
        #expect(d.validationError() != nil)
        #expect(draft().validationError() == nil)
    }
}

@Suite("tekrarlayan satır yazımı")
struct RecurringRowTests {
    @Test func tanimsizDegerlerEzilmez() {
        var r = RecurringTransaction(raw: ["id": "r", "name": "Yen", "currency": "JPY", "frequency": "quarterly",
                                           "nextDueDate": "2026-01-01", "startDate": "2026-01-01", "amount": 5])
        r.nextDueDate = "2026-02-01"
        let row = r.rowForWrite(updatedAt: "N")
        #expect(row["currency"] == "JPY")
        #expect(row["frequency"] == "quarterly")
        #expect(row["nextDueDate"] == "2026-02-01")
        #expect(row["endDate"] == .null)   // satırda yoktu → açıkça null (web toSnapshot)
    }
}
