import Foundation

/// Tekrarlayan şablon formu — web TransactionFormModal.handleRecurringSubmit.
///   • açıklama boşsa ad; para birimi hesaptan
///   • dayOfMonth yalnız bilgi: aylık/yıllıkta başlangıcın günü
///   • yeni: nextDueDate = startDate, isActive = true
///   • düzenleme: başlangıç değiştiyse nextDueDate = yeni başlangıç
public struct RecurringDraft: Equatable, Sendable {
    public var name = ""
    public var type: TransactionType = .expense
    public var amountText = ""
    public var accountId: String?
    public var toAccountId: String?
    public var categoryId: String?
    public var description = ""
    public var notes = ""
    public var frequency: RecurringFrequency = .monthly
    public var startDate = Date()
    public var hasEndDate = false
    public var endDate = Date()
    /// Web kişileri; onaylanınca işleme geçer (Recurrence)
    public var familyMemberId: String?
    public var recipientId: String?

    public init() {}

    public init(editing r: RecurringTransaction) {
        name = r.name
        type = r.type
        amountText = Fmt.amountInput(r.amount)
        accountId = r.accountId
        toAccountId = r.toAccountId
        categoryId = r.categoryId
        description = r.description   // web: ad değişse de eski açıklama kalır
        notes = r.notes ?? ""
        frequency = r.frequency
        startDate = DateUtil.parseDay(r.startDate) ?? Date()
        if let e = r.endDate, let d = DateUtil.parseDay(e) { hasEndDate = true; endDate = d }
        familyMemberId = r.familyMemberId
        recipientId = r.recipientId
    }

    public var amount: Double { Fmt.parseAmount(amountText) }

    public func validationError() -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Ad girin." }
        if amount <= 0 { return "Tutar girin." }
        guard let accountId else { return "Hesap seçin." }
        if type == .transfer {
            guard let to = toAccountId else { return "Hedef hesabı seçin." }
            if to == accountId { return "Kaynak ve hedef hesap aynı olamaz." }
        }
        if hasEndDate && DateUtil.day(endDate) < DateUtil.day(startDate) { return "Bitiş başlangıçtan önce olamaz." }
        return nil
    }

    /// Yeni şablon ya da düzenlenmiş hali.
    public func build(editing: RecurringTransaction?, account: Account, workspaceId: String?,
                      id: String = UUID().uuidString.lowercased(), now: String) -> RecurringTransaction {
        var r = editing ?? RecurringTransaction(raw: [
            "id": .string(id), "isActive": .bool(true), "createdAt": .string(now),
            "deleted_at": .null, "workspaceId": JSONValue(workspaceId),
        ])
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let start = DateUtil.day(startDate)
        r.name = trimmed
        r.type = type
        r.amount = amount
        r.currency = account.currency
        r.accountId = account.id
        r.toAccountId = type == .transfer ? toAccountId : nil
        r.categoryId = type == .transfer ? nil : categoryId
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        r.description = d.isEmpty ? trimmed : d
        let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        r.notes = n.isEmpty ? nil : n
        r.frequency = frequency
        r.dayOfMonth = frequency == .monthly || frequency == .yearly ? Int(start.suffix(2)) : nil
        r.endDate = hasEndDate ? DateUtil.day(endDate) : nil
        if editing == nil {
            r.nextDueDate = start
        } else if editing!.startDate != start {
            r.nextDueDate = start
        }
        r.startDate = start
        // Kişiler: transferde boş; değişmediyse ham satıra dokunulmaz
        let fam = type == .transfer ? nil : familyMemberId
        let rec = type == .transfer ? nil : recipientId
        if editing == nil || fam != editing?.familyMemberId { r.raw["familyMemberId"] = JSONValue(fam); r.familyMemberId = fam }
        if editing == nil || rec != editing?.recipientId { r.raw["recipientId"] = JSONValue(rec); r.recipientId = rec }
        return r
    }
}
