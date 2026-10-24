import Testing
@testable import FinTrackCore

/* Web src/lib/utils/interest-tax.test.ts ile AYNI girdiler. */

@Suite("faiz stopajı")
struct InterestTaxTests {
    @Test func grossMode() {
        #expect(InterestTax.split(308.22, ratePct: 17.5, mode: .gross) == .init(gross: 308.22, tax: 53.94, net: 254.28))
    }

    @Test func netModeKeepsAccountEffect() {
        let s = InterestTax.split(254.28, ratePct: 17.5, mode: .net)
        #expect(s == .init(gross: 308.22, tax: 53.94, net: 254.28))
        #expect(Money.sub(s.gross, s.tax) == 254.28)
    }

    @Test(arguments: [0.01, 1, 12.34, 999.99, 4321.5])
    func netModeConsistentWithBank(_ net: Double) {
        let s = InterestTax.split(net, ratePct: 17.5, mode: .net)
        #expect(abs(Money.round(s.gross * 0.175) - s.tax) < 0.006)
        #expect(Money.toMinor(Money.sub(s.gross, s.tax)) == Money.toMinor(net))
    }

    @Test func zeroRate() {
        #expect(InterestTax.split(100, ratePct: 0, mode: .net) == .init(gross: 100, tax: 0, net: 100))
    }

    @Test func impliedRate() {
        #expect(InterestTax.impliedRate(gross: 308.22, tax: 53.94) == 17.5)
        #expect(InterestTax.impliedRate(gross: 0, tax: 0) == 0)
    }

    @Test func interestCategory() {
        let cats = [
            Category(raw: ["id": "f", "name": "Faiz Geliri", "scope": "income"]),
            Category(raw: ["id": "m", "name": "Mevduat", "scope": "income", "parentId": "f"]),
            Category(raw: ["id": "s", "name": "Maaş", "scope": "income"]),
            Category(raw: ["id": "e", "name": "Kredi Faizi", "scope": "expense"]),
        ]
        #expect(InterestTax.isInterestCategory("f", cats))
        #expect(InterestTax.isInterestCategory("m", cats))
        #expect(!InterestTax.isInterestCategory("s", cats))
        #expect(!InterestTax.isInterestCategory("e", cats))
        #expect(!InterestTax.isInterestCategory(nil, cats))
    }

    @Test func linkedTaxJoinsDelete() {
        let income = tx(["id": "i1", "type": "income"])
        let tax = tx(["id": .string(InterestTax.taxId(for: "i1")), "type": "expense"])
        let other = tx(["id": "x", "type": "expense"])
        #expect(InterestTax.withLinkedTax([income], all: [income, tax, other]).map(\.id) == ["i1", tax.id])
        #expect(InterestTax.withLinkedTax([other], all: [income, tax, other]).map(\.id) == ["x"])
    }

    @Test func stableId() {
        #expect(InterestTax.taxId(for: "abc") == InterestTax.taxId(for: "abc"))
        #expect(InterestTax.taxId(for: "abc") != InterestTax.taxId(for: "abd"))
    }

    @Test func taxRow() {
        let cats = [Category(raw: ["id": "v", "name": "Vergi", "scope": "expense", "isSystem": true])]
        let interest = tx(["id": "i1", "type": "income", "amount": 308.22, "date": "2026-01-15", "description": "Mevduat faizi ",
                           "workspaceId": "w"])
        let row = InterestTax.makeTaxRow(interest: interest, tax: 53.94, categories: cats, recipientId: "itc", fx: fx, now: "n")
        #expect(row.id == InterestTax.taxId(for: "i1"))
        #expect(row.type == .expense && row.amount == 53.94 && row.amountTry == 53.94)
        #expect(row.categoryId == "v" && row.recipientId == "itc")
        #expect(row.description == "Mevduat faizi stopajı")
        #expect(row.workspaceId == "w")
    }
}
