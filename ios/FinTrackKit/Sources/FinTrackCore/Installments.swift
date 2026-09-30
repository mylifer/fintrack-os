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
        let tags = draft.isSubscription ? [Subscriptions.tag] : []
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
