import Foundation
import FinTrackCore

/// Son başarılı çekişin ham satırları — uygulama çevrimdışı açılınca ekran boş
/// kalmasın diye. Yalnız OKUMA önbelleği: yazmalar her zaman önce buluta gider.
/// Dosya cihaz kilitliyken okunamaz (complete file protection), yedeğe girmez;
/// çıkışta silinir.
struct LocalCache {
    private struct Stored: Codable {
        var workspaces: [JSONObject]
        var accounts: [JSONObject]
        var categories: [JSONObject]
        var budgets: [JSONObject]
        var transactions: [JSONObject]
        var investments: [JSONObject]?
        var debts: [JSONObject]?
        var recurring: [JSONObject]?
        var goals: [JSONObject]?
        var paymentPlans: [JSONObject]?
        var paymentOccurrences: [JSONObject]?
    }

    private func url(_ userId: String) -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cache-\(userId).json")
    }

    func save(_ s: Snapshot, userId: String) {
        guard let url = url(userId) else { return }
        let stored = Stored(workspaces: s.workspaces.map(\.raw), accounts: s.accounts.map(\.raw),
                            categories: s.categories.map(\.raw), budgets: s.budgets.map(\.raw),
                            transactions: s.transactions.map(\.raw),
                            investments: s.investments.map(\.raw), debts: s.debts.map(\.raw),
                            recurring: s.recurring.map(\.raw), goals: s.goals.map(\.raw),
                            paymentPlans: s.paymentPlans.map(\.raw),
                            paymentOccurrences: s.paymentOccurrences.map(\.raw))
        guard let data = try? JSONEncoder().encode(stored) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
        // Buluttan yeniden çekilebilir: finans verisi cihaz yedeğine (iCloud) girmesin
        var u = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? u.setResourceValues(values)
    }

    func load(userId: String) -> Snapshot? {
        guard let url = url(userId), let data = try? Data(contentsOf: url),
              let s = try? JSONDecoder().decode(Stored.self, from: data) else { return nil }
        return Snapshot(workspaces: s.workspaces.map(Workspace.init(raw:)),
                        accounts: s.accounts.map(Account.init(raw:)),
                        categories: s.categories.map(Category.init(raw:)),
                        budgets: s.budgets.map(Budget.init(raw:)),
                        transactions: s.transactions.map(Transaction.init(raw:)),
                        investments: (s.investments ?? []).map(InvestmentTransaction.init(raw:)),
                        debts: (s.debts ?? []).map(Debt.init(raw:)),
                        recurring: (s.recurring ?? []).map(RecurringTransaction.init(raw:)),
                        goals: (s.goals ?? []).map(SavingsGoal.init(raw:)),
                        paymentPlans: (s.paymentPlans ?? []).map(PaymentPlan.init(raw:)),
                        paymentOccurrences: (s.paymentOccurrences ?? []).map(PaymentOccurrence.init(raw:)))
    }

    func clear(userId: String) {
        guard let url = url(userId) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
