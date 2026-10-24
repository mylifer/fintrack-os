import Foundation

/// Etiketler — web src/lib/utils/tags.ts birebir. Serbest metin; kullanıcının
/// yazdığı biçim korunur ama gruplama/eşleştirme Türkçe küçük harf anahtarıyla
/// yapılır ("Tatil" ile "tatil" tek etiket).
public enum Tags {
    static let tr = Locale(identifier: "tr_TR")

    /// Baş/son boşluk kırpılır, iç boşluklar teke iner. Boş girişte "".
    public static func normalize(_ raw: String) -> String {
        raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Büyük/küçük harf duyarsız anahtar (Türkçe yerel ayar).
    public static func key(_ tag: String) -> String {
        normalize(tag).lowercased(with: tr)
    }

    /// Boşları ve anahtarı aynı tekrarları at; ilk görülen yazım kalır.
    public static func dedupe(_ tags: [String]) -> [String] {
        var seen: Set<String> = []
        var out: [String] = []
        for t in tags {
            let n = normalize(t)
            guard !n.isEmpty, seen.insert(key(n)).inserted else { continue }
            out.append(n)
        }
        return out
    }

    public struct Aggregate: Sendable, Equatable, Identifiable {
        /// görünen ad (en sık kullanılan yazım)
        public var tag: String
        public var key: String
        public var count: Int
        public var income: Double
        public var expense: Double
        /// gelir + gider (transfer hariç)
        public var volume: Double
        public var id: String { key }
    }

    /// Kullanılan tüm etiketler. İşlem bir etiketi iki kez taşısa da bir kez
    /// sayılır. Tutarlar TRY (baseAmount), kuruş hassas. Bakiye eşitleme
    /// satırları tamamen dışarıda (#BakiyeEşitleme hiç görünmez).
    /// Sıra: işlem sayısı ↓, hacim ↓, ad (tr).
    public static func aggregate(_ txs: [Transaction], fx: FX) -> [Aggregate] {
        struct Acc {
            var count = 0, income = 0, expense = 0
            var casings: [(String, Int)] = []   // ilk görülme sırasıyla
        }
        var map: [String: Acc] = [:]
        var order: [String] = []
        for t in txs {
            guard let tags = t.tags, !tags.isEmpty, !Calc.isReconciliation(t) else { continue }
            var seenInTx: Set<String> = []
            for raw in tags {
                let n = normalize(raw)
                guard !n.isEmpty else { continue }
                let k = key(n)
                guard seenInTx.insert(k).inserted else { continue }
                if map[k] == nil { map[k] = Acc(); order.append(k) }
                map[k]!.count += 1
                if t.type == .income { map[k]!.income += Money.toMinor(fx.baseAmount(t)) }
                if t.type == .expense { map[k]!.expense += Money.toMinor(fx.baseAmount(t)) }
                if let i = map[k]!.casings.firstIndex(where: { $0.0 == n }) {
                    map[k]!.casings[i].1 += 1
                } else {
                    map[k]!.casings.append((n, 1))
                }
            }
        }
        var result: [Aggregate] = order.map { k in
            let a = map[k]!
            var best = "", bestN = -1
            for (c, n) in a.casings where n > bestN { best = c; bestN = n }
            return Aggregate(tag: best, key: k, count: a.count, income: Money.toMajor(a.income),
                             expense: Money.toMajor(a.expense), volume: Money.toMajor(a.income + a.expense))
        }
        result.sort {
            if $0.count != $1.count { return $0.count > $1.count }
            if $0.volume != $1.volume { return $0.volume > $1.volume }
            return $0.tag.compare($1.tag, locale: tr) == .orderedAscending
        }
        return result
    }

    /// İşlem bu etiketi (anahtar eşleşmesiyle) taşıyor mu?
    public static func has(_ t: Transaction, key k: String) -> Bool {
        t.tags?.contains { key($0) == k } ?? false
    }

    static let palette = ["#E4572E", "#F3A712", "#3B82F6", "#10B981",
                          "#8B5CF6", "#EC4899", "#0EA5E9", "#EAB308"]

    /// Etikete sabit renk (web tagColor: UTF-16 üzerinden 32 bit hash).
    public static func color(_ key: String) -> String {
        var hash: Int32 = 0
        for c in key.utf16 { hash = hash &* 31 &+ Int32(c) }
        return palette[Int(Int64(hash).magnitude % UInt64(palette.count))]
    }
}
