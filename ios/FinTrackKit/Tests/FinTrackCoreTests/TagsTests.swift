import Testing
@testable import FinTrackCore

/// web src/lib/utils/tags.test.ts karşılığı (+ normalize/dedupe/renk)
@Suite("etiketler")
struct TagsTests {
    let fx = FX(rates: FXRates(usdTry: 34.5, eurTry: 37, gbpTry: 43))

    @Test func tlCinsindenToplar() {
        let all = Tags.aggregate([
            tx(["id": "1", "type": "expense", "amount": 100, "amountTry": 100, "tags": .array([.string("Tatil")])]),
            tx(["id": "2", "type": "expense", "amount": 10, "currency": "USD", "amountTry": 345, "tags": .array([.string("Tatil")])]),
            tx(["id": "3", "type": "income", "amount": 50, "currency": "USD", "amountTry": 1725, "tags": .array([.string("Tatil")])]),
        ], fx: fx)
        let t = all[0]
        #expect(t.tag == "Tatil")
        #expect(t.expense == 445 && t.income == 1725 && t.volume == 2170 && t.count == 3)
    }

    @Test func kurusHassas() {
        let t = Tags.aggregate([
            tx(["id": "1", "amount": 0.1, "amountTry": 0.1, "tags": .array([.string("x")])]),
            tx(["id": "2", "amount": 0.2, "amountTry": 0.2, "tags": .array([.string("x")])]),
        ], fx: fx)[0]
        #expect(t.expense == 0.3)
    }

    @Test func mutabakatTamamenHaric() {
        let r = Tags.aggregate([
            tx(["id": "1", "amount": 100, "amountTry": 100, "tags": .array([.string("Market")])]),
            tx(["id": "2", "amount": 9999, "amountTry": 9999, "systemKind": "reconciliation",
                "tags": .array([.string("#BakiyeEşitleme"), .string("Market")])]),
        ], fx: fx)
        #expect(r.count == 1)
        #expect(r[0].expense == 100 && r[0].count == 1)
    }

    @Test func buyukKucukHarfBirlesirEnSikYazimKalir() {
        let r = Tags.aggregate([
            tx(["id": "1", "tags": .array([.string("tatil")])]),
            tx(["id": "2", "tags": .array([.string("Tatil")])]),
            tx(["id": "3", "tags": .array([.string("Tatil"), .string(" TATİL ")])]),   // aynı işlemde tekrar → bir kez
            tx(["id": "4", "tags": .array([.string("iş")])]),
        ], fx: fx)
        #expect(r.map(\.tag) == ["Tatil", "iş"])
        #expect(r[0].count == 3)
        #expect(Tags.has(tx(["tags": .array([.string("TATİL")])]), key: "tatil"))
    }

    @Test func normalizeVeTekrarsiz() {
        #expect(Tags.normalize("  yaz   tatili ") == "yaz tatili")
        #expect(Tags.dedupe(["Tatil", "tatil", " ", "İş", "iş", "Ev "]) == ["Tatil", "İş", "Ev"])
    }

    /// Değerler web tagColor'dan (node) alındı
    @Test func webIleAyniRenk() {
        #expect(Tags.color("tatil") == "#3B82F6")
        #expect(Tags.color("abonelik") == "#F3A712")
        #expect(Tags.color("iş") == "#0EA5E9")
        #expect(Tags.color("çocuk") == "#F3A712")
        #expect(Tags.color("a very long tag name for hashing ğüşiöç") == "#F3A712")
    }
}
