import Foundation

/// İşlemleri CSV'ye — web src/lib/utils/csv.ts `transactionsToCsvString` ile aynı
/// sütunlar ve kaçış kuralları (iOS'tan alınan dosya web'e geri içe aktarılabilir).
public enum CSVExport {
    static let headers = ["Tarih", "Açıklama", "Kategori", "Tutar", "Tür", "Para Birimi", "Etiketler", "Hesap", "Karşı Hesap"]

    /// Formül enjeksiyonu koruması: = + - @ sekme/CR ile başlayan hücreye ' eklenir
    /// (düz sayılar hariç); virgül, tırnak, satır sonu varsa tırnak içine alınır.
    static func escape(_ value: String) -> String {
        var v = value
        let isPlainNumber = v.range(of: #"^-?\d+(\.\d+)?$"#, options: .regularExpression) != nil
        if let f = v.first, "=+-@\t\r".contains(f), !isPlainNumber { v = "'" + v }
        if v.contains(",") || v.contains("\"") || v.contains("\n") {
            return "\"" + v.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return v
    }

    /// Etiketler "|" ile, tekrarlar (büyük/küçük harf duyarsız) atılarak
    static func tagsCell(_ tags: [String]?) -> String {
        var seen = Set<String>()
        var out: [String] = []
        for t in tags ?? [] {
            let trimmed = t.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            let key = trimmed.lowercased(with: Locale(identifier: "tr_TR"))
            if trimmed.isEmpty || seen.contains(key) { continue }
            seen.insert(key)
            out.append(trimmed)
        }
        return out.joined(separator: "|")
    }

    public static func transactions(_ txs: [Transaction], categories: [Category], accounts: [Account]) -> String {
        let cat = Dictionary(categories.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let acc = Dictionary(accounts.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let rows = txs.map { t in
            [
                t.date,
                t.description,
                t.categoryId.flatMap { cat[$0] } ?? "",
                String(format: "%.2f", t.amount),
                t.type.label,
                t.currency.rawValue,
                tagsCell(t.tags),
                acc[t.accountId] ?? "",
                t.toAccountId.flatMap { acc[$0] } ?? "",
            ].map(escape).joined(separator: ",")
        }
        return ([headers.joined(separator: ",")] + rows).joined(separator: "\n")
    }
}
