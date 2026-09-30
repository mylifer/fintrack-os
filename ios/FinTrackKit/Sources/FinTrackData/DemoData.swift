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
            if type == "credit_card" { raw["statementDay"] = 20 }
            return Account(raw: raw)
        }
        var accounts = [
            account("acc-bank", "Garanti Vadesiz", "checking", "TRY", 42_500, "#14B8A6"),
            account("acc-card", "Bonus Kart", "credit_card", "TRY", 0, "#8B5CF6", limit: 60_000),
            account("acc-cash", "Nakit", "cash", "TRY", 1_850, "#22C55E"),
            account("acc-usd", "Dolar Hesabı", "savings", "USD", 1_264.95, "#3B82F6"),
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
            let amount = Money.round(amount)
            var raw: JSONObject = ["id": .string("t\(n)"), "type": .string(type), "amount": .number(amount),
                                   "amountTry": .number(amount), "currency": "TRY", "date": .string(day(offset)),
                                   "accountId": .string(account), "toAccountId": JSONValue(to),
                                   "categoryId": JSONValue(cat), "description": .string(desc),
                                   "isInstallment": .bool(false), "createdAt": .string("2026-09-01T10:00:0\(n % 10).000Z"),
                                   "workspaceId": .string(ws)]
            for (k, v) in extra { raw[k] = v }
            return Transaction(raw: raw)
        }
        // Geçmiş 5 ay: grafikler ve karşılaştırmalar boş görünmesin
        var history: [Transaction] = []
        var bankNet = 0.0
        for k in 1...5 {
            let m = cal.date(byAdding: .month, value: -k, to: today)!
            func on(_ d: Int) -> Int {
                var c = cal.dateComponents([.year, .month], from: m); c.day = d
                return cal.dateComponents([.day], from: today, to: cal.date(from: c)!).day!
            }
            let wobble = Double((k * 37) % 9) * 350
            history += [
                tx("income", 65_000, on(1), "acc-bank", "c-maas", "Maaş"),
                tx("expense", 22_000, on(2), "acc-bank", "c-kira", "Kira"),
                tx("expense", 3_800 + wobble, on(8), "acc-card", "c-market", "Migros"),
                tx("expense", 1_600 + wobble / 2, on(14), "acc-card", "c-yakit", "Shell"),
                tx("expense", 1_900 - wobble / 3, on(19), "acc-card", "c-yemek", "Yemeksepeti"),
                tx("expense", 1_050, on(21), "acc-bank", "c-fatura", "Elektrik faturası"),
                tx("expense", 380, on(24), "acc-card", "c-kahve", "Starbucks"),
                tx("expense", k >= 3 ? 199.99 : 229.99, on(28), "acc-card", "c-abonelik", "Netflix", extra: ["tags": .array(["abonelik"])]),
                tx("expense", 99.99, on(12), "acc-card", "c-abonelik", "Spotify Premium", extra: ["tags": .array(["abonelik"])]),
                tx("expense", 12.99, on(3), "acc-usd", "c-abonelik", "iCloud+", extra: ["tags": .array(["abonelik"]), "currency": "USD", "amountTry": 535]),
            ]
            let card = 3_800 + wobble + 1_600 + wobble / 2 + 1_900 - wobble / 3 + 380 + (k >= 3 ? 199.99 : 229.99) + 99.99
            history.append(tx("transfer", Money.round(card), on(26), "acc-bank", nil, "Kart ödemesi", to: "acc-card"))
            bankNet += 65_000 - 22_000 - 1_050 - Money.round(card)
        }
        // Bugünkü demo bakiyeleri değişmesin: geçmişin etkisi açılış bakiyesinden düşülür
        accounts[0] = account("acc-bank", "Garanti Vadesiz", "checking", "TRY", 42_500 - bankNet, "#14B8A6")
        let transactions = history + [
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
            tx("expense", 385, -1, "acc-bank", "c-fatura", "Su faturası", extra: ["approvalStatus": "pending"]),
        ]

        func inv(_ id: String, _ type: String, _ asset: String, _ qty: Double, _ price: Double, _ offset: Int) -> InvestmentTransaction {
            InvestmentTransaction(raw: ["id": .string(id), "type": .string(type), "asset": .string(asset),
                                        "quantity": .number(qty), "pricePerUnit": .number(price),
                                        "date": .string(day(offset)), "createdAt": .string(day(offset)),
                                        "workspaceId": .string(ws)])
        }
        let investments = [
            inv("i1", "buy", "GOLD_GRAM", 20, 3_950, -200),
            inv("i2", "buy", "GOLD_QUARTER", 3, 6_400, -120),
            inv("i3", "buy", "TEFAS:AFA", 12_000, 1.05, -90),
            inv("i4", "buy", "TEFAS:AFA", 3_000, 1.18, -30),
            inv("i5", "sell", "TEFAS:AFA", 2_000, 1.25, -10),
            inv("i6", "buy", "USD", 500, 39.8, -150),
            inv("i7", "buy", "BIST:THYAO", 40, 285, -60),
            inv("i8", "buy", "CRYPTO:BTC", 0.01, 3_600_000, -45),
        ]

        func debt(_ id: String, _ name: String, _ type: String, _ dir: String, _ total: Double, _ paid: Double,
                  monthly: Double? = nil, inst: (Int, Int)? = nil, due: Int? = nil, who: String? = nil) -> Debt {
            var raw: JSONObject = ["id": .string(id), "name": .string(name), "type": .string(type),
                                   "direction": .string(dir), "totalAmount": .number(total), "paidAmount": .number(paid),
                                   "startDate": .string(day(-300)), "isSettled": .bool(paid >= total),
                                   "createdAt": .string(day(-300)), "workspaceId": .string(ws),
                                   "counterparty": JSONValue(who), "monthlyPayment": JSONValue(monthly)]
            if let inst { raw["totalInstallments"] = .number(Double(inst.0)); raw["paidInstallments"] = .number(Double(inst.1)) }
            if let due { raw["dueDate"] = .string(day(due)) }
            return Debt(raw: raw)
        }
        let debts = [
            debt("d1", "İhtiyaç kredisi", "bank_loan", "owe", 120_000, 45_000, monthly: 7_500, inst: (16, 6), due: 8, who: "Garanti BBVA"),
            debt("d2", "Ahmet'e borç", "personal", "owe", 15_000, 5_000, due: -3, who: "Ahmet"),
            debt("d3", "Ayşe'den alacak", "personal", "owed", 8_000, 2_000, who: "Ayşe"),
            debt("d4", "Eski kart borcu", "credit_card_debt", "owe", 10_000, 10_000),
        ]

        func recurring(_ id: String, _ name: String, _ type: String, _ amount: Double, _ freq: String,
                       start: Int, next: Int, _ account: String, _ cat: String?, active: Bool = true) -> RecurringTransaction {
            RecurringTransaction(raw: ["id": .string(id), "name": .string(name), "type": .string(type),
                                       "amount": .number(amount), "currency": "TRY", "accountId": .string(account),
                                       "categoryId": JSONValue(cat), "description": .string(name),
                                       "frequency": .string(freq), "startDate": .string(day(start)),
                                       "nextDueDate": .string(day(next)), "isActive": .bool(active),
                                       "createdAt": .string(day(start)), "workspaceId": .string(ws)])
        }
        let recurringList = [
            recurring("r-kira", "Kira", "expense", 22_000, "monthly", start: -150, next: 2, "acc-bank", "c-kira"),
            recurring("r-maas", "Maaş", "income", 68_000, "monthly", start: -150, next: 5, "acc-bank", "c-maas"),
            recurring("r-netflix", "Netflix", "expense", 229.99, "monthly", start: -90, next: -2, "acc-card", "c-abonelik"),
            recurring("r-spor", "Spor salonu", "expense", 1_500, "monthly", start: -200, next: -40, "acc-card", nil, active: false),
            recurring("r-sigorta", "Kasko", "expense", 14_500, "yearly", start: -300, next: 65, "acc-bank", "c-ulasim"),
        ]

        func goal(_ id: String, _ name: String, _ target: Double, date: Int?, saved: Double? = nil,
                  account: String? = nil, _ color: String) -> SavingsGoal {
            SavingsGoal(raw: ["id": .string(id), "name": .string(name), "targetAmount": .number(target),
                              "targetDate": JSONValue(date.map(day)), "accountId": JSONValue(account),
                              "savedAmount": JSONValue(saved), "color": .string(color),
                              "createdAt": .string(day(-100)), "workspaceId": .string(ws)])
        }
        let goals = [
            goal("g-tatil", "Yaz tatili", 60_000, date: 270, saved: 18_500, "#3B82F6"),
            goal("g-acil", "Acil durum fonu", 50_000, date: nil, account: "acc-usd", "#10B981"),
            goal("g-telefon", "Yeni telefon", 45_000, date: -5, saved: 45_000, "#8B5CF6"),
        ]

        var snap = Snapshot(workspaces: workspaces, accounts: accounts, categories: categories,
                            budgets: budgets, transactions: transactions, investments: investments, debts: debts)
        snap.paymentPlans = [PaymentPlan(raw: [
            "id": .string(DeterministicID.uuid("payplan:card:acc-card")), "targetKind": "card", "targetId": "acc-card",
            "dayOfMonth": 30, "isActive": true, "fromAccountId": "acc-bank", "workspaceId": .string(ws),
        ])]
        snap.recurring = recurringList
        snap.goals = goals
        return snap
    }

    static func prices() -> PriceBook {
        var b = PriceBook()
        b.usdTry = 41.2; b.eurTry = 48.3; b.gbpTry = 55.4
        b.prevUsdTry = 41.1; b.prevEurTry = 48.1; b.prevGbpTry = 55.3
        b.goldGramTry = 4_520; b.prevGoldGramTry = 4_480
        b.goldQuarterTry = 7_380; b.prevGoldQuarterTry = 7_310
        b.quotes = [
            "AFA": .init(name: "Ak Portföy Amerikan Yabancı Hisse Fonu", price: 1.31, prevPrice: 1.30, date: "2026-09-25"),
            "BIST:THYAO": .init(name: "Türk Hava Yolları", price: 312.5, prevPrice: 318, date: "2026-09-26"),
            "CRYPTO:BTC": .init(name: "Bitcoin", price: 4_150_000, prevPrice: 4_090_000, date: "2026-09-26"),
        ]
        b.updatedAt = Date()
        return b
    }
}
#endif
