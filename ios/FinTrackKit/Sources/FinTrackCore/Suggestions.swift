import Foundation

/// Hızlı ekleme önerileri: kullanıcının geçmiş işlemlerinden, yazdığı açıklamayla
/// eşleşen kalıplar. Seçilen öneri açıklamayı, türü, kategoriyi ve hesabı doldurur
/// (tutar kullanıcıya kalır). Yalnız iOS'ta — web'de karşılığı yok, yazma kuralı
/// değiştirmez.
public enum Suggestions {
    public struct Item: Hashable, Sendable {
        public var description: String
        public var type: TransactionType
        public var categoryId: String?
        public var accountId: String
        public var lastAmount: Double
        public var count: Int
        /// Web önerisi gibi kişiler de en son işlemden
        public var familyMemberId: String? = nil
        public var recipientId: String? = nil
    }

    static let tr = Locale(identifier: "tr_TR")
    static func key(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            .lowercased(with: tr)
    }

    /// Tekil açıklamaların dizini — 20 bin işlemde her tuşta tüm açıklamaları
    /// yeniden normalleştirmemek için veri değişince bir kez kurulur.
    public struct Index: Sendable {
        struct Entry: Sendable { var key: String; var item: Item; var order: Int }
        var entries: [Entry] = []
        /// "<tür>|<anahtar>" → en yeni kategorili satırın kategorisi
        var exact: [String: String] = [:]

        public init() {}

        public init(_ txs: [Transaction]) {
            var byKey: [String: Int] = [:]
            for t in txs where t.type != .transfer && !t.isLinked && !t.description.isEmpty {
                let k = Suggestions.key(t.description)
                if let c = t.categoryId, exact["\(t.type.rawValue)|\(k)"] == nil { exact["\(t.type.rawValue)|\(k)"] = c }
                if let i = byKey[k] {
                    entries[i].item.count += 1
                } else {
                    byKey[k] = entries.count
                    entries.append(Entry(key: k, item: Item(
                        description: t.description.trimmingCharacters(in: .whitespacesAndNewlines),
                        type: t.type, categoryId: t.categoryId, accountId: t.accountId,
                        lastAmount: t.amount, count: 1,
                        familyMemberId: t.familyMemberId, recipientId: t.recipientId), order: entries.count))
                }
            }
        }

        public func matching(_ query: String, limit: Int = 3) -> [Item] {
            let q = Suggestions.key(query)
            guard q.count >= 2 else { return [] }
            let hits = entries.filter { $0.key.contains(q) }
            let ranked = hits.sorted { a, b in
                let pa = a.key.hasPrefix(q), pb = b.key.hasPrefix(q)
                if pa != pb { return pa }
                if a.item.count != b.item.count { return a.item.count > b.item.count }
                return a.order < b.order
            }
            if ranked.count == 1, ranked[0].key == q { return [] }
            return ranked.prefix(limit).map(\.item)
        }

        public func exactCategory(_ description: String, type: TransactionType) -> String? {
            let q = Suggestions.key(description)
            return q.isEmpty ? nil : exact["\(type.rawValue)|\(q)"]
        }
    }

    /// `txs` tarih ↓ sıralı (AppModel.transactions). Aynı açıklama tek öneri olur;
    /// alanları EN SON işlemden gelir. Önce açıklaması sorguyla BAŞLAYANLAR, sonra
    /// içerenler; her grupta sık kullanılan önce. Sorguyla birebir aynı olan tek
    /// öneri gösterilmez (zaten yazılmış).
    public static func matching(_ query: String, in txs: [Transaction], limit: Int = 3) -> [Item] {
        let q = key(query)
        guard q.count >= 2 else { return [] }
        var byKey: [String: Item] = [:]
        var order: [String] = []
        for t in txs where t.type != .transfer && !t.isLinked && !t.description.isEmpty {
            let k = key(t.description)
            guard k.contains(q) else { continue }
            if var it = byKey[k] {
                it.count += 1
                byKey[k] = it
            } else {
                byKey[k] = Item(description: t.description.trimmingCharacters(in: .whitespacesAndNewlines),
                                type: t.type, categoryId: t.categoryId, accountId: t.accountId,
                                lastAmount: t.amount, count: 1,
                                familyMemberId: t.familyMemberId, recipientId: t.recipientId)
                order.append(k)
            }
        }
        let ranked = order.enumerated().sorted { a, b in
            let pa = a.element.hasPrefix(q), pb = b.element.hasPrefix(q)
            if pa != pb { return pa }
            let ca = byKey[a.element]!.count, cb = byKey[b.element]!.count
            if ca != cb { return ca > cb }
            return a.offset < b.offset   // daha yeni önce
        }
        let items = ranked.map { byKey[$0.element]! }
        if items.count == 1, key(items[0].description) == q { return [] }
        return Array(items.prefix(limit))
    }

    /// Açıklama birebir eşleşiyorsa (kategori seçilmemişken) otomatik kategori.
    public static func exactCategory(_ description: String, type: TransactionType, in txs: [Transaction]) -> String? {
        let q = key(description)
        guard !q.isEmpty else { return nil }
        return txs.first { $0.type == type && !$0.isLinked && $0.categoryId != nil && key($0.description) == q }?.categoryId
    }
}
