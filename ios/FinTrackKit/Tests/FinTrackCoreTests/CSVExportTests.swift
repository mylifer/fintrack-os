import Testing
@testable import FinTrackCore

@Suite("CSV dışa aktarma")
struct CSVExportTests {
    @Test func kacis() {
        #expect(CSVExport.escape("=HYPERLINK(\"x\")") == "\"'=HYPERLINK(\"\"x\"\")\"")
        #expect(CSVExport.escape("-250.00") == "-250.00")
        #expect(CSVExport.escape("-1+1") == "'-1+1")
        #expect(CSVExport.escape("Migros, Kadıköy") == "\"Migros, Kadıköy\"")
        #expect(CSVExport.escape("düz") == "düz")
    }

    @Test func satirlar() {
        let cats = [Category(raw: ["id": "c", "name": "Market"])]
        let accs = [Account(raw: ["id": "a", "name": "Kart"]), Account(raw: ["id": "b", "name": "Banka"])]
        let txs = [
            tx(["date": "2026-09-30", "description": "A101", "categoryId": "c", "amount": 1430.75, "accountId": "a",
                "tags": .array(["iş", "İŞ", "abonelik"])]),
            tx(["type": "transfer", "date": "2026-09-27", "description": "Kart ödemesi", "amount": 5000,
                "accountId": "b", "toAccountId": "a"]),
        ]
        let lines = CSVExport.transactions(txs, categories: cats, accounts: accs).split(separator: "\n")
        #expect(lines[0] == "Tarih,Açıklama,Kategori,Tutar,Tür,Para Birimi,Etiketler,Hesap,Karşı Hesap")
        #expect(lines[1] == "2026-09-30,A101,Market,1430.75,Gider,TRY,iş|abonelik,Kart,")
        #expect(lines[2] == "2026-09-27,Kart ödemesi,,5000.00,Transfer,TRY,,Banka,Kart")
    }
}
