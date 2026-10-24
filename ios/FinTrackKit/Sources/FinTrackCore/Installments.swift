import Foundation

/// Taksitli satın almaların RAPOR görünümü — web src/lib/utils/installments.ts
/// `collapseInstallments` karşılığı.
///
/// Aynı `installGroupId`'li satırlar tek türev satıra iner: tarih = ilk taksitin
/// (satın almanın) tarihi, tutar = grubun TAMAMI (gelecek taksitler dahil).
/// Yalnız ANALİTİK toplamlarda kullanılır (aylık gelir/gider, kategori dağılımı,
/// bütçeler); bakiye ve limit HAM satırları okur. Türev satırlar asla yazılmaz.
public enum Installments {
    public static func collapse(_ txs: [Transaction], fx: FX = FX()) -> [Transaction] {
        var groups: [String: [Transaction]] = [:]
        for t in txs { if let g = t.installGroupId { groups[g, default: []].append(t) } }
        if groups.isEmpty { return txs }

        var collapsed: [String: Transaction] = [:]
        for (gid, rows) in groups {
            var head = rows[0]
            for t in rows {
                let ti = t.installIndex ?? Int.max
                let hi = head.installIndex ?? Int.max
                if ti < hi || (ti == hi && t.date < head.date) { head = t }
            }
            var amountMinor = 0
            var baseMinor = 0
            for t in rows {
                amountMinor += Money.toMinor(t.amount)
                baseMinor += Money.toMinor(fx.baseAmount(t))
            }
            var raw = head.raw
            raw["amount"] = .number(Money.toMajor(amountMinor))
            raw["amountTry"] = .number(Money.toMajor(baseMinor))
            raw["installTotal"] = .number(Double(head.installTotal ?? rows.count))
            raw.removeValue(forKey: "installIndex")
            collapsed[gid] = Transaction(raw: raw)
        }

        var out: [Transaction] = []
        var emitted = Set<String>()
        for t in txs {
            guard let g = t.installGroupId else { out.append(t); continue }
            if emitted.insert(g).inserted { out.append(collapsed[g]!) }
        }
        return out
    }
}

// MARK: - Taksitli alışveriş oluşturma (web transactions.store addInstallmentGroup)

extension Installments {
    public static let countRange = 2...60

    public enum InstallmentError: LocalizedError {
        case count, amount, account, category, description
        public var errorDescription: String? {
            switch self {
            case .count: "Taksit sayısı 2–60 arası olmalı."
            case .amount: "Tutar girin."
            case .account: "Hesap seçin."
            case .category: "Taksitli işlem için kategori seçin."
            case .description: "Taksitli işlem için açıklama girin."
            }
        }
    }

    /// Toplam `draft.amount` N taksite bölünür (kuruş hassas; artan kuruşlar İLK
    /// taksitlere — web splitMoney). Tarihler satın alma gününden aylık, ay sonuna
    /// kırpılarak (31 Oca → 28 Şub → 31 Mar); karttaki kesim döngüsüyle ilgisi yok.
    /// Açıklamaya "(1/6)" eklenmez (rozet installIndex/installTotal'dan). Hepsi
    /// "onaylı" doğar — taksit satırları onay beklemez.
    public static func makeGroup(_ draft: TransactionDraft, count: Int, account: Account, workspaceId: String?,
                                 fx: FX, now: String, groupId: String = UUID().uuidString.lowercased(),
                                 ids: [String]? = nil) throws -> [Transaction] {
        guard countRange.contains(count) else { throw InstallmentError.count }
        guard draft.amount > 0 else { throw InstallmentError.amount }
        guard draft.categoryId != nil else { throw InstallmentError.category }
        let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty else { throw InstallmentError.description }
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let amounts = Money.split(draft.amount, count)
        let tags = draft.tagsForWrite()   // web: taksitler formun etiketlerini taşır
        let start = DateUtil.calendar.startOfDay(for: draft.date)
        return (0..<count).map { i in
            let date = DateUtil.calendar.date(byAdding: .month, value: i, to: start) ?? start
            var raw: JSONObject = [
                "id": .string(ids?[i] ?? UUID().uuidString.lowercased()),
                "type": .string(TransactionType.expense.rawValue), "amount": .number(amounts[i]),
                "currency": .string(account.currency.rawValue), "date": .string(DateUtil.day(date)),
                "accountId": .string(account.id), "toAccountId": .null, "categoryId": JSONValue(draft.categoryId),
                "categorySplits": .null, "description": .string(description),
                "notes": JSONValue(notes.isEmpty ? nil : notes),
                "tags": tags.isEmpty ? .null : .array(tags.map { .string($0) }),
                "isInstallment": .bool(true), "installGroupId": .string(groupId),
                "installIndex": .number(Double(i + 1)), "installTotal": .number(Double(count)),
                "approvalStatus": .string(ApprovalStatus.approved.rawValue), "approvedAt": .string(now),
                "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
                "workspaceId": JSONValue(workspaceId),
                "familyMemberId": JSONValue(draft.familyMemberId), "recipientId": JSONValue(draft.recipientId),
            ]
            if let snap = fx.baseSnapshot(amounts[i], account.currency) { raw["amountTry"] = .number(snap) }
            return Transaction(raw: raw)
        }
    }
}

