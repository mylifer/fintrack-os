import Foundation

/* ── Modeller ─────────────────────────────────────────────────────────────
   Kaynak: web src/types/index.ts + supabase_schema.sql. Sütun adları KARIŞIK:
   tırnaklı camelCase ("updatedAt", "workspaceId", …) ve snake_case
   (deleted_at, user_id). Aşağıdaki anahtarlar veritabanındaki adlarla birebir.

   Her model ham satırı (`raw`) taşır. Yazma yolu (`SyncRecord.rowForWrite`)
   ham satırın üstüne yalnız `ownedColumns()`'u koyar: iOS'un bilmediği
   sütunlar olduğu gibi geri gider, iOS'un sahip olduğu alanlardan boş
   olanlar açıkça null yazılır (temizlenen alan bulutta da temizlensin).
─────────────────────────────────────────────────────────────────────────── */

public enum CurrencyCode: String, CaseIterable, Sendable, Codable {
    case TRY, USD, EUR, GBP

    public var symbol: String {
        switch self { case .TRY: "₺"; case .USD: "$"; case .EUR: "€"; case .GBP: "£" }
    }
}

public protocol SyncRecord: Identifiable, Sendable where ID == String {
    static var table: String { get }
    var id: String { get }
    var raw: JSONObject { get }
    init(raw: JSONObject)
    /// iOS'un yazdığı sütunlar. nil alanlar `.null` olarak yer almalı.
    func ownedColumns() -> JSONObject
}

extension SyncRecord {
    public var workspaceId: String? { raw.str("workspaceId") }
    public var deletedAt: String? { raw.str("deleted_at") }
    public var updatedAt: String? { raw.str("updatedAt") }
    public var isLive: Bool { deletedAt == nil }

    /// Upsert'e gidecek TAM satır (user_id hariç — oturumdan eklenir).
    /// `updatedAt` her yazmada damgalanır: sunucudaki keep_newer_row (0016)
    /// daha eski damgalı yazmayı yok sayar. `deleted_at` her zaman açıkça
    /// yer alır (web toSnapshot ile aynı kural).
    public func rowForWrite(updatedAt: String) -> JSONObject {
        var row = raw
        for (k, v) in ownedColumns() { row[k] = v }
        row.removeValue(forKey: "user_id")
        row["updatedAt"] = .string(updatedAt)
        if row["deleted_at"] == nil { row["deleted_at"] = .null }
        return row
    }
}

// MARK: - Workspace

public struct Workspace: SyncRecord, Hashable {
    public static let table = "workspaces"
    public let raw: JSONObject
    public let id: String
    public var name: String
    public var isDefault: Bool
    public var createdAt: String

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? "Genel"
        isDefault = raw.flag("isDefault") ?? false
        createdAt = raw.str("createdAt") ?? ""
    }

    public func ownedColumns() -> JSONObject { [:] }   // iOS çalışma alanı yazmaz
}

// MARK: - Account

public enum AccountType: String, CaseIterable, Sendable {
    case cash, checking, savings, credit_card, investment, loan

    public var label: String {
        switch self {
        case .cash: "Nakit"
        case .checking: "Vadesiz"
        case .savings: "Birikim"
        case .credit_card: "Kredi Kartı"
        case .investment: "Yatırım"
        case .loan: "Kredi"
        }
    }
}

public struct Account: SyncRecord, Hashable {
    public static let table = "accounts"
    public let raw: JSONObject
    public let id: String
    public var name: String
    public var type: AccountType
    public var currency: CurrencyCode
    public var initialBalance: Double
    public var color: String
    public var icon: String?
    public var isArchived: Bool
    public var createdAt: String
    public var creditLimit: Double?
    public var statementDay: Int?
    /// Eski form her karta 10 yazdı — web YOK SAYAR; son ödeme günü payment_plans'ta.
    public var dueDay: Int?
    /// Asgari ödeme %. 3 = eski varsayılan → "girilmemiş" sayılır (web).
    public var minPayPct: Double?
    /// Kesimden son ödemeye gün farkı (0023)
    public var dueGapDays: Int?
    /// 'due' | 'both' (0023) — tatilde yalnız son ödeme mi, kesim de mi kayar
    public var holidayRule: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        type = AccountType(rawValue: raw.str("type") ?? "") ?? .checking
        currency = CurrencyCode(rawValue: raw.str("currency") ?? "") ?? .TRY
        // Web: bulut satırında balance yoktur; initialBalance yoksa 0
        initialBalance = raw.num("initialBalance") ?? 0
        color = raw.str("color") ?? "#14B8A6"
        icon = raw.str("icon")
        isArchived = raw.flag("isArchived") ?? false
        createdAt = raw.str("createdAt") ?? ""
        creditLimit = raw.num("creditLimit")
        statementDay = raw.num("statementDay").map { Int($0.rounded()) }
        dueDay = raw.int("dueDay")
        minPayPct = raw.num("minPayPct")
        dueGapDays = raw.num("dueGapDays").map { Int($0.rounded()) }
        holidayRule = raw.str("holidayRule")
    }

    public func ownedColumns() -> JSONObject { [:] }   // ilk aşamada hesaplar salt okunur
}

