import Foundation
import Observation
import FinTrackCore

/// Uygulamanın tek durum kaynağı. Web'deki store'ların (accounts/transactions/
/// categories/budgets/workspace) iOS'taki karşılığı — ilk aşamanın ihtiyacı kadar.
@MainActor
@Observable
public final class AppModel {
    public enum Phase: Equatable { case starting, missingConfig, ready }

    public private(set) var phase: Phase = .starting
    public private(set) var auth: AuthState = .signedOut
    public private(set) var isRefreshing = false
    public private(set) var lastSync: Date?
    public var lastError: String?

    public private(set) var workspaces: [Workspace] = []
    public private(set) var activeWorkspaceId: String?
    private var defaultWorkspaceId: String?
    private var memberIds: [String] = []

    // Aktif çalışma alanına ait CANLI satırlar
    public private(set) var accounts: [Account] = []
    public private(set) var categories: [Category] = []
    public private(set) var budgets: [Budget] = []
    public private(set) var transactions: [Transaction] = []   // tarih ↓, createdAt ↓
    public private(set) var balances: [String: Double] = [:]  // hesap id → kendi para biriminde
    public private(set) var fx = FX()

    // Tüm alanlar (çalışma alanı değişince yeniden süzmek için)
    private var all = Snapshot()

    private var service: SupabaseService?
    private let cache = LocalCache()
    /// DEBUG örnek veri modu (simülatörde ekran doğrulama): buluta hiçbir şey yazılmaz.
    private var isDemo = false
    private static let activeKey = "fintrack.activeWorkspaceId"

    public init() {}

    public var userId: String? {
        if case .signedIn(let id, _) = auth { return id }
        return nil
    }

    public var email: String? {
        if case .signedIn(_, let e) = auth { return e }
        return nil
    }

    // MARK: Başlangıç / oturum

