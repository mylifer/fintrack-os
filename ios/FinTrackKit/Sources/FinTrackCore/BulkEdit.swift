import Foundation

/* ── Toplu düzenleme ve etiket yeniden adlandırma — web transactions.store
   updateMany + renameTag ─────────────────────────────────────────────────── */

public enum BulkEdit {
    public struct Patch: Equatable, Sendable {
        /// nil = dokunma; .some(nil) = temizle
        public var categoryId: String??
        public var familyMemberId: String??
        public var recipientId: String??
        public var date: String?
        public var addTags: [String]

        public init(categoryId: String?? = nil, familyMemberId: String?? = nil, recipientId: String?? = nil,
                    date: String? = nil, addTags: [String] = []) {
            self.categoryId = categoryId; self.familyMemberId = familyMemberId; self.recipientId = recipientId
            self.date = date; self.addTags = addTags
        }

        public var isEmpty: Bool {
            categoryId == nil && familyMemberId == nil && recipientId == nil && date == nil
                && addTags.allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        }
    }

    /// Satıra yamayı uygula. Kategori atanırsa paylar temizlenir (tek kategoriye iner).
    public static func apply(_ t: Transaction, _ p: Patch) -> Transaction {
        var raw = t.raw
        if let c = p.categoryId {
            raw["categoryId"] = JSONValue(c)
            if (t.categorySplits?.count ?? 0) > 0 { raw["categorySplits"] = .null }
        }
        if let f = p.familyMemberId { raw["familyMemberId"] = JSONValue(f) }
        if let r = p.recipientId { raw["recipientId"] = JSONValue(r) }
        if let d = p.date { raw["date"] = .string(d) }
        let add = p.addTags.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !add.isEmpty {
            var seen = Set<String>(), out: [String] = []
            for x in (t.tags ?? []) + add where seen.insert(x).inserted { out.append(x) }
            raw["tags"] = .array(out.map { .string($0) })
        }
        return Transaction(raw: raw)
    }

    /// Toplu düzenlemeye uygun mu: kategori/kişi/tarih değişimi yan etki doğurmayan satırlar
    public static func canEdit(_ t: Transaction) -> Bool {
        t.isLive && t.plannedRecurringId == nil && t.systemKind == nil && t.icon == nil && t.workspaceTransferId == nil
    }

    /// Etiketi yeniden adlandır (büyük/küçük harf duyarsız eşleşme); yeni ad başka bir
    /// etiketle çakışırsa ikisi birleşir. Değişen satırlar döner.
    public static func renameTag(_ old: String, to new: String, in txs: [Transaction]) -> [Transaction] {
        let from = Tags.key(old), to = Tags.normalize(new)
        guard !from.isEmpty, !to.isEmpty else { return [] }
        return txs.compactMap { t in
            guard t.isLive, let tags = t.tags, tags.contains(where: { Tags.key($0) == from }) else { return nil }
            var raw = t.raw
            raw["tags"] = .array(Tags.dedupe(tags.map { Tags.key($0) == from ? to : $0 }).map { .string($0) })
            return Transaction(raw: raw)
        }
    }
}
