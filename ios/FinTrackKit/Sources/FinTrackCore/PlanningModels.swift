import Foundation

/* ── Planlama tabloları: tekrarlayanlar, birikim hedefleri, Ödeme Takibi ──
   Kaynak: web src/types/index.ts + migrations 0011/0015/0016/0022. Sütun adları
   tırnaklı camelCase; id / user_id / deleted_at düz. Sayısal gün alanları
   veritabanında double.
─────────────────────────────────────────────────────────────────────────── */

// MARK: - Tekrarlayan işlem şablonu

public enum RecurringFrequency: String, CaseIterable, Sendable {
    case daily, weekly, monthly, yearly

    public var label: String {
        switch self { case .daily: "Her gün"; case .weekly: "Her hafta"; case .monthly: "Her ay"; case .yearly: "Her yıl" }
    }
}

public struct RecurringTransaction: SyncRecord, Hashable {
    public static let table = "recurring_transactions"
    public var raw: JSONObject
    public let id: String
    public var name: String
    public var type: TransactionType
    public var amount: Double
    public var currency: CurrencyCode
    public var accountId: String
    public var toAccountId: String?
    public var categoryId: String?
    public var description: String
    public var notes: String?
    public var frequency: RecurringFrequency
    /// Yalnız bilgi amaçlı; hesap `startDate`'in gününü kullanır.
    public var dayOfMonth: Int?
    public var startDate: String
    public var endDate: String?
    public var nextDueDate: String
    public var lastGeneratedDate: String?
    public var isActive: Bool
    public var familyMemberId: String?
    public var recipientId: String?
    public var createdAt: String

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        type = TransactionType(rawValue: raw.str("type") ?? "") ?? .expense
        amount = raw.num("amount") ?? 0
        currency = CurrencyCode(rawValue: raw.str("currency") ?? "") ?? .TRY
        accountId = raw.str("accountId") ?? ""
        toAccountId = raw.str("toAccountId")
        categoryId = raw.str("categoryId")
        description = raw.str("description") ?? ""
        notes = raw.str("notes")
        frequency = RecurringFrequency(rawValue: raw.str("frequency") ?? "") ?? .monthly
        dayOfMonth = raw.int("dayOfMonth")
        startDate = raw.str("startDate") ?? ""
        endDate = raw.str("endDate")
        nextDueDate = raw.str("nextDueDate") ?? (raw.str("startDate") ?? "")
        lastGeneratedDate = raw.str("lastGeneratedDate")
        isActive = raw.flag("isActive") ?? true
        familyMemberId = raw.str("familyMemberId")
        recipientId = raw.str("recipientId")
        createdAt = raw.str("createdAt") ?? ""
    }

    /// Web formunun yazdığı alanlar + imleç — YALNIZ değişenler (ya da satırda hiç
    /// olmayanlar) ham satırın üstüne yazılır: iOS'un tanımadığı bir değer (ör.
    /// listede olmayan para birimi) ayrıştırma varsayılanıyla ezilmez.
    /// (familyMemberId / recipientId iOS'ta düzenlenmez; ham satırla gider.)
    public func ownedColumns() -> JSONObject {
        let before = RecurringTransaction(raw: raw)
        var out: JSONObject = ["id": .string(id)]
        func put(_ key: String, _ value: JSONValue, _ changed: Bool) {
            if changed || raw[key] == nil { out[key] = value }
        }
        put("name", .string(name), name != before.name)
        put("type", .string(type.rawValue), type != before.type)
        put("amount", .number(amount), amount != before.amount)
        put("currency", .string(currency.rawValue), currency != before.currency)
        put("accountId", .string(accountId), accountId != before.accountId)
        put("toAccountId", JSONValue(toAccountId), toAccountId != before.toAccountId)
        put("categoryId", JSONValue(categoryId), categoryId != before.categoryId)
        put("description", .string(description), description != before.description)
        put("notes", JSONValue(notes), notes != before.notes)
        put("frequency", .string(frequency.rawValue), frequency != before.frequency)
        put("dayOfMonth", JSONValue(dayOfMonth.map(Double.init)), dayOfMonth != before.dayOfMonth)
        put("startDate", .string(startDate), startDate != before.startDate)
        put("endDate", JSONValue(endDate), endDate != before.endDate)
        put("nextDueDate", .string(nextDueDate), nextDueDate != before.nextDueDate)
        put("lastGeneratedDate", JSONValue(lastGeneratedDate), lastGeneratedDate != before.lastGeneratedDate)
        put("isActive", .bool(isActive), isActive != before.isActive)
        put("createdAt", JSONValue(createdAt.isEmpty ? nil : createdAt), createdAt != before.createdAt)
        return out
    }
}

// MARK: - Birikim hedefi

public struct SavingsGoal: SyncRecord, Hashable {
    public static let table = "savings_goals"
    public static let colors = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#F97316", "#EAB308", "#14B8A6", "#6B7280"]

