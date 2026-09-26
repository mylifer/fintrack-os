import Foundation

/// İşlem araması — web src/lib/utils/txSearch.ts: açıklama, satıcı, not, etiket,
/// tutar ve kategori / hesap ADLARI eşleşir. Türkçe büyük-küçük harf duyarsız.
public enum TxSearch {
    static let tr = Locale(identifier: "tr_TR")
    static func lc(_ s: String) -> String { s.lowercased(with: tr) }

    public static func matcher(_ query: String, categories: [Category], accounts: [Account]) -> (Transaction) -> Bool {
        let q = lc(query.trimmingCharacters(in: .whitespacesAndNewlines))
        if q.isEmpty { return { _ in true } }
        let categoryIds = Set(categories.filter { lc($0.name).contains(q) }.map(\.id))
        let accountIds = Set(accounts.filter { lc($0.name).contains(q) }.map(\.id))

        return { t in
            if lc(t.description).contains(q) { return true }
            if let m = t.merchant, lc(m).contains(q) { return true }
            if let n = t.notes, lc(n).contains(q) { return true }
            if t.tags?.contains(where: { lc($0).contains(q) }) == true { return true }
            if jsNumberString(t.amount).contains(q) { return true }
            if String(format: "%.2f", t.amount).replacingOccurrences(of: ".", with: ",").contains(q) { return true }
            if let splits = t.categorySplits, !splits.isEmpty {
                if splits.contains(where: { categoryIds.contains($0.categoryId) }) { return true }
            } else if let c = t.categoryId, categoryIds.contains(c) { return true }
            if accountIds.contains(t.accountId) { return true }
            if let to = t.toAccountId, accountIds.contains(to) { return true }
            return false
        }
    }

    /// JS `String(1234.5)` → "1234.5", `String(100)` → "100".
    static func jsNumberString(_ d: Double) -> String {
        d == d.rounded() && abs(d) < 1e15 ? String(Int(d)) : String(d)
    }
}
