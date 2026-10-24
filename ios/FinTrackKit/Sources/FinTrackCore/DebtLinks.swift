import Foundation

/* ── Borç bağlı işlemler — web TransactionFormModal + debts/page.tsx ─────────
   İki biçim:
     • borç ÖDEMESİ: transfer tipli, toAccountId'siz, debtId'li satır (borçluyum)
     • alacak TAHSİLATI: gelir tipli, debtId'li, 🤝 ikonlu satır (alacaklıyım)
   İkisi de akışa girmez (Calc.isPrincipalMove); bakiyeyi oynatır ve borcun
   ödenen tutarını TL değeriyle değiştirir.
─────────────────────────────────────────────────────────────────────────── */

extension Transaction {
    /// Yalnız alacak tahsilatı olan (başka bağı olmayan) satır.
    public var isPlainDebtCollection: Bool {
        type == .income && debtId != nil && debtPrincipalId == nil && installGroupId == nil && !isInstallment
            && workspaceTransferId == nil && systemKind == nil && refundOfId == nil
            && (icon == nil || icon == Calc.debtCollectionIcon)
            && (categorySplits?.count ?? 0) <= 1
    }

    /// Borç ödemesi ya da alacak tahsilatı (düzenlenebilir/silinebilir borç bağı).
    public var isPlainDebtLink: Bool { isPlainDebtPayment || isPlainDebtCollection }
}

extension DebtPayments {
    /// Alacak tahsilatı (web debts/page "Tahsilat Al"): gelir tipli, debtId'li
    /// 🤝 satır + borç satırı. Kalan alacaktan fazlası reddedilir (TL bazlı).
    public static func collect(_ debt: Debt, into account: Account, amount: Double, date: String, fx: FX,
                               workspaceId: String?, now: String, id: String = UUID().uuidString.lowercased(),
                               description: String? = nil, notes: String? = nil,
                               today: String = DateUtil.today()) throws -> (transaction: Transaction, debt: Debt) {
        guard amount > 0 else { throw PaymentError.amount }
        guard let tryValue = fx.baseSnapshot(amount, account.currency) else { throw PaymentError.noRate }
        if tryValue > debt.remaining + 0.005 { throw PaymentError.overflow(debt.remaining) }
        let desc = description?.trimmingCharacters(in: .whitespacesAndNewlines)
        var raw: JSONObject = [
            "id": .string(id), "type": "income", "amount": .number(amount),
            "currency": .string(account.currency.rawValue), "accountId": .string(account.id),
            "description": .string(desc?.isEmpty == false ? desc! : "\(debt.name) tahsilatı"),
            "icon": .string(Calc.debtCollectionIcon), "isInstallment": .bool(false),
            "debtId": .string(debt.id), "date": .string(date), "amountTry": .number(tryValue),
            "notes": JSONValue(notes),
            "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        if date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
        return (Transaction(raw: raw), debt.applyingPayment(tryValue, installments: 1))
    }

    /// Düzenlenen borç bağlı işlemin borç düzeltmeleri (web handleSubmit mutabakatı):
    ///  - aynı borç, tutar değişti → yalnız ödenen tutar (taksit sayacı aynı)
    ///  - borç değişti → eskisi tamamen geri, yenisine yeni ödeme
    ///  - bağ kalktı → eskisi geri; bağ eklendi → yeni ödeme
    /// Dönen borçlar sırayla yazılır (aynı borca iki değişiklik birikir).
    public static func reconcileEdit(old: Transaction?, new: Transaction, debts: [Debt], fx: FX) -> [Debt] {
        let was = old.flatMap { $0.isPlainDebtLink ? $0.debtId : nil }
        let now = new.isPlainDebtLink && new.isLive ? new.debtId : nil
        let oldTry = old.map(fx.baseAmount) ?? 0, newTry = fx.baseAmount(new)
        var working: [String: Debt] = [:]
        var order: [String] = []
        func apply(_ id: String, _ delta: Double, _ inst: Int) {
            guard let d = working[id] ?? debts.first(where: { $0.id == id && $0.isLive }) else { return }
            if working[id] == nil { order.append(id) }
            working[id] = d.applyingPayment(delta, installments: inst)
        }
        switch (was, now) {
        case let (a?, b?) where a == b:
            let delta = Money.sub(newTry, oldTry)
            if delta != 0 { apply(a, delta, 0) }
        case let (a?, b?):
            apply(a, -oldTry, -1)
            apply(b, newTry, 1)
        case let (a?, nil):
            apply(a, -oldTry, -1)
        case let (nil, b?):
            apply(b, newTry, 1)
        case (nil, nil):
            break
        }
        return order.compactMap { working[$0] }
    }
}
