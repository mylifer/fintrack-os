import Foundation

/* ── Çalışma alanları arası transfer — web transactions.store
   addCrossWorkspaceTransfer karşılığı ─────────────────────────────────────
   Kaynak alanda 'expense', hedef alanda 'income' olarak iki satır, ortak
   workspaceTransferId ile. "Borç öde" seçildiyse hedef alanda, giriş
   bacağının yattığı hesaptan sıradan bir borç ödemesi (debtId'li transfer)
   üçüncü satırdır — hedef hesabın bakiyesi net değişmez. Satırların hiçbiri
   akışa girmez (Calc.isWorkspaceTransfer). Herhangi bir bacak silinince hepsi
   silinir ve borç ödemesi geri alınır.
─────────────────────────────────────────────────────────────────────────── */

extension Transaction {
    /// Alanlar arası transferin bacağı (yalnız bu bağı taşıyan satır).
    public var isWorkspaceTransferLeg: Bool {
        workspaceTransferId != nil && debtPrincipalId == nil && installGroupId == nil && !isInstallment
            && systemKind == nil && refundOfId == nil
    }
}

public enum WorkspaceTransfer {
    public static let icon = "⇄"

    public struct Input: Sendable {
        public var source: Account
        public var sourceWorkspaceId: String
        public var target: Account
        public var targetWorkspaceId: String
        public var amount: Double          // kaynak hesabın para biriminde
        public var date: String
        public var description: String
        public var notes: String?
        public var targetDebt: Debt?

        public init(source: Account, sourceWorkspaceId: String, target: Account, targetWorkspaceId: String,
                    amount: Double, date: String, description: String, notes: String? = nil, targetDebt: Debt? = nil) {
            self.source = source; self.sourceWorkspaceId = sourceWorkspaceId
            self.target = target; self.targetWorkspaceId = targetWorkspaceId
            self.amount = amount; self.date = date; self.description = description
            self.notes = notes; self.targetDebt = targetDebt
        }
    }

    public enum TransferError: LocalizedError, Equatable {
        case amount, description, sameWorkspace, debt
        public var errorDescription: String? {
            switch self {
            case .amount: "Geçerli bir tutar girin."
            case .description: "Açıklama girin."
            case .sameWorkspace: "Hedef hesap başka bir çalışma alanında olmalı."
            case .debt: "Ödenecek borç bulunamadı."
            }
        }
    }

    /// Yazılacak satırlar (giden, gelen, isteğe bağlı borç ödemesi) ve borcun yeni hali.
    /// `ids`: [giden, gelen, ödeme, bağ] — tekrar denemede aynı satırlar güncellensin.
    public static func make(_ input: Input, fx: FX, now: String, ids: [String]) throws
        -> (rows: [Transaction], debt: Debt?) {
        let desc = input.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard input.amount > 0 else { throw TransferError.amount }
        guard !desc.isEmpty else { throw TransferError.description }
        guard input.sourceWorkspaceId != input.targetWorkspaceId else { throw TransferError.sameWorkspace }
        if let d = input.targetDebt, !d.owe || d.isSettled || !d.isLive { throw TransferError.debt }

        let srcCur = input.source.currency, dstCur = input.target.currency
        // Kalıcı TL değeri yalnız kur varken (web baseSnapshot); hedef tutar transfer
        // anında donar (iki bağımsız satır)
        let amountTry = fx.toBaseTry(input.amount, srcCur)
        let snap = fx.baseSnapshot(input.amount, srcCur)
        let targetAmount = dstCur == srcCur ? input.amount : fx.fromBaseTry(amountTry, dstCur)
        let linkId = ids[3]
        let notes = input.notes?.trimmingCharacters(in: .whitespacesAndNewlines)

        func row(_ id: String, type: TransactionType, amount: Double, currency: CurrencyCode, account: String,
                 ws: String, peer: String, withIcon: Bool) -> JSONObject {
            var raw: JSONObject = [
                "id": .string(id), "type": .string(type.rawValue), "amount": .number(amount),
                "amountTry": JSONValue(snap), "currency": .string(currency.rawValue),
                "date": .string(input.date), "accountId": .string(account),
                "description": .string(desc), "notes": JSONValue(notes?.isEmpty == false ? notes : nil),
                "isInstallment": .bool(false), "createdAt": .string(now), "updatedAt": .string(now),
                "deleted_at": .null, "workspaceId": .string(ws),
                "workspaceTransferId": .string(linkId), "peerWorkspaceId": .string(peer),
            ]
            if withIcon { raw["icon"] = .string(icon) }
            return raw
        }

        let outgoing = row(ids[0], type: .expense, amount: input.amount, currency: srcCur, account: input.source.id,
                           ws: input.sourceWorkspaceId, peer: input.targetWorkspaceId, withIcon: true)
        let incoming = row(ids[1], type: .income, amount: targetAmount, currency: dstCur, account: input.target.id,
                           ws: input.targetWorkspaceId, peer: input.sourceWorkspaceId, withIcon: true)
        var rows = [Transaction(raw: outgoing), Transaction(raw: incoming)]
        var debt: Debt?
        if let d = input.targetDebt {
            var pay = row(ids[2], type: .transfer, amount: targetAmount, currency: dstCur, account: input.target.id,
                          ws: input.targetWorkspaceId, peer: input.sourceWorkspaceId, withIcon: false)
            pay["debtId"] = .string(d.id)
            rows.append(Transaction(raw: pay))
            // Borç tutarları TL bazlı (web M4): ödeme satırının TL değeriyle aynı kural
            debt = d.applyingPayment(amountTry, installments: 1)
        }
        return (rows, debt)
    }

    /// Silinen satırların alanlar arası transfer karşı bacakları (tüm alanlarda; canlı).
    public static func peers(of group: [Transaction], in all: [Transaction]) -> [Transaction] {
        let links = Set(group.compactMap(\.workspaceTransferId))
        guard !links.isEmpty else { return [] }
        let seen = Set(group.map(\.id))
        return all.filter { t in
            t.isLive && !seen.contains(t.id) && t.workspaceTransferId.map(links.contains) == true
        }
    }
}