    public var raw: JSONObject
    public let id: String
    public var name: String
    /// Her zaman TRY
    public var targetAmount: Double
    public var targetDate: String?
    public var accountId: String?
    public var savedAmount: Double?
    public var color: String
    public var notes: String?
    public var createdAt: String

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        targetAmount = raw.num("targetAmount") ?? 0
        targetDate = raw.str("targetDate").flatMap { $0.isEmpty ? nil : $0 }
        accountId = raw.str("accountId").flatMap { $0.isEmpty ? nil : $0 }
        savedAmount = raw.num("savedAmount")
        color = raw.str("color") ?? "#10B981"
        notes = raw.str("notes")
        createdAt = raw.str("createdAt") ?? ""
    }

    public func ownedColumns() -> JSONObject {
        ["id": .string(id), "name": .string(name), "targetAmount": .number(targetAmount),
         "targetDate": JSONValue(targetDate), "accountId": JSONValue(accountId),
         "savedAmount": JSONValue(savedAmount), "color": .string(color), "notes": JSONValue(notes),
         "createdAt": JSONValue(createdAt.isEmpty ? nil : createdAt)]
    }
}

// MARK: - Ödeme Takibi (salt okunur)

public struct PaymentPlan: SyncRecord, Hashable {
    public static let table = "payment_plans"
    public let raw: JSONObject
    public let id: String
    public var targetKind: String     // 'card' | 'debt'
    public var targetId: String
    public var amount: Double?
    public var fromAccountId: String?
    public var dayOfMonth: Int?
    public var startMonth: String?
    public var isActive: Bool
    public var notes: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        targetKind = raw.str("targetKind") ?? ""
        targetId = raw.str("targetId") ?? ""
        amount = raw.num("amount")
        fromAccountId = raw.str("fromAccountId")
        dayOfMonth = raw.num("dayOfMonth").map { $0.rounded().safeInt }
        startMonth = raw.str("startMonth")
        isActive = raw.flag("isActive") ?? true
        notes = raw.str("notes")
    }

    public func ownedColumns() -> JSONObject { [:] }
}

public struct PaymentOccurrence: SyncRecord, Hashable {
    public static let table = "payment_occurrences"
    public let raw: JSONObject
    public let id: String
    public var targetKind: String
    public var targetId: String
    /// 'YYYY-MM' — ödeme ayı (son ödeme tarihinin ayı)
    public var month: String
    public var amount: Double?
    public var fromAccountId: String?
    public var dueDate: String?
    public var statementDate: String?
    public var status: String?        // 'paid' | 'skipped' | nil
    public var paidAmount: Double?
    public var paidDate: String?
    public var transactionId: String?
    public var note: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        targetKind = raw.str("targetKind") ?? ""
        targetId = raw.str("targetId") ?? ""
        month = raw.str("month") ?? ""
        amount = raw.num("amount")
        fromAccountId = raw.str("fromAccountId")
        dueDate = raw.str("dueDate")
        statementDate = raw.str("statementDate")
        status = raw.str("status")
        paidAmount = raw.num("paidAmount")
        paidDate = raw.str("paidDate")
        transactionId = raw.str("transactionId")
        note = raw.str("note")
    }

    public func ownedColumns() -> JSONObject { [:] }
}

// MARK: - Deterministik kimlik

/// Web src/lib/utils/id.ts `deterministicUuid`: cyrb128 → uuid-v4 biçimi. Aynı
/// tohum her cihazda aynı kimliği verir; web ile iOS aynı anda aynı dönemi
/// onaylarsa kopya satır oluşmaz. JS `charCodeAt` = UTF-16 birimleri.
public enum DeterministicID {
    public static func uuid(_ seed: String) -> String {
        var h1: UInt32 = 1779033703, h2: UInt32 = 3144134277, h3: UInt32 = 1013904242, h4: UInt32 = 2773480762
        for unit in seed.utf16 {
            let k = UInt32(unit)
            h1 = h2 ^ ((h1 ^ k) &* 597399067)
            h2 = h3 ^ ((h2 ^ k) &* 2869860233)
            h3 = h4 ^ ((h3 ^ k) &* 951274213)
            h4 = h1 ^ ((h4 ^ k) &* 2716044179)
        }
        h1 = (h3 ^ (h1 >> 18)) &* 597399067
        h2 = (h4 ^ (h2 >> 22)) &* 2869860233
        h3 = (h1 ^ (h3 >> 17)) &* 951274213
        h4 = (h2 ^ (h4 >> 19)) &* 2716044179
        let hex = Array([h1, h2, h3, h4].map { String(format: "%08x", $0) }.joined())
        let variant = String((Int(String(hex[16]), radix: 16)! & 0x3) | 0x8, radix: 16)
        func s(_ a: Int, _ b: Int) -> String { String(hex[a..<b]) }
        return "\(s(0, 8))-\(s(8, 12))-4\(s(13, 16))-\(variant)\(s(17, 20))-\(s(20, 32))"
    }
}
