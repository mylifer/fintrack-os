import Testing
@testable import FinTrackCore

@Suite("hızlı ekleme önerileri")
struct SuggestionsTests {
    // Tarih ↓ sıralı (en yeni önce), AppModel.transactions gibi
    let txs: [Transaction] = [
        tx(["id": "1", "description": "Migros", "categoryId": "market", "accountId": "kart", "amount": 420]),
        tx(["id": "2", "description": "Starbucks", "categoryId": "kahve", "accountId": "nakit", "amount": 150]),
        tx(["id": "3", "description": "migros ", "categoryId": "eski", "accountId": "banka", "amount": 300]),
        tx(["id": "4", "description": "Kahve Dünyası", "categoryId": "kahve", "accountId": "nakit", "amount": 95]),
        tx(["id": "5", "description": "Starbucks", "categoryId": "kahve", "accountId": "nakit", "amount": 140]),
        tx(["id": "6", "description": "Starbucks", "categoryId": "kahve", "accountId": "nakit", "amount": 130]),
        tx(["id": "7", "description": "Maaş", "type": "income", "categoryId": "maas", "accountId": "banka", "amount": 50000]),
        tx(["id": "8", "description": "Taksit", "installGroupId": "g", "categoryId": "x", "amount": 10]),
    ]

    @Test func ayniAciklamaTekOneriEnYeniAlanlarla() {
        let s = Suggestions.matching("mig", in: txs)
        #expect(s.count == 1)
        #expect(s[0].description == "Migros")
        #expect(s[0].categoryId == "market")   // en yeni satırdan
        #expect(s[0].accountId == "kart")
        #expect(s[0].count == 2)
    }

    @Test func baslayanlarOnceSonraSiklik() {
        // "kahve" → "Kahve Dünyası" başlıyor; Starbucks içermiyor
        #expect(Suggestions.matching("kah", in: txs).map(\.description) == ["Kahve Dünyası"])
        // "s" tek harf → öneri yok
        #expect(Suggestions.matching("s", in: txs).isEmpty)
        // "ar" → Starbucks (3 kez) içeren; Maaş içermez
        #expect(Suggestions.matching("ar", in: txs).map(\.description) == ["Starbucks"])
    }

    @Test func gelirTuruKorunurBagliSatirlarAtlanir() {
        let s = Suggestions.matching("maa", in: txs)
        #expect(s.first?.type == .income)
        #expect(Suggestions.matching("taks", in: txs).isEmpty)
    }

    @Test func birebirAyniysaGosterilmez() {
        #expect(Suggestions.matching("starbucks", in: txs).isEmpty)
    }

    @Test func turkceBuyukKucukHarf() {
        let list = [tx(["description": "İKEA", "categoryId": "ev"])]
        #expect(Suggestions.matching("ike", in: list).count == 1)
        #expect(Suggestions.exactCategory("ikea", type: .expense, in: list) == "ev")
        #expect(Suggestions.exactCategory("ikea", type: .income, in: list) == nil)
    }
}

@Suite("öneri dizini")
struct SuggestionIndexTests {
    /// Dizin, doğrudan tarama ile aynı sonucu vermeli
    @Test func taramaylaAyni() {
        let base = SuggestionsTests()
        let idx = Suggestions.Index(base.txs)
        for q in ["mig", "kah", "ar", "maa", "taks", "starbucks", "s"] {
            #expect(idx.matching(q) == Suggestions.matching(q, in: base.txs), "\(q)")
        }
        let list = [tx(["description": "İKEA", "categoryId": "ev"])]
        let i2 = Suggestions.Index(list)
        #expect(i2.exactCategory("ikea", type: .expense) == "ev")
        #expect(i2.exactCategory("ikea", type: .income) == nil)
    }
}
