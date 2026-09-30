import Foundation

/// Ödeme Takibi "Öde" — web src/lib/payments/actions.ts `payRow` karşılığı.
/// İşlem (isteğe bağlı) + ayın kaydı "ödendi": tutar ve vade DONDURULUR, işlem
/// bu aya bağlanır (başka ayda otomatik tespit edilmez). Otomatik tespite
/// bırakmak gecikmiş ödemeyi bir sonraki aya yazıyordu.
public enum PaymentActions {
    public struct PayInput: Sendable {
        /// Hedefin (kartın/borcun) para biriminde
        public var amount: Double
        public var fromAccountId: String?
        public var date: String
        /// false → yalnız "ödendi" işareti; hiçbir bakiye değişmez
        public var createTransaction: Bool
        public var note: String?

        public init(amount: Double, fromAccountId: String?, date: String, createTransaction: Bool, note: String? = nil) {
            self.amount = amount; self.fromAccountId = fromAccountId; self.date = date
            self.createTransaction = createTransaction; self.note = note
        }
    }

    public struct Result: Sendable {
        public var transaction: Transaction?
        /// Borçta: borca eklenecek TRY (recordPayment)
        public var debtDeltaTry: Double?
        public var occurrence: PaymentOccurrence
    }

    public enum PayError: LocalizedError {
        case noAccount, amount, noRate
        public var errorDescription: String? {
            switch self {
            case .noAccount: "Ödeme hesabı seçilmedi."
            case .amount: "Tutar girin."
            case .noRate: "Kur alınamadı; döviz hesabından ödeme için internete bağlanıp yeniden deneyin."
            }
        }
    }

    public static func pay(row: PaymentRow, input: PayInput, from: Account?, occurrences: [PaymentOccurrence],
                           existingTransactionIds: Set<String>, fx: FX, workspaceId: String?, now: String,
                           transactionId: String = UUID().uuidString.lowercased(),
                           today: String = DateUtil.today()) throws -> Result {
        guard input.amount > 0 else { throw PayError.amount }
        let target = row.target
        var tx: Transaction?
        var debtDelta: Double?
        var linkedId: String?

        if input.createTransaction {
            guard let from else { throw PayError.noAccount }
            // Aynı kimlik zaten kayıtlıysa ikinci transfer / borç mutabakatı yok; yalnız ay işaretlenir
            if !existingTransactionIds.contains(transactionId) {
                let amountFrom: Double
                if from.currency == target.currency {
                    amountFrom = input.amount
                } else {
                    guard fx.rate(target.currency) != nil, fx.rate(from.currency) != nil else { throw PayError.noRate }
                    amountFrom = Money.round(fx.fromBaseTry(fx.toBaseTry(input.amount, target.currency), from.currency))
                }
                var raw: JSONObject = [
                    "id": .string(transactionId), "type": .string(TransactionType.transfer.rawValue),
                    "amount": .number(amountFrom), "currency": .string(from.currency.rawValue),
                    "accountId": .string(from.id), "date": .string(input.date),
                    "description": .string(PaymentSchedule.paymentDescription(target)),
                    "isInstallment": .bool(false), "createdAt": .string(now), "updatedAt": .string(now),
                    "deleted_at": .null, "workspaceId": JSONValue(workspaceId),
                ]
                if target.kind == .card { raw["toAccountId"] = .string(target.id) } else { raw["debtId"] = .string(target.id) }
                if let n = input.note?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty { raw["notes"] = .string(n) }
                if let snap = fx.baseSnapshot(amountFrom, from.currency) { raw["amountTry"] = .number(snap) }
                if input.date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
                tx = Transaction(raw: raw)
                if target.kind == .debt { debtDelta = fx.toBaseTry(amountFrom, from.currency) }
            }
            linkedId = transactionId
        }

        // Ay kaydı: varsa CANLI satırın üstüne birleştir (statementDate, not vb. kalsın)
        let occId = PaymentSchedule.occurrenceIdFor(target.kind, target.id, row.month)
        let current = occurrences.first { $0.id == occId && $0.isLive }
        var raw: JSONObject = current?.raw ?? [
            "id": .string(occId), "targetKind": .string(target.kind.rawValue), "targetId": .string(target.id),
            "month": .string(row.month), "createdAt": .string(now), "workspaceId": JSONValue(workspaceId),
        ]
        raw["deleted_at"] = .null
        let alreadyPaid = row.paidVia == .detected ? row.paidAmount : 0
        raw["status"] = "paid"
        raw["amount"] = .number(row.amount ?? input.amount)
        raw["dueDate"] = .string(row.dueDate)
        raw["fromAccountId"] = JSONValue(input.fromAccountId ?? row.fromAccountId)
        raw["paidAmount"] = .number(Money.add(alreadyPaid, input.amount))
        raw["paidDate"] = .string(input.date)
        raw["transactionId"] = JSONValue(linkedId)
        let note = input.note?.trimmingCharacters(in: .whitespacesAndNewlines)
        raw["note"] = JSONValue((note?.isEmpty == false) ? note : row.note)
        return Result(transaction: tx, debtDeltaTry: debtDelta, occurrence: PaymentOccurrence(raw: raw))
    }
}
