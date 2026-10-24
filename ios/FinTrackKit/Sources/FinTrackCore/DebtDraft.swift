import Foundation

/* ── Borç formu — web src/app/(main)/debts/page.tsx handleSave ──────────────
   • Borç yalnızca tamamı ödenince kapanır (isSettled = ödenen ≥ toplam).
   • Yeni borçta isteğe bağlı "anapara hesabı": para hesaba girer (borç aldım,
     🏦 gelir "… — borç girişi") ya da çıkar (borç verdim, 🤝 gider
     "… — verilen borç"). Satır debtId DEĞİL debtPrincipalId taşır (ödeme
     sayılmasın); akışa girmez (açıklama son eki + ikon).
   • Düzenlemede alım tarihi değişirse anapara satırının tarihi de taşınır.
   • Silme: varsayılan yalnız borç; "bağlı işlemleri de sil" seçilirse ödemeler
     ve anapara satırı da (web deleteDebtWithTransactions).
─────────────────────────────────────────────────────────────────────────── */

public struct DebtDraft: Equatable, Sendable {
    public static let types: [(value: String, label: String)] = [
        ("personal", "Kişisel"), ("bank_loan", "Banka Kredisi"),
        ("credit_card_debt", "Kredi Kartı Borcu"), ("installment", "Taksit"),
    ]
    public static let inSuffix = "borç girişi"
    public static let outSuffix = "verilen borç"

    public var name = ""
    public var type = "personal"
    public var direction = "owe"
    public var totalText = ""
    public var paidText = "0"
    public var interestText = ""
    public var startDate = DateUtil.today()
    public var borrowDate = DateUtil.today()
    public var dueDate = ""
    public var monthlyText = ""
    public var installmentsText = ""
    public var counterparty = ""
    public var accountId: String?
    public var notes = ""
    /// Yalnız yeni borçta: anaparanın gireceği/çıkacağı hesap (boşsa bakiye oynamaz)
    public var depositAccountId: String?

    public init() {}

    public init(editing d: Debt, principal: Transaction?) {
        name = d.name
        type = d.type
        direction = d.direction
        totalText = Fmt.amountInput(d.totalAmount)
        paidText = Fmt.amountInput(d.paidAmount)
        interestText = d.interestRate.map { $0 != 0 ? Fmt.amountInput($0) : "" } ?? ""
        startDate = d.startDate
        borrowDate = d.raw.str("borrowDate").map { String($0.prefix(10)) } ?? principal.map { String($0.date.prefix(10)) } ?? ""
        dueDate = d.dueDate.map { String($0.prefix(10)) } ?? ""
        monthlyText = d.monthlyPayment.map { $0 != 0 ? Fmt.amountInput($0) : "" } ?? ""
        installmentsText = d.totalInstallments.map(String.init) ?? ""
        counterparty = d.counterparty ?? ""
        accountId = d.accountId
        notes = d.notes ?? ""
    }

    public var total: Double { Fmt.parseAmount(totalText) }
    public var paid: Double { Fmt.parseAmount(paidText) }