extension Transaction {
    /// Yalnız taksit grubuna bağlı (borç, çalışma alanı transferi, sistem, yatırım
    /// bağı yok) satır: iOS TÜM grubu silebilir (web remove ile aynı).
    public var isPlainInstallment: Bool {
        (installGroupId != nil) && debtId == nil && debtPrincipalId == nil && workspaceTransferId == nil
            && systemKind == nil && icon == nil && refundOfId == nil
    }
}

// MARK: - Taksit grubunu düzenleme / sonradan taksitlendirme
// web transactions.store updateInstallmentGroup + convertToInstallmentGroup

extension Installments {
    /// Grubun canlı satırları, taksit sırasıyla
    public static func groupRows(_ groupId: String, in txs: [Transaction]) -> [Transaction] {
        txs.filter { $0.isLive && $0.installGroupId == groupId }.sorted { ($0.installIndex ?? 0) < ($1.installIndex ?? 0) }
    }

    /// Sonradan taksitlendirilebilir mi (web convertibleTx): düz, pozitif gider
    public static func isConvertible(_ t: Transaction) -> Bool {
        t.type == .expense && t.amount > 0 && !t.isInstallment && t.installGroupId == nil && t.debtId == nil
            && t.workspaceTransferId == nil && t.systemKind == nil && t.refundOfId == nil && t.icon == nil
            && t.debtPrincipalId == nil && t.isLive
    }

    public struct Regroup: Sendable {
        /// Yazılacaklar (güncellenen + yeni), taksit sırasıyla
        public var rows: [Transaction]
        /// Taksit sayısı azaldıysa silinecekler (tombstone)
        public var removed: [Transaction]
    }

    /// `existing`: grubun mevcut satırları (sıralı) ya da dönüştürülecek tekil satır.
    /// Girilen tutar TOPLAMDIR; ilk taksitin tarihi formun tarihi, sonra +1 ay.
    /// `newIds`: eklenecek satırların kimlikleri (tekrar denemede aynı satırlar).
    public static func regroup(_ draft: TransactionDraft, count: Int, existing: [Transaction], account: Account,
                               fx: FX, now: String, groupId: String, newIds: [String]) throws -> Regroup {
        guard countRange.contains(count) else { throw InstallmentError.count }
        guard draft.amount > 0 else { throw InstallmentError.amount }
        let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty else { throw InstallmentError.description }
        guard let head = existing.first else { throw InstallmentError.count }
        let total = abs(draft.amount)
        let amounts = Money.split(total, count)
        let notes = draft.notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let hadSub = Subscriptions.hasSubscriptionTag(head.tags)
        let tags = draft.tagsForWrite(hadSubscription: hadSub)
        let splits = draft.splits.flatMap { $0.count >= 2 ? $0 : nil }
        let start = DateUtil.calendar.startOfDay(for: draft.date)
        var rows: [Transaction] = []
        for i in 0..<count {
            let date = DateUtil.day(DateUtil.calendar.date(byAdding: .month, value: i, to: start) ?? start)
            let base = i < existing.count ? existing[i] : head
            var raw = base.raw
            let shared: JSONObject = [
                "type": "expense", "currency": .string(account.currency.rawValue), "accountId": .string(account.id),
                "toAccountId": .null, "description": .string(description),
                "notes": notes.isEmpty ? .null : .string(notes),
                "tags": tags.isEmpty ? .null : .array(tags.map { .string($0) }),
                "familyMemberId": JSONValue(draft.familyMemberId), "recipientId": JSONValue(draft.recipientId),
                "amount": .number(amounts[i]), "date": .string(date), "isInstallment": .bool(true),
                "installTotal": .number(Double(count)), "installIndex": .number(Double(i + 1)),
                "installGroupId": .string(groupId),
            ]
            for (k, v) in shared { raw[k] = v }
            if let splits {
                let scaled = Refund.rescaleSplits(splits, to: amounts[i])
                raw["categorySplits"] = TransactionDraft.splitsJSON(scaled)
                raw["categoryId"] = JSONValue(TransactionDraft.primaryCategory(scaled))
            } else {
                raw["categorySplits"] = .null
                raw["categoryId"] = JSONValue(draft.categoryId)
            }
            // TL değeri yalnız tutar/para birimi değiştiyse yeniden (kuruş düzeyinde kıyas)
            if i >= existing.count || Money.toMinor(base.amount) != Money.toMinor(amounts[i]) || base.currency != account.currency {
                raw["amountTry"] = JSONValue(fx.baseSnapshot(amounts[i], account.currency))
            }
            if i >= existing.count {
                // Yeni taksit: onay beklemez (web 'approved')
                raw["id"] = .string(newIds[i - existing.count])
                raw["approvalStatus"] = .string(ApprovalStatus.approved.rawValue)
                raw["approvedAt"] = .string(now)
                raw["createdAt"] = .string(now)
                raw["deleted_at"] = .null
            }
            rows.append(Transaction(raw: raw))
        }
        let removed = existing.count > count ? existing[count...].map { $0.tombstoned(at: now) } : []
        return Regroup(rows: rows, removed: Array(removed))
    }
}
