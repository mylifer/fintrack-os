import Foundation

/* ── İade — web src/components/transactions/RefundModal.tsx ─────────────────
   Orijinal gider DEĞİŞMEZ; YENİ bir gider satırı NEGATİF tutarla yazılır
   (refundOfId → orijinal). Tüm toplamlar (bakiye, kategori, rapor) iadeyi
   harcamadan düşer; gelir şişmez. Aynı işleme yapılan iadelerin toplamı
   orijinal tutarı aşamaz. Bölünmüş kategoride paylar orantılı geri alınır.
─────────────────────────────────────────────────────────────────────────── */

public enum Refund {
    public static let tag = "#İade"

    /// İade edilebilir mi (web: gider ve pozitif tutar)
    public static func canRefund(_ t: Transaction) -> Bool {
        t.type == .expense && t.amount > 0 && t.isLive && t.plannedRecurringId == nil
    }

    /// Kalan iade edilebilir tutar (orijinal − önceki iadeler)
    public static func remaining(_ original: Transaction, in txs: [Transaction]) -> Double {
        let done = Money.sum(txs.filter { $0.isLive && $0.refundOfId == original.id }) { abs($0.amount) }
        return max(0, Money.sub(abs(original.amount), done))
    }

    /// Payları yeni tutara orantılı ölçekle (web rescaleSplits); son paya kalan
    public static func rescaleSplits(_ splits: [CategorySplit], to next: Double) -> [CategorySplit] {
        guard !splits.isEmpty else { return [] }
        let oldMinor = splits.reduce(0) { $0 + Money.toMinor($1.amount) }
        let nextMinor = Money.toMinor(next)
        if oldMinor == 0 {
            let parts = Money.split(next, splits.count)
            return zip(splits, parts).map { CategorySplit(categoryId: $0.categoryId, amount: $1) }
        }
        var acc = 0
        return splits.enumerated().map { i, s in
            if i == splits.count - 1 { return CategorySplit(categoryId: s.categoryId, amount: Money.toMajor(nextMinor - acc)) }
            let part = Money.safeInt(Money.jsRound(Double(nextMinor) * Double(Money.toMinor(s.amount)) / Double(oldMinor)))
            acc += part
            return CategorySplit(categoryId: s.categoryId, amount: Money.toMajor(part))
        }
    }

    public enum RefundError: LocalizedError, Equatable {
        case alreadyRefunded, amount, exceeds(Double)
        public var errorDescription: String? {
            switch self {
            case .alreadyRefunded: "Bu işlem zaten tamamen iade edilmiş."
            case .amount: "Geçerli bir tutar girin."
            case .exceeds(let r): "İade tutarı kalan iade edilebilir tutarı (\(Fmt.amountInput(r))) aşamaz."
            }
        }
    }

    /// İade satırı. `amount` nil = tam iade (kalan tutar).
    public static func make(_ original: Transaction, amount: Double?, date: String, all: [Transaction], fx: FX,
                            now: String, id: String = UUID().uuidString.lowercased(),
                            today: String = DateUtil.today()) throws -> Transaction {
        let rem = remaining(original, in: all)
        guard rem > 0 else { throw RefundError.alreadyRefunded }
        let value = amount ?? rem
        guard value > 0 else { throw RefundError.amount }
        if value > rem + 0.005 { throw RefundError.exceeds(rem) }
        let neg = -abs(value)
        var raw: JSONObject = [
            "id": .string(id), "type": "expense", "amount": .number(neg),
            "currency": .string(original.currency.rawValue), "date": .string(date),
            "accountId": .string(original.accountId), "categoryId": JSONValue(original.categoryId),
            "merchant": JSONValue(original.merchant), "description": .string("[İade] \(original.description)"),
            "refundOfId": .string(original.id),
            "tags": .array(Tags.dedupe((original.tags ?? []) + [tag]).map { .string($0) }),
            "familyMemberId": JSONValue(original.familyMemberId), "recipientId": JSONValue(original.recipientId),
            "isInstallment": .bool(false), "createdAt": .string(now), "updatedAt": .string(now),
            "deleted_at": .null, "workspaceId": JSONValue(original.workspaceId),
        ]
        if let s = original.categorySplits, s.count > 1 {
            raw["categorySplits"] = .array(rescaleSplits(s, to: neg).map {
                .object(["categoryId": .string($0.categoryId), "amount": .number($0.amount)])
            })
        }
        if let snap = fx.baseSnapshot(neg, original.currency) { raw["amountTry"] = .number(snap) }
        if date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
        return Transaction(raw: raw)
    }
}

extension Transaction {
    /// Yalnız iade bağı olan satır: silinebilir (yan etkisi yok — web)
    public var isPlainRefund: Bool {
        refundOfId != nil && debtId == nil && debtPrincipalId == nil && installGroupId == nil && !isInstallment
            && workspaceTransferId == nil && icon == nil && systemKind == nil
    }
}