    public func start(config: AppConfig?) async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-demo") {
            isDemo = true
            auth = .signedIn(userId: "demo", email: "demo@fintrack.local")
            apply(DemoData.snapshot())
            fx = FX(rates: FXRates(usdTry: 41.2, eurTry: 48.3, gbpTry: 55.4))
            recomputeBalances()
            phase = .ready
            return
        }
        #endif
        guard let config else { phase = .missingConfig; return }
        let service = SupabaseService(config: config)
        self.service = service
        auth = await service.currentAuthState()
        phase = .ready
        if let uid = userId {
            if let snap = cache.load(userId: uid) { apply(snap) }   // çevrimdışı açılış
            await refresh()
        }
    }

    public func signIn(email: String, password: String) async {
        guard let service else { return }
        lastError = nil
        do {
            auth = try await service.signIn(email: email, password: password)
            if userId != nil { await refresh() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func verifyMFA(code: String) async {
        guard let service, case .needsMFA(let factorId) = auth else { return }
        lastError = nil
        do {
            auth = try await service.verifyMFA(factorId: factorId, code: code)
            if userId != nil { await refresh() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func signOut() async {
        if !isDemo, let uid = userId { cache.clear(userId: uid) }
        await service?.signOut()
        auth = .signedOut
        all = Snapshot()
        workspaces = []
        activeWorkspaceId = nil
        rescope()
    }

    // MARK: Çekiş

    /// Buluttan tam okuma. Bir tablo bile okunamazsa mevcut veri korunur.
    public func refresh() async {
        guard !isDemo, let service, let uid = userId, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        async let rates = RatesService.fetch()

        // Üyelikler ÖNCE: çekiş filtresi paylaşılan alanları bunlardan bilir
        let m = await service.memberWorkspaceIds(userId: uid)
        if m.complete { memberIds = m.ids }
        let members = memberIds

        do {
            async let ws = service.fetchAll(Workspace.self, userId: uid, memberIds: members)
            async let ac = service.fetchAll(Account.self, userId: uid, memberIds: members)
            async let ca = service.fetchAll(Category.self, userId: uid, memberIds: members)
            async let bu = service.fetchAll(Budget.self, userId: uid, memberIds: members)
            async let tx = service.fetchAll(Transaction.self, userId: uid, memberIds: members)
            let snap = Snapshot(workspaces: try await ws, accounts: try await ac, categories: try await ca,
                                budgets: try await bu, transactions: try await tx)
            apply(snap)
            cache.save(snap, userId: uid)
            lastSync = Date()
            lastError = nil
        } catch {
            if (error as NSError).code == NSURLErrorCancelled { return }
            lastError = "Veriler güncellenemedi. Bağlantınızı kontrol edin."
        }

        if let r = await rates {
            fx = FX(rates: r)
            recomputeBalances()
        }
    }

    public func setActiveWorkspace(_ id: String) {
        activeWorkspaceId = id
        UserDefaults.standard.set(id, forKey: Self.activeKey)
        rescope()
    }

    private func apply(_ snap: Snapshot) {
        all = snap
        let live = snap.workspaces.filter(\.isLive).sorted {
            $0.isDefault != $1.isDefault ? $0.isDefault : $0.createdAt < $1.createdAt
        }
        workspaces = live
        defaultWorkspaceId = (live.first { $0.isDefault } ?? live.first)?.id
        let persisted = UserDefaults.standard.string(forKey: Self.activeKey)
        activeWorkspaceId = live.contains { $0.id == persisted } ? persisted : defaultWorkspaceId
        rescope()
    }

    /// workspaceId taşımayan (eski) satırlar varsayılan alana aittir (web rowInWorkspace).
    private func inActive<T: SyncRecord>(_ r: T) -> Bool {
        r.isLive && (r.workspaceId ?? defaultWorkspaceId) == activeWorkspaceId
    }

    private func rescope() {
        accounts = all.accounts.filter(inActive).sorted { $0.createdAt < $1.createdAt }
        categories = all.categories.filter(inActive).sorted { $0.sortOrder < $1.sortOrder }
        budgets = all.budgets.filter(inActive)
        transactions = all.transactions.filter(inActive).sorted(by: Self.txOrder)
        recomputeBalances()
    }

    private static func txOrder(_ a: Transaction, _ b: Transaction) -> Bool {
        let da = a.date.prefix(10), db = b.date.prefix(10)
        return da != db ? da > db : a.createdAt > b.createdAt
    }

    private func recomputeBalances() {
        let posted = Calc.excludeFuture(transactions)
        var out: [String: Double] = [:]
        for a in accounts { out[a.id] = Calc.balance(of: a, posted: posted, fx: fx) }
        balances = out
    }

    // MARK: Türetilmiş

    public func account(_ id: String?) -> Account? {
        guard let id else { return nil }
        return accounts.first { $0.id == id } ?? all.accounts.first { $0.id == id }
    }

    public func category(_ id: String?) -> Category? {
        guard let id else { return nil }
        return categories.first { $0.id == id } ?? all.categories.first { $0.id == id }
    }

    public var activeAccounts: [Account] { accounts.filter { !$0.isArchived } }

    public var netWorth: Double { Calc.netWorth(accounts, balances: balances, fx: fx) }

    public var hasForeignAccountsWithoutRates: Bool {
        fx.rates == nil && activeAccounts.contains { $0.currency != .TRY }
    }

    public func budgetStates(_ my: MonthYear = .current()) -> [Calc.BudgetState] {
        budgets.map { Calc.enrichBudget($0, transactions, my, categories: categories, fx: fx) }
            .sorted { $0.percentUsed > $1.percentUsed }
    }

    public func pickerCategories(for type: TransactionType) -> [Category] {
        let scope: CategoryScope = type == .income ? .income : .expense
        return categories.filter { $0.scope == scope && !$0.isArchived }
    }

    // MARK: Yazma

    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// JS toISOString ile aynı biçim ("2026-09-26T10:00:00.000Z") — keep_newer_row
    /// damgaları metin olarak kıyaslar, biçim birebir olmalı.
    static func nowISO() -> String { iso.string(from: Date()) }

    /// Yeni işlem ya da var olan işlemin düzenlemesi.
    public func save(_ draft: TransactionDraft, editing: Transaction?) async throws {
        guard let uid = userId else { throw ServiceError.notSignedIn }
        if let e = draft.validationError() { throw ServiceError.message(e) }
        guard let account = account(draft.accountId) else { throw ServiceError.message("Hesap bulunamadı.") }
        if let editing, editing.isLinked {
            throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den düzenleyin.")
        }
        let now = Self.nowISO()
        let record = editing.map { draft.applying(to: $0, account: account, fx: fx) }
            ?? draft.makeNew(account: account, workspaceId: activeWorkspaceId, fx: fx, now: now)
        if !isDemo {
            guard let service else { throw ServiceError.notSignedIn }
            try await service.upsert(record, userId: uid, now: now)
        }
        var raw = record.rowForWrite(updatedAt: now)
        raw["user_id"] = .string(uid)
        replaceLocal(Transaction(raw: raw))
    }

    /// Silme = tombstone (deleted_at), gerçek DELETE yok.
    public func delete(_ t: Transaction) async throws {
        guard let uid = userId else { throw ServiceError.notSignedIn }
        if t.isLinked { throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den silin.") }
        let now = Self.nowISO()
        let dead = t.tombstoned(at: now)
        if !isDemo {
            guard let service else { throw ServiceError.notSignedIn }
            try await service.upsert(dead, userId: uid, now: now)
        }
        replaceLocal(Transaction(raw: dead.rowForWrite(updatedAt: now)))
    }

    private func replaceLocal(_ t: Transaction) {
        if let i = all.transactions.firstIndex(where: { $0.id == t.id }) {
            all.transactions[i] = t
        } else {
            all.transactions.append(t)
        }
        rescope()
        if !isDemo, let uid = userId { cache.save(all, userId: uid) }
    }
}

struct Snapshot {
    var workspaces: [Workspace] = []
    var accounts: [Account] = []
    var categories: [Category] = []
    var budgets: [Budget] = []
    var transactions: [Transaction] = []
}
