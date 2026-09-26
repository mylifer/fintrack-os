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
