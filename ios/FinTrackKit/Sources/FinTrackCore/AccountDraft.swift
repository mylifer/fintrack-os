import Foundation

/* ── Hesap formu — web src/components/accounts/AccountFormModal.tsx ─────────
   • Kredi kartı borcu POZİTİF girilir, satırda negatif tutulur; diğer
     türlerde işaret girildiği gibi.
   • Kartta limit zorunlu; son ödeme günü kartın ödeme PLANINA yazılır
     (payment_plans, kimlik payplan:card:<hesap>). Gün, kesim + bankanın
     farkıyla aynıysa dueGapDays = fark (her ay kesimden hesaplanır), elle
     başka bir gün girildiyse dueGapDays = null (o gün sabit).
   • %3 eski formun varsayılanıydı — girilmemiş sayılır.
   • Vadeli mevduat (Birikim): oran + başlangıç + (sonraki) bitiş birlikte
     gerekir; hiç girilmediyse deposit* sütunlarına dokunulmaz.
─────────────────────────────────────────────────────────────────────────── */

public struct AccountDraft: Equatable, Sendable {
    public static let colors = ["#111110", "#1A5CA3", "#1E7A3E", "#B83232", "#D4A853", "#7B3F9B", "#C4732A", "#6B6B67"]

    public var name = ""
    public var type: AccountType = .checking
    public var currency: CurrencyCode = .TRY
    public var initialBalanceText = ""
    public var color = "#1A5CA3"
    public var icon = ""
    // Kredi kartı
    public var limitText = ""
    public var statementDay = 1
    public var dueDayText = ""
    public var minPctText = ""
    // Vadeli mevduat
    public var depositRateText = ""
    public var depositTaxText = ""
    public var depositStart: String = ""
    public var depositEnd: String = ""

    public init() {}

    public init(editing a: Account, cardPlan: PaymentPlan?) {
        name = a.name
        type = a.type
        currency = a.currency
        initialBalanceText = Fmt.amountInput(a.type == .credit_card ? abs(a.initialBalance) : a.initialBalance)
        color = a.color
        icon = a.icon ?? ""
        limitText = a.creditLimit.map { $0 != 0 ? Fmt.amountInput($0) : "" } ?? ""
        statementDay = a.statementDay ?? 1
        dueDayText = cardPlan?.dayOfMonth.map(String.init) ?? ""
        minPctText = a.minPayPct.map { $0 != 0 && $0 != 3 ? Fmt.amountInput($0) : "" } ?? ""
        depositRateText = a.raw.num("depositRate").map { $0 != 0 ? Fmt.amountInput($0) : "" } ?? ""
        depositTaxText = a.raw.num("depositTaxPct").map(Fmt.amountInput) ?? ""
        depositStart = a.raw.str("depositStart") ?? ""
        depositEnd = a.raw.str("depositEnd") ?? ""
    }

    public var isCreditCard: Bool { type == .credit_card }
    public var isSavings: Bool { type == .savings }

    /// Satıra yazılacak açılış bakiyesi (kartta borç negatif)
    public var initialBalance: Double {
        let v = Fmt.parseAmount(initialBalanceText)
        return isCreditCard ? -abs(v) : v
    }

    public var depositRate: Double { Fmt.parseAmount(depositRateText) }
    public var depositTax: Double {
        depositTaxText.trimmingCharacters(in: .whitespaces).isEmpty ? Deposit.defaultTax : Fmt.parseAmount(depositTaxText)
    }
    public var depositUsed: Bool {
        isSavings && (!depositRateText.trimmingCharacters(in: .whitespaces).isEmpty || !depositStart.isEmpty || !depositEnd.isEmpty)
    }
    public var depositOk: Bool { depositRate > 0 && !depositStart.isEmpty && !depositEnd.isEmpty && depositEnd > depositStart }

    /// Kesim + banka farkı (kartta kayıtlıysa o) → önerilen son ödeme günü
    public func cardGap(_ editing: Account?) -> Int {
        editing?.dueGapDays ?? BankRules.bankRuleFor(name).gapDays
    }

