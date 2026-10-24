import Testing
@testable import FinTrackCore

/// Web src/lib/utils/id.ts ile aynı çıktılar (referans değerler JS'ten üretildi).
@Suite("deterministik kimlik")
struct DeterministicIDTests {
    @Test(arguments: [
        ("", "d1154c50-cdbd-430f-97e9-7c23493ba652"),
        ("x", "420e3da8-7a67-4621-b1e6-28700aa87d9e"),
        ("a", "df89705b-5666-4583-91e7-e15d06b07061"),
        ("b", "0b957447-478b-4b0a-b1cd-48fdba9717c8"),
        ("recur:abc-123:2026-02-01", "447efa84-bced-49d2-b8d6-83197e3fea71"),
        ("recur:template:2026-01-01", "a959001b-ff2f-4718-bbd1-34b02773d312"),
        ("recur:t:2026-01-01", "7af6fc89-0ac1-4afa-97d2-de0844573c46"),
        ("recur:t:2026-02-01", "0e660ccf-23af-4dee-97a0-48edb176f187"),
        ("recur:3f2b8c1e-0000-4000-8000-000000000001:2026-09-30", "2f567073-bb26-4659-b349-27f6ecc7026e"),
        ("ödeme-ı", "03bd9d95-76ce-4ef8-9dfd-7373d5ea4cac"),
        ("payplan:card:abc", "3c0b6653-2de5-44a2-90d7-11787a84063c"),
        ("payplan:card:card1", "56d4e0bc-65f4-4b8b-af88-210baa909ff9"),
        ("payocc:card:card1:2026-10", "5e4934d7-bd95-4ed4-8f88-da7132ce88ee"),
        ("payocc:debt:debt1:2026-09", "c057fdc2-db5d-41cc-91a1-defc4712dbd9"),
        ("paytx:card:c1:2026-09", "4e69d7fe-590e-4acd-a667-7dd223e21410"),
    ])
    func webIleAyni(seed: String, expected: String) {
        #expect(DeterministicID.uuid(seed) == expected)
    }

    @Test func onayYalnizIkiAlan() {
        let t = tx(["approvalStatus": "pending", "date": "2026-10-10", "amount": 50])
        let a = t.approved(at: "2026-09-30T10:00:00.000Z")
        let row = a.rowForWrite(updatedAt: "2026-09-30T10:00:00.000Z")
        #expect(row["approvalStatus"] == "approved")
        #expect(row["approvedAt"] == "2026-09-30T10:00:00.000Z")
        #expect(row["date"] == "2026-10-10")
        #expect(row["amount"] == 50)
    }
}