// MARK: - Category

public enum CategoryScope: String, Sendable { case expense, income }

public struct Category: SyncRecord, Hashable {
    public static let table = "categories"
    public let raw: JSONObject
    public let id: String
    public var name: String
    public var icon: String
    public var color: String
    public var scope: CategoryScope
    public var parentId: String?
    public var isArchived: Bool
    public var sortOrder: Double

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        icon = raw.str("icon") ?? ""
        color = raw.str("color") ?? "#6B7280"
        scope = CategoryScope(rawValue: raw.str("scope") ?? "") ?? .expense
        parentId = raw.str("parentId")
        isArchived = raw.flag("isArchived") ?? false
        sortOrder = raw.num("sortOrder") ?? 0
    }

    public func ownedColumns() -> JSONObject { [:] }
}

// MARK: - Budget

public enum BudgetStatus: String, Sendable { case ok, warning, exceeded }

public struct Budget: SyncRecord, Hashable {
    public static let table = "budgets"
    public var raw: JSONObject
    public let id: String
    /// Düz kimlik YA DA çok kategorili bütçede JSON dizisi ('["a","b"]').
    public var categoryId: String
    public var amount: Double
    public var period: String
    public var year: Int?
    public var month: Int?
    public var rollover: Bool
    public var alertThreshold: Double
    public var categoryName: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        categoryId = raw.str("categoryId") ?? ""
        amount = raw.num("amount") ?? 0
        period = raw.str("period") ?? "monthly"
        year = raw.int("year")
        month = raw.int("month")
        rollover = raw.flag("rollover") ?? false
        alertThreshold = raw.num("alertThreshold") ?? 80
        categoryName = raw.str("categoryName")
    }

    /// Web bütçe formunun yazdığı alanlar — yalnız değişenler (ya da satırda
    /// olmayanlar); eski year/month alanlarına dokunulmaz.
    public func ownedColumns() -> JSONObject {
        let before = Budget(raw: raw)
        var out: JSONObject = ["id": .string(id)]
        func put(_ key: String, _ value: JSONValue, _ changed: Bool) {
            if changed || raw[key] == nil { out[key] = value }
        }
        put("categoryId", .string(categoryId), categoryId != before.categoryId)
        put("categoryName", JSONValue(categoryName), categoryName != before.categoryName)
        put("amount", .number(amount), amount != before.amount)
        put("period", .string(period), period != before.period)
        put("rollover", .bool(rollover), rollover != before.rollover)
        put("alertThreshold", .number(alertThreshold), alertThreshold != before.alertThreshold)
        return out
    }
}

/// Bütçe formu — web budgets/page.tsx handleSave. Tek kategori düz kimlik, çok
/// kategori JSON dizisi; categoryName seçilen canlı kategorilerin adları.
public struct BudgetDraft: Equatable, Sendable {
    public var categoryIds: [String] = []
    public var amountText = ""
    public var alertThreshold = 80
    public var rollover = false

    public init() {}

    public init(editing b: Budget) {
        categoryIds = Calc.budgetCategoryIds(b)
        amountText = Fmt.amountInput(b.amount)
        alertThreshold = Int(b.alertThreshold)
        rollover = b.rollover
    }

    public var amount: Double { Fmt.parseAmount(amountText) }

    public func validationError() -> String? {
        if categoryIds.isEmpty { return "En az bir kategori seçin." }
        if amount <= 0 { return "Tutar girin." }
        return nil
    }

    public func build(editing: Budget?, categories: [Category], workspaceId: String?,
                      id: String = UUID().uuidString.lowercased()) -> Budget {
        var b = editing ?? Budget(raw: ["id": .string(id), "period": "monthly", "deleted_at": .null,
                                        "workspaceId": JSONValue(workspaceId)])
        b.categoryId = categoryIds.count == 1 ? categoryIds[0] : Self.jsonArray(categoryIds)
        let names = categoryIds.compactMap { id in categories.first { $0.id == id }?.name }
        b.categoryName = names.joined(separator: ", ")
        b.amount = amount
        b.alertThreshold = Double(alertThreshold > 0 ? alertThreshold : 80)
        b.rollover = rollover
        if editing == nil { b.period = "monthly" }
        return b
    }

    /// JS JSON.stringify(["a","b"]) → '["a","b"]' (boşluksuz)
    static func jsonArray(_ ids: [String]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: ids, options: [.withoutEscapingSlashes])) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - Transaction

