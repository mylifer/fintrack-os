import Foundation

/// Para biçimleri — web src/lib/utils/currency.ts karşılığı.
public enum Fmt {
    private static let locales: [CurrencyCode: String] = [.TRY: "tr_TR", .USD: "en_US", .EUR: "de_DE", .GBP: "en_GB"]

    private static func make(_ c: CurrencyCode, digits: Int) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: locales[c]!)
        f.currencyCode = c.rawValue
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        return f
    }

    nonisolated(unsafe) private static let full: [CurrencyCode: NumberFormatter] =
        Dictionary(uniqueKeysWithValues: CurrencyCode.allCases.map { ($0, make($0, digits: 2)) })
    nonisolated(unsafe) private static let whole: [CurrencyCode: NumberFormatter] =
        Dictionary(uniqueKeysWithValues: CurrencyCode.allCases.map { ($0, make($0, digits: 0)) })

    /// "Tutarları gizle" — açıkken tüm tutarlar "₺•••".
    nonisolated(unsafe) public static var amountsHidden = false

    public static func currency(_ amount: Double, _ c: CurrencyCode = .TRY) -> String {
        if amountsHidden { return "\(c.symbol)•••" }
        return full[c]!.string(from: NSNumber(value: amount.isFinite ? amount : 0)) ?? ""
    }

    public static func whole(_ amount: Double, _ c: CurrencyCode = .TRY) -> String {
        if amountsHidden { return "\(c.symbol)•••" }
        return whole[c]!.string(from: NSNumber(value: amount.isFinite ? amount : 0)) ?? ""
    }

    /// İşaretli tutar: negatifte U+2212 (−), pozitif/sıfırda +.
    public static func signed(_ v: Double, _ c: CurrencyCode = .TRY) -> String {
        "\(v < 0 ? "−" : "+")\(currency(abs(v), c))"
    }

    /// Tutar girişi: "1.234,56" (TR) / "1234.56" (EN) → 1234.56. Web parseCurrencyInput.
    public static func parseAmount(_ raw: String) -> Double {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        let negative = trimmed.hasPrefix("-")
        let abs = String(trimmed.drop(while: { $0 == "-" })).trimmingCharacters(in: .whitespaces)
        let normalized: String
        if abs.contains(",") {
            normalized = abs.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
        } else if abs.range(of: #"^\d{1,3}(\.\d{3})+$"#, options: .regularExpression) != nil {
            normalized = abs.replacingOccurrences(of: ".", with: "")
        } else {
            normalized = abs
        }
        guard let n = Double(normalized) else { return 0 }
        let rounded = (n * 100).rounded() / 100
        return negative ? -rounded : rounded
    }

    /// Kayıtlı sayıyı düzenleme alanına yazar: ondalık virgül, BİNLİK AYRAÇ YOK
    /// ("1234,56"). Ayraçlı "5.000" yazım dönüştürücüden geçince "5,000" = 5
    /// olarak okunuyordu — düzenlenen tutar bozuluyordu.
    public static func amountInput(_ n: Double) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "tr_TR")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        f.maximumFractionDigits = 2
        f.minimumFractionDigits = 0
        return f.string(from: NSNumber(value: n)) ?? ""
    }

    /// Tutar alanına yazılırken: ondalık ayraç virgül. Harici klavyeden/yapıştırmadan
    /// gelen tek "." virgüle çevrilir; ama metinde zaten virgül varsa ya da "."
    /// binlik ayraç biçimindeyse ("1.250.000") dokunulmaz.
    public static func normalizeTypedAmount(_ v: String) -> String {
        if v.contains(",") { return v }
        if v.range(of: #"^\d{1,3}(\.\d{3})+$"#, options: .regularExpression) != nil { return v }
        let dots = v.filter { $0 == "." }.count
        return dots == 1 ? v.replacingOccurrences(of: ".", with: ",") : v
    }
}
