import Foundation

/// Bakiye eşitleme — web ReconcileBalanceModal. Kullanıcı gerçek bakiyeyi girer;
/// uygulamadaki (işlenmiş) bakiyeyle farkı tek satır olarak yazılır. Satır
/// gelir/gider akışına, bütçelere ve raporlara GİRMEZ (systemKind
/// 'reconciliation'); yalnız bakiyeyi düzeltir. Kart ekstresi ve Ödeme Takibi
/// yalnız systemKind'e baktığı için etiket tek başına yetmez.
public enum Reconcile {
    public enum ReconcileError: LocalizedError, Equatable {
        case alreadyBalanced
        public var errorDescription: String? { "Bakiye zaten güncel — düzeltme gerekmiyor." }
    }

    /// Kartta girilen tutar BORÇ olarak (eksi) alınır; diğerlerinde işaretiyle.
    public static func actualSigned(_ input: Double, account: Account) -> Double {
        account.type == .credit_card ? -abs(input) : input
    }

    /// Fark (hesabın para biriminde, JS Math.round ile iki hane)
    public static func delta(actual: Double, balance: Double) -> Double {
        Money.jsRound((actual - balance) * 100) / 100
    }

    public static func make(account: Account, input: Double, balance: Double, fx: FX, workspaceId: String?,
                            now: String, id: String = UUID().uuidString.lowercased(),
                            today: String = DateUtil.today()) throws -> Transaction {
        let d = delta(actual: actualSigned(input, account: account), balance: balance)
        guard d != 0 else { throw ReconcileError.alreadyBalanced }
        let amount = abs(d)
        var raw: JSONObject = [
            "id": .string(id), "type": .string(d > 0 ? TransactionType.income.rawValue : TransactionType.expense.rawValue),
            "amount": .number(amount), "currency": .string(account.currency.rawValue), "date": .string(today),
            "accountId": .string(account.id), "description": "Sistem: Bakiye Eşitleme",
            "systemKind": "reconciliation", "tags": .array(["#BakiyeEşitleme"]),
            "familyMemberId": .null, "recipientId": .null, "isInstallment": .bool(false),
            "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        if let snap = fx.baseSnapshot(amount, account.currency) { raw["amountTry"] = .number(snap) }
        return Transaction(raw: raw)
    }
}

extension Transaction {
    /// Yalnız bakiye eşitleme satırı (başka bağı yok): web gibi silinebilir, yan etkisiz.
    public var isPlainReconciliation: Bool {
        systemKind == "reconciliation" && debtId == nil && debtPrincipalId == nil && installGroupId == nil
            && !isInstallment && workspaceTransferId == nil && icon == nil && refundOfId == nil
    }
}
