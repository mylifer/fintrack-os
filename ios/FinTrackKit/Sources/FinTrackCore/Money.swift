import Foundation

/// Para hesabı — web'deki src/lib/utils/money.ts'in birebir karşılığı (S8).
/// Tutarlar 2 haneye yuvarlı Double saklanır; TOPLAMA her zaman tam sayı
/// kuruşta yapılır ve sonda Double'a döner.
public enum Money {
    /// JS `Math.round` ile aynı: .5 her zaman +∞ yönüne (Swift'in `.rounded()`ı
    /// negatifte sıfırdan uzağa yuvarlar, -0.5 → -1; JS'te -0).
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    public static func toMinor(_ amount: Double) -> Int {
        Int(jsRound((amount + Double.ulpOfOne) * 100))
    }

    public static func toMajor(_ minor: Int) -> Double { Double(minor) / 100 }

    public static func round(_ amount: Double) -> Double { toMajor(toMinor(amount)) }

    public static func sum<S: Sequence>(_ items: S, _ select: (S.Element) -> Double) -> Double {
        var acc = 0
        for item in items { acc += toMinor(select(item)) }
        return toMajor(acc)
    }

    public static func sum(_ amounts: [Double]) -> Double { sum(amounts) { $0 } }

    public static func add(_ a: Double, _ b: Double) -> Double { toMajor(toMinor(a) + toMinor(b)) }
    public static func sub(_ a: Double, _ b: Double) -> Double { toMajor(toMinor(a) - toMinor(b)) }

    /// Tutarı birimsiz bir çarpanla (kur, %) çarpar, kuruşa yuvarlar.
    public static func mul(_ amount: Double, _ factor: Double) -> Double {
        toMajor(Int(jsRound(Double(toMinor(amount)) * factor)))
    }

    /// Toplamı `count` parçaya böler; kuruş kalanı ilk parçalara gider.
    public static func split(_ total: Double, _ count: Int) -> [Double] {
        let totalMinor = toMinor(total)
        let per = Int((Double(totalMinor) / Double(count)).rounded(.down))
        let remainder = totalMinor - per * count
        return (0..<count).map { toMajor(per + ($0 < remainder ? 1 : 0)) }
    }
}
