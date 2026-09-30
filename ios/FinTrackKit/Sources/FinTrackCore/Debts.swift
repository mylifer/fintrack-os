import Foundation

/* ── Borçlar — web src/types (Debt) + calculations.ts (enrichDebt,
   calcDebtBurden) karşılığı. ─────────────────────────────────────────────── */

public struct Debt: SyncRecord, Hashable {
    public static let table = "debts"
    public let raw: JSONObject
    public let id: String
    public var name: String
    public var type: String              // personal | bank_loan | credit_card_debt | installment
    public var direction: String         // 'owe' = borçluyum, 'owed' = alacaklıyım
    public var totalAmount: Double
    public var paidAmount: Double
    public var interestRate: Double?
    public var startDate: String
    public var dueDate: String?
    public var monthlyPayment: Double?
    public var totalInstallments: Int?
    public var paidInstallments: Int?
    public var counterparty: String?
    public var accountId: String?
    public var notes: String?
    public var isSettled: Bool
    public var createdAt: String

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        type = raw.str("type") ?? "personal"
        direction = raw.str("direction") ?? "owe"
        totalAmount = raw.num("totalAmount") ?? 0
        paidAmount = raw.num("paidAmount") ?? 0
        interestRate = raw.num("interestRate")
        startDate = raw.str("startDate") ?? ""
        dueDate = raw.str("dueDate")
        monthlyPayment = raw.num("monthlyPayment")
        totalInstallments = raw.int("totalInstallments")
        paidInstallments = raw.int("paidInstallments")
        counterparty = raw.str("counterparty")
        accountId = raw.str("accountId")
        notes = raw.str("notes")
        isSettled = raw.flag("isSettled") ?? false
        createdAt = raw.str("createdAt") ?? ""
    }

    public func ownedColumns() -> JSONObject { [:] }   // ödeme kaydı web'de (bağlı işlem + taksit sayacı)

    public var owe: Bool { direction == "owe" }

    public var typeLabel: String {
        switch type {
        case "bank_loan": "Banka kredisi"
        case "credit_card_debt": "Kart borcu"
        case "installment": "Taksit"
        default: "Kişisel"
        }
    }

    /// Kalan (0'ın altına inmez) — web enrichDebt
    public var remaining: Double { max(0, Money.sub(totalAmount, paidAmount)) }
    /// İlerleme % (100'ü geçmez)
    public var progress: Double { totalAmount > 0 ? min(100, paidAmount / totalAmount * 100) : 0 }
}

extension Calc {
    /// Bugünkü yükümlülük: kapanmamış 'owe' borçların kalanı (TRY). Alacaklar sayılmaz.
    public static func debtBurden(_ debts: [Debt]) -> Double {
        var minor = 0
        for d in debts where d.owe { minor += Money.toMinor(d.isSettled ? 0 : d.remaining) }
        return Money.toMajor(minor)
    }
}

// MARK: - Ödeme planı ve ödeme kaydı (web debts/page.tsx + debts.store)

extension Debt {
    public enum PlanStatus: String, Sendable { case paid, partial, overdue, pending }

    public struct PlanRow: Hashable, Sendable {
        public var index: Int
        public var date: String
        public var amount: Double
        public var status: PlanStatus
    }

    /// Taksit planı (web buildPaymentPlan): aylık tutar yoksa boş; son taksit kalan.
    /// Durum kümülatif ödenenden türetilir (paidInstallments kullanılmaz).
    public func paymentPlan(today: String = DateUtil.today()) -> [PlanRow] {
        guard let monthly = monthlyPayment, monthly > 0 else { return [] }
        // Oran Double'da sınanır: aşırı değerde Int dönüşümü çökmesin (web: > 600 → boş)
        let ratio = (totalAmount / monthly).rounded(.up)
        let count: Int
        if let n = totalInstallments, n > 0 { count = n }
        else if ratio.isFinite, ratio > 0, ratio <= 600 { count = Int(ratio) }
        else { return [] }
        guard count > 0, count <= 600 else { return [] }
        let remainder = (Money.sub(totalAmount, monthly * Double(count - 1)) * 100).rounded() / 100
        var cum = 0.0
        var rows: [PlanRow] = []
        let start = DateUtil.parseDay(startDate)
        for i in 0..<count {
            let amount = i == count - 1 && remainder > 0 ? remainder : monthly
            let prev = cum
            cum = Money.add(cum, amount)
            let date = start.flatMap { DateUtil.calendar.date(byAdding: .month, value: i, to: $0) }.map(DateUtil.day) ?? startDate
            let status: PlanStatus = paidAmount + 0.005 >= cum ? .paid
                : paidAmount > prev + 0.005 ? .partial
                : date < today ? .overdue : .pending
            rows.append(PlanRow(index: i + 1, date: date, amount: amount, status: status))
        }
        return rows
    }

