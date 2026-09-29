import Testing
@testable import FinTrackCore

@Suite("bütçe formu")
struct BudgetDraftTests {
    let cats = [Category(raw: ["id": "m", "name": "Market"]), Category(raw: ["id": "y", "name": "Yemek"])]

    @Test func tekKategoriDuzKimlik() {
        var d = BudgetDraft(); d.categoryIds = ["m"]; d.amountText = "6.000"
        let row = d.build(editing: nil, categories: cats, workspaceId: "ws", id: "b1").rowForWrite(updatedAt: "N")
        #expect(row["categoryId"] == "m")
        #expect(row["categoryName"] == "Market")
        #expect(row["amount"] == 6000)
        #expect(row["period"] == "monthly")
        #expect(row["alertThreshold"] == 80)
        #expect(row["rollover"] == false)
        #expect(row["workspaceId"] == "ws")
    }

    @Test func cokKategoriJSONDizi() {
        var d = BudgetDraft(); d.categoryIds = ["m", "y"]; d.amountText = "100"; d.rollover = true
        let b = d.build(editing: nil, categories: cats, workspaceId: nil)
        #expect(b.categoryId == #"["m","y"]"#)
        #expect(b.categoryName == "Market, Yemek")
        #expect(Calc.budgetCategoryIds(b) == ["m", "y"])
    }

    @Test func duzenlemeEskiAlanlaraDokunmaz() {
        let old = Budget(raw: ["id": "b", "categoryId": "m", "amount": 500, "period": "monthly", "year": 2025,
                               "month": 3, "rollover": false, "alertThreshold": 90, "categoryName": "Market"])
        var d = BudgetDraft(editing: old)
        #expect(d.alertThreshold == 90)
        d.amountText = "750"
        let row = d.build(editing: old, categories: cats, workspaceId: nil).rowForWrite(updatedAt: "N")
        #expect(row["amount"] == 750)
        #expect(row["year"] == 2025)
        #expect(row["alertThreshold"] == 90)
    }

    @Test func dogrulama() {
        #expect(BudgetDraft().validationError() == "En az bir kategori seçin.")
        var d = BudgetDraft(); d.categoryIds = ["m"]
        #expect(d.validationError() == "Tutar girin.")
    }
}