    public func validationError() -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Ad girin." }
        if total == 0 { return "Toplam tutarı girin." }
        if startDate.isEmpty { return "Başlangıç tarihini seçin." }
        return nil
    }

    /// Yazılacak borç satırı (düzenlemede ham satırın bilinmeyen sütunları korunur)
    public func build(editing: Debt?, workspaceId: String?, id: String = UUID().uuidString.lowercased(),
                      now: String) -> Debt {
        var raw = editing?.raw ?? [
            "id": .string(id), "paidInstallments": .number(0), "createdAt": .string(now),
            "deleted_at": .null, "workspaceId": JSONValue(workspaceId),
        ]
        func opt(_ s: String) -> JSONValue {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .null : .string(t)
        }
        func num(_ s: String) -> JSONValue {
            let v = Fmt.parseAmount(s)
            return v != 0 ? .number(v) : .null
        }
        raw["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        raw["type"] = .string(type)
        raw["direction"] = .string(direction)
        raw["totalAmount"] = .number(total)
        raw["paidAmount"] = .number(paid)
        raw["isSettled"] = .bool(paid >= total)
        raw["interestRate"] = num(interestText)
        raw["startDate"] = .string(startDate)
        raw["borrowDate"] = opt(borrowDate)
        raw["dueDate"] = opt(dueDate)
        raw["monthlyPayment"] = num(monthlyText)
        raw["totalInstallments"] = Int(installmentsText.trimmingCharacters(in: .whitespaces)).map { .number(Double($0)) } ?? .null
        raw["counterparty"] = opt(counterparty)
        // Anapara hesabı seçildiyse borcun hesabı da o olur (Ödeme Yap aynı hesabı önerir)
        let acc = editing == nil ? (depositAccountId ?? accountId) : accountId
        raw["accountId"] = JSONValue(acc)
        raw["notes"] = opt(notes)
        return Debt(raw: raw)
    }

    /// Anapara satırının açıklaması (web debtPrincipalDescription)
    public static func principalDescription(name: String, direction: String) -> String {
        "\(name) — \(direction == "owe" ? inSuffix : outSuffix)"
    }

    /// Yeni borcun anapara satırı (web addPrincipalTx). Borç TL bazlı; yabancı
    /// para hesaba kendi biriminde yazılır.
    public static func principalTx(for debt: Debt, account: Account, borrowDate: String, fx: FX, now: String,
                                   id: String = UUID().uuidString.lowercased(),
                                   today: String = DateUtil.today()) -> Transaction {
        let inbound = debt.owe
        let amount = account.currency == .TRY ? debt.totalAmount : fx.fromBaseTry(debt.totalAmount, account.currency)
        let date = borrowDate.isEmpty ? today : String(borrowDate.prefix(10))
        var raw: JSONObject = [
            "id": .string(id), "type": .string(inbound ? "income" : "expense"), "amount": .number(amount),
            "currency": .string(account.currency.rawValue), "accountId": .string(account.id),
            "icon": .string(inbound ? "🏦" : "🤝"),
            "description": .string(principalDescription(name: debt.name, direction: debt.direction)),
            "isInstallment": .bool(false), "debtPrincipalId": .string(debt.id), "date": .string(date),
            "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
            "workspaceId": JSONValue(debt.workspaceId),
        ]
        if let snap = fx.baseSnapshot(amount, account.currency) { raw["amountTry"] = .number(snap) }
        if date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
        return Transaction(raw: raw)
    }

    /// Borcun anapara satırı (web findDebtPrincipalTx): önce kimlik bağı, yoksa
    /// tek eşleşen eski satır (ikon + açıklama).
    public static func findPrincipal(_ debt: Debt, in txs: [Transaction]) -> Transaction? {
        let live = txs.filter(\.isLive)
        if let linked = live.first(where: { $0.debtPrincipalId == debt.id }) { return linked }
        let desc = principalDescription(name: debt.name, direction: debt.direction)
        let matches = live.filter { $0.debtPrincipalId == nil && Calc.isDebtPrincipal($0) && $0.description == desc }
        return matches.count == 1 ? matches[0] : nil
    }

    /// Alım tarihi değiştiyse taşınmış anapara satırı (web syncPrincipalDate). `before`
    /// borcun GÜNCELLENMEDEN önceki hâli (eski satır eski adla yazılmıştı).
    public static func movedPrincipal(before: Debt, borrowDate: String, txs: [Transaction], now: String,
                                      today: String = DateUtil.today()) -> Transaction? {
        let date = String(borrowDate.prefix(10))
        guard !date.isEmpty, let tx = findPrincipal(before, in: txs), tx.date.prefix(10) != date else { return nil }
        var out = tx
        out.date = date
        if tx.debtPrincipalId == nil { out.raw["debtPrincipalId"] = .string(before.id) }
        if tx.approvalStatus == .pending && date <= today {
            out.approvalStatus = .approved
            out.approvedAt = now
        }
        return out.rebuilt()
    }

    /// Borca bağlı TÜM işlemler: ödemeler (debtId) ve anapara; taksitli ödemenin grubu da.
    public static func linkedTransactions(_ debt: Debt, in txs: [Transaction]) -> [Transaction] {
        let live = txs.filter(\.isLive)
        var ids = Set(live.filter { $0.debtId == debt.id }.map(\.id))
        if let p = findPrincipal(debt, in: live) { ids.insert(p.id) }
        let groups = Set(live.filter { ids.contains($0.id) }.compactMap(\.installGroupId))
        return live.filter { ids.contains($0.id) || ($0.installGroupId.map(groups.contains) ?? false) }
    }
}

extension Debt {
    public func tombstoned(at now: String) -> Debt {
        var r = raw
        r["deleted_at"] = .string(now)
        return Debt(raw: r)
    }
}
