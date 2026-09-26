#if DEBUG
import Foundation
import FinTrackCore

/// Simülatörde ekranları gerçek veriye dokunmadan doğrulamak için örnek veri
/// (`-demo` başlatma argümanı; yalnız DEBUG derlemede var).
enum DemoData {
    static func snapshot(today: Date = Date()) -> Snapshot {
        let cal = DateUtil.calendar
        func day(_ offset: Int) -> String { DateUtil.day(cal.date(byAdding: .day, value: offset, to: today)!) }
        let ws = "ws-genel"

        let workspaces = [Workspace(raw: ["id": .string(ws), "name": "Genel", "isDefault": .bool(true), "createdAt": "2026-01-01"])]

        func account(_ id: String, _ name: String, _ type: String, _ cur: String, _ initial: Double,
                     _ color: String, limit: Double? = nil) -> Account {
            var raw: JSONObject = ["id": .string(id), "name": .string(name), "type": .string(type),
                                   "currency": .string(cur), "initialBalance": .number(initial),
                                   "color": .string(color), "isArchived": .bool(false),
                                   "createdAt": .string("2026-01-0\(id.count % 9 + 1)"), "workspaceId": .string(ws)]
            if let limit { raw["creditLimit"] = .number(limit) }
            return Account(raw: raw)
        }
        let accounts = [
            account("acc-bank", "Garanti Vadesiz", "checking", "TRY", 42_500, "#14B8A6"),
            account("acc-card", "Bonus Kart", "credit_card", "TRY", 0, "#8B5CF6", limit: 60_000),
            account("acc-cash", "Nakit", "cash", "TRY", 1_850, "#22C55E"),
            account("acc-usd", "Dolar Hesabı", "savings", "USD", 1_200, "#3B82F6"),
        ]

        func cat(_ id: String, _ name: String, _ icon: String, _ color: String, _ order: Double,
                 _ scope: String = "expense", parent: String? = nil) -> Category {
            Category(raw: ["id": .string(id), "name": .string(name), "icon": .string(icon), "color": .string(color),
                           "scope": .string(scope), "parentId": JSONValue(parent), "isSystem": .bool(true),
                           "sortOrder": .number(order), "workspaceId": .string(ws)])
        }
        let categories = [
            cat("c-yemek", "Yemek", "tools-kitchen-2", "#F97316", 1),
            cat("c-market", "Market", "shopping-cart", "#22C55E", 2),
            cat("c-kahve", "Kahve ve Cafe", "coffee", "#713F12", 3),
            cat("c-ulasim", "Ulaşım", "car", "#3B82F6", 4),
            cat("c-yakit", "Yakıt", "gas-station", "#1D4ED8", 45, parent: "c-ulasim"),
            cat("c-ev", "Ev", "home", "#F59E0B", 5),
            cat("c-kira", "Kira", "key", "#B45309", 53, parent: "c-ev"),
            cat("c-fatura", "Faturalar", "receipt", "#14B8A6", 7),
            cat("c-abonelik", "Abonelikler", "refresh", "#8B5CF6", 8),
            cat("c-maas", "Maaş", "briefcase", "#10B981", 100, "income"),
        ]

        func budget(_ id: String, _ catId: String, _ amount: Double, rollover: Bool = false) -> Budget {
            Budget(raw: ["id": .string(id), "categoryId": .string(catId), "amount": .number(amount),
                         "period": "monthly", "rollover": .bool(rollover), "alertThreshold": 80,
                         "workspaceId": .string(ws)])
        }
        let budgets = [
            budget("b-market", "c-market", 6_000, rollover: true),
            budget("b-yemek", "c-yemek", 3_000),
            budget("b-ulasim", "c-ulasim", 4_000),
            budget("b-kahve", "c-kahve", 800),
        ]

        var n = 0
        func tx(_ type: String, _ amount: Double, _ offset: Int, _ account: String, _ cat: String?,
                _ desc: String, to: String? = nil, extra: JSONObject = [:]) -> Transaction {
            n += 1
            var raw: JSONObject = ["id": .string("t\(n)"), "type": .string(type), "amount": .number(amount),
                                   "amountTry": .number(amount), "currency": "TRY", "date": .string(day(offset)),
                                   "accountId": .string(account), "toAccountId": JSONValue(to),
                                   "categoryId": JSONValue(cat), "description": .string(desc),
                                   "isInstallment": .bool(false), "createdAt": .string("2026-09-01T10:00:0\(n % 10).000Z"),
                                   "workspaceId": .string(ws)]
            for (k, v) in extra { raw[k] = v }
            return Transaction(raw: raw)
        }
        let transactions = [
            tx("income", 68_000, -25, "acc-bank", "c-maas", "Eylül maaşı"),
            tx("expense", 22_000, -24, "acc-bank", "c-kira", "Kira"),
            tx("expense", 1_240.5, -20, "acc-card", "c-market", "Migros"),
            tx("expense", 2_150, -12, "acc-card", "c-market", "Carrefour haftalık"),
            tx("expense", 1_890, -9, "acc-card", "c-yakit", "Shell"),
            tx("expense", 685, -6, "acc-card", "c-yemek", "Akşam yemeği"),
            tx("expense", 145, -2, "acc-cash", "c-kahve", "Kahve Dünyası"),
            tx("expense", 1_430.75, -1, "acc-card", "c-market", "A101"),
            tx("expense", 320, 0, "acc-card", "c-yemek", "Öğle yemeği"),
            tx("expense", 210, 0, "acc-cash", "c-kahve", "Starbucks"),
            tx("transfer", 5_000, -3, "acc-bank", nil, "Kart ödemesi", to: "acc-card"),
            tx("expense", 2_000, -15, "acc-card", "c-abonelik", "Kulaklık",
               extra: ["isInstallment": .bool(true), "installGroupId": "g1", "installIndex": 1, "installTotal": 6]),
            tx("expense", 2_000, 15, "acc-card", "c-abonelik", "Kulaklık",
               extra: ["isInstallment": .bool(true), "installGroupId": "g1", "installIndex": 2, "installTotal": 6]),
            tx("expense", 1_150, 4, "acc-bank", "c-fatura", "Elektrik faturası", extra: ["approvalStatus": "pending"]),
            tx("expense", 250, -40, "acc-card", "c-kahve", "Geçen ay kahve"),
            tx("expense", 4_200, -38, "acc-card", "c-market", "Geçen ay market"),
        ]

        return Snapshot(workspaces: workspaces, accounts: accounts, categories: categories,
                        budgets: budgets, transactions: transactions)
    }
}
#endif