public enum TransactionType: String, CaseIterable, Sendable {
    case expense, income, transfer

    public var label: String {
        switch self { case .expense: "Gider"; case .income: "Gelir"; case .transfer: "Transfer" }
    }
}

public enum ApprovalStatus: String, Sendable { case pending, approved }

public struct CategorySplit: Hashable, Sendable {
    public var categoryId: String
    public var amount: Double
    public init(categoryId: String, amount: Double) {
        self.categoryId = categoryId
        self.amount = amount
    }
}

public struct Transaction: SyncRecord, Hashable {
    public static let table = "transactions"
    public var raw: JSONObject
    public let id: String
    public var type: TransactionType
    public var amount: Double
    public var amountTry: Double?
    public var currency: CurrencyCode
    public var date: String
    public var accountId: String
    public var toAccountId: String?
    public var categoryId: String?
    public var description: String
    public var notes: String?
    public var approvalStatus: ApprovalStatus?
    public var approvedAt: String?
    public var createdAt: String

    // Salt okunur (iOS yazmaz; ham satırla geri gider)
    public let categorySplits: [CategorySplit]?
    public let icon: String?
    public let tags: [String]?
    public let merchant: String?
    public let isInstallment: Bool
    public let installGroupId: String?
    public let installIndex: Int?
    public let installTotal: Int?
    public let debtId: String?
    public let debtPrincipalId: String?
    public let refundOfId: String?
    public let systemKind: String?
    public let workspaceTransferId: String?
    public let familyMemberId: String?
    public let recipientId: String?

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        type = TransactionType(rawValue: raw.str("type") ?? "") ?? .expense
        amount = raw.num("amount") ?? 0
        amountTry = raw.num("amountTry")
        currency = CurrencyCode(rawValue: raw.str("currency") ?? "") ?? .TRY
        date = raw.str("date") ?? ""
        accountId = raw.str("accountId") ?? ""
        toAccountId = raw.str("toAccountId")
        categoryId = raw.str("categoryId")
        description = raw.str("description") ?? ""
        notes = raw.str("notes")
        approvalStatus = raw.str("approvalStatus").flatMap(ApprovalStatus.init(rawValue:))
        approvedAt = raw.str("approvedAt")
        createdAt = raw.str("createdAt") ?? ""

        categorySplits = raw["categorySplits"]?.array?.compactMap { v in
            guard let o = v.object, let c = o.str("categoryId"), let a = o.num("amount") else { return nil }
            return CategorySplit(categoryId: c, amount: a)
        }
        icon = raw.str("icon")
        tags = raw["tags"]?.array?.compactMap(\.string)
        merchant = raw.str("merchant")
        isInstallment = raw.flag("isInstallment") ?? false
        installGroupId = raw.str("installGroupId")
        installIndex = raw.int("installIndex")
        installTotal = raw.int("installTotal")
        debtId = raw.str("debtId")
        debtPrincipalId = raw.str("debtPrincipalId")
        refundOfId = raw.str("refundOfId")
        systemKind = raw.str("systemKind")
        workspaceTransferId = raw.str("workspaceTransferId")
        familyMemberId = raw.str("familyMemberId")
        recipientId = raw.str("recipientId")
    }

    public func ownedColumns() -> JSONObject {
        [
            "id": .string(id),
            "type": .string(type.rawValue),
            "amount": .number(amount),
            "amountTry": JSONValue(amountTry),
            "currency": .string(currency.rawValue),
            "date": .string(date),
            "accountId": .string(accountId),
            "toAccountId": JSONValue(toAccountId),
            "categoryId": JSONValue(categoryId),
            "description": .string(description),
            "notes": JSONValue(notes),
            "approvalStatus": JSONValue(approvalStatus?.rawValue),
            "approvedAt": JSONValue(approvedAt),
            "createdAt": JSONValue(createdAt.isEmpty ? nil : createdAt),
        ]
    }

    /// Tekrarlayandan türetilmiş sanal (yazılmamış) satır mı? Şablon kimliği.
    public var plannedRecurringId: String? {
        systemKind == "planned-recurring" ? raw.str("recurringId") : nil
    }

    /// Web'de başka kayıtlarla BAĞI olan satırlar: düzenleme/silme yan etkileri
    /// (borç ödemesi geri alma, taksit grubu, çalışma alanı transferinin karşı
    /// bacağı, yatırım bağlı satırlar, kategori payları, mutabakat) yalnız web'de
    /// doğru uygulanıyor. iOS bunları salt okunur gösterir.
    public var isLinked: Bool {
        debtId != nil || debtPrincipalId != nil || installGroupId != nil || isInstallment
            || workspaceTransferId != nil || icon != nil || systemKind != nil
            || (categorySplits?.count ?? 0) > 1 || refundOfId != nil
    }
}