    public func validationError() -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Ad girin." }
        if isCreditCard && Fmt.parseAmount(limitText) == 0 { return "Limit girin." }
        if depositUsed && !depositOk { return "Faiz oranı, vade başlangıcı ve (başlangıçtan sonraki) vade sonu gerekli." }
        if isCreditCard, let d = Int(dueDayText.trimmingCharacters(in: .whitespaces)), !(1...31).contains(d) {
            return "Son ödeme günü 1–31 arasında olmalı."
        }
        return nil
    }

    /// Son ödeme günü (plana yazılacak); boş/aralık dışı = nil
    public var dueDay: Int? {
        guard let d = Int(dueDayText.trimmingCharacters(in: .whitespaces)), (1...31).contains(d) else { return nil }
        return d
    }

    /// Yazılacak hesap satırı. Düzenlemede ham satırın bilinmeyen sütunları korunur.
    public func build(editing: Account?, workspaceId: String?, id: String = UUID().uuidString.lowercased(),
                      now: String) -> Account {
        var raw = editing?.raw ?? [
            "id": .string(id), "createdAt": .string(now), "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        raw["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        raw["type"] = .string(type.rawValue)
        raw["currency"] = .string(currency.rawValue)
        raw["initialBalance"] = .number(initialBalance)
        raw["color"] = .string(color)
        raw["icon"] = icon.isEmpty ? .null : .string(icon)
        // Web formu kaydederken hesabı arşivden çıkarır (isArchived: false)
        raw["isArchived"] = .bool(false)
        if isCreditCard {
            raw["creditLimit"] = .number(Fmt.parseAmount(limitText))
            raw["statementDay"] = .number(Double(statementDay))
            raw["dueDay"] = .number(Double(editing?.dueDay ?? 10))
            let pct = Fmt.parseAmount(minPctText)
            raw["minPayPct"] = pct != 0 ? .number(pct) : .null
            let gap = cardGap(editing)
            raw["dueGapDays"] = dueDayText.trimmingCharacters(in: .whitespaces) == String(BankRules.nominalDueDay(statementDay, gap))
                ? .number(Double(gap)) : .null
        }
        let hadDeposit = editing.map {
            ($0.raw.num("depositRate") ?? 0) != 0 || $0.raw.str("depositStart") != nil || $0.raw.str("depositEnd") != nil
        } ?? false
        if depositUsed || hadDeposit {
            raw["depositRate"] = depositUsed ? .number(depositRate) : .null
            raw["depositStart"] = depositUsed ? .string(depositStart) : .null
            raw["depositEnd"] = depositUsed ? .string(depositEnd) : .null
            raw["depositTaxPct"] = depositUsed ? .number(depositTax) : .null
        }
        return Account(raw: raw)
    }

    /// Kartın son ödeme günü planı (web savePlan('card', …, { dayOfMonth })).
    /// Değişmediyse ya da plan yokken boş bırakıldıysa nil (plana dokunulmaz).
    public func cardPlan(for account: Account, existing: PaymentPlan?, workspaceId: String?, now: String) -> PaymentPlan? {
        guard isCreditCard, dueDay != existing?.dayOfMonth else { return nil }
        var raw = existing?.raw ?? [
            "id": .string(PaymentSchedule.planIdFor(.card, account.id)), "targetKind": "card",
            "targetId": .string(account.id), "isActive": .bool(true), "createdAt": .string(now),
            "deleted_at": .null, "workspaceId": JSONValue(account.workspaceId ?? workspaceId),
        ]
        raw["dayOfMonth"] = dueDay.map { .number(Double($0)) } ?? .null
        return PaymentPlan(raw: raw)
    }
}

extension Account {
    /// Arşive al / çıkar (yalnız isArchived değişir)
    public func archived(_ on: Bool) -> Account {
        var r = raw
        r["isArchived"] = .bool(on)
        return Account(raw: r)
    }

    /// Silme = tombstone
    public func tombstoned(at now: String) -> Account {
        var r = raw
        r["deleted_at"] = .string(now)
        return Account(raw: r)
    }
}