    /// Ödeme formunun ön doldurması: ilk ödenmemiş taksit, plan yoksa kalan (TRY).
    public func nextInstallmentAmount(today: String = DateUtil.today()) -> Double {
        paymentPlan(today: today).first { $0.status != .paid }?.amount ?? max(remaining, 0)
    }

    /// Ödenen tutara `deltaTry` ekle (eksi = geri al), taksit sayacı ±1, kapanma
    /// durumu yeniden (web recordPayment / revertPayment).
    public func applyingPayment(_ deltaTry: Double, installments: Int) -> Debt {
        var raw = self.raw
        let paid = Money.jsRound((paidAmount + deltaTry) * 100) / 100
        let newPaid = max(0, paid)
        raw["paidAmount"] = .number(newPaid)
        raw["paidInstallments"] = .number(Double(max(0, (paidInstallments ?? 0) + installments)))
        raw["isSettled"] = .bool(newPaid >= totalAmount)
        return Debt(raw: raw)
    }
}

extension Transaction {
    /// iOS'ta silinebilir mi: bağsız satır ya da düz borç ödemesi (borç geri alınır).
    public var canDeleteOnIOS: Bool { !isLinked || isPlainDebtPayment }

    /// Yalnız borç ödemesi olan (başka bağı olmayan) satır: iOS silebilir, borç geri alınır.
    public var isPlainDebtPayment: Bool {
        debtId != nil && debtPrincipalId == nil && installGroupId == nil && !isInstallment
            && workspaceTransferId == nil && icon == nil && systemKind == nil
            && (categorySplits?.count ?? 0) <= 1 && refundOfId == nil
    }
}

public enum DebtPayments {
    /// Borç ödemesi: tek bacaklı transfer (toAccountId yok, debtId var) + borç satırı.
    /// Tutar HESABIN para biriminde; borca TRY değeri yazılır. Kur yoksa döviz
    /// hesabından ödeme reddedilir (web ham tutarı TRY sayıyor — tutarsız).
    public static func pay(_ debt: Debt, from account: Account, amount: Double, date: String, fx: FX,
                           workspaceId: String?, now: String, id: String = UUID().uuidString.lowercased(),
                           today: String = DateUtil.today()) throws -> (transaction: Transaction, debt: Debt) {
        guard amount > 0 else { throw PaymentError.amount }
        guard let tryValue = fx.baseSnapshot(amount, account.currency) else { throw PaymentError.noRate }
        var raw: JSONObject = [
            "id": .string(id), "type": .string(TransactionType.transfer.rawValue), "amount": .number(amount),
            "currency": .string(account.currency.rawValue), "accountId": .string(account.id),
            "description": .string("\(debt.name) ödemesi"), "isInstallment": .bool(false),
            "debtId": .string(debt.id), "date": .string(date), "amountTry": .number(tryValue),
            "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        if date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
        return (Transaction(raw: raw), debt.applyingPayment(tryValue, installments: 1))
    }

    /// Ödeme silinince borç geri alınır (web setDeletedWithDebts).
    public static func revert(_ debt: Debt, payment t: Transaction, fx: FX) -> Debt {
        debt.applyingPayment(-fx.baseAmount(t), installments: -1)
    }

    public enum PaymentError: LocalizedError {
        case amount, noRate
        public var errorDescription: String? {
            switch self {
            case .amount: "Tutar girin."
            case .noRate: "Kur alınamadı; döviz hesabından ödeme için internete bağlanıp yeniden deneyin."
            }
        }
    }
}
