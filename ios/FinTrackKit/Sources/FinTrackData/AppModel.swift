import Foundation
import Network
import Observation
import FinTrackCore
#if canImport(WidgetKit)
import WidgetKit
#endif

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
    /// Çevrimdışıyken yazılıp henüz buluta gitmemiş değişiklik sayısı
    public private(set) var pendingWrites = 0

    public private(set) var workspaces: [Workspace] = []
    public private(set) var activeWorkspaceId: String?
    private var defaultWorkspaceId: String?
    private var memberIds: [String] = []

    // Aktif çalışma alanına ait CANLI satırlar
    public private(set) var accounts: [Account] = []
    public private(set) var categories: [Category] = []
    public private(set) var budgets: [Budget] = []
    public private(set) var transactions: [Transaction] = []   // tarih ↓, createdAt ↓
    /// Analitik toplamlar için: taksitli satın almalar satın alma ayına tek satır
    /// (web collapseInstallments). Aylık gelir/gider, kategori dağılımı ve bütçeler
    /// BUNU okur; bakiye/limit ham `transactions`'ı.
    public private(set) var reportTransactions: [Transaction] = []
    public private(set) var balances: [String: Double] = [:]  // hesap id → kendi para biriminde
    public private(set) var fx = FX()
    public private(set) var investments: [InvestmentTransaction] = []
    public private(set) var debts: [Debt] = []
    public private(set) var holdings: [Holding] = []
    public private(set) var prices = PriceBook()
    public private(set) var recurring: [RecurringTransaction] = []
    public private(set) var goals: [SavingsGoal] = []
    public private(set) var paymentPlans: [PaymentPlan] = []
    public private(set) var paymentOccurrences: [PaymentOccurrence] = []

    // Tüm alanlar (çalışma alanı değişince yeniden süzmek için)
    private var all = Snapshot()

    private var service: SupabaseService?
    private let cache = LocalCache()
    private var outbox: Outbox?
    private var isFlushing = false
    private let pathMonitor = NWPathMonitor()
    /// DEBUG örnek veri modu (simülatörde ekran doğrulama): buluta hiçbir şey yazılmaz.
    private var isDemo = false
    private static let activeKey = "fintrack.activeWorkspaceId"
    private static let pricesKey = "fintrack.prices"

    public init() {
        // Son fiyatlar: çevrimdışı açılışta portföy ve döviz hesapları sıfır görünmesin
        if let d = UserDefaults.standard.data(forKey: Self.pricesKey),
           let p = try? JSONDecoder().decode(PriceBook.self, from: d) {
            prices = p
            fx = FX(rates: p.fxRates)
        }
    }

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
            prices = DemoData.prices()
            fx = FX(rates: prices.fxRates)
            apply(DemoData.snapshot())
            phase = .ready
            return
        }
        #endif
        guard let config else { phase = .missingConfig; return }
        let service = SupabaseService(config: config)
        self.service = service
        auth = await service.currentAuthState()
        phase = .ready
        startPathMonitor()
        if let uid = userId {
            openOutbox(uid)
            if let snap = cache.load(userId: uid) { apply(snap) }   // çevrimdışı açılış
            await refresh()
        }
    }

    public func signIn(email: String, password: String) async {
        guard let service else { return }
        lastError = nil
        do {
            auth = try await service.signIn(email: email, password: password)
            if let uid = userId { openOutbox(uid); await refresh() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func verifyMFA(code: String) async {
        guard let service, case .needsMFA(let factorId) = auth else { return }
        lastError = nil
        do {
            auth = try await service.verifyMFA(factorId: factorId, code: code)
            if let uid = userId { openOutbox(uid); await refresh() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// `discardPending`: kullanıcı kendisi çıkıyorsa gönderilmemiş değişiklikler
    /// de silinir; oturum kendiliğinden düştüyse kuyruk yeniden girişi bekler.
    public func signOut(discardPending: Bool = true) async {
        if !isDemo, let uid = userId { cache.clear(userId: uid) }
        if discardPending { outbox?.clear() }
        outbox = nil
        pendingWrites = 0
        await service?.signOut()
        auth = .signedOut
        all = Snapshot()
        workspaces = []
        activeWorkspaceId = nil
        rescope()
        WidgetSnapshot.clear()
        reloadWidgets()
    }

    // MARK: Çekiş

    /// Buluttan tam okuma. Bir tablo bile okunamazsa mevcut veri korunur.
    public func refresh() async {
        guard !isDemo, let service, let uid = userId, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        if outbox == nil { openOutbox(uid) }
        let rejected = await flushOutbox()

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
            async let iv = service.fetchAll(InvestmentTransaction.self, userId: uid, memberIds: members)
            async let de = service.fetchAll(Debt.self, userId: uid, memberIds: members)
            // Planlama tabloları: okunamazsa (ağ / eksik migration) eldeki kalır,
            // çekirdek veriyi bekletmez
            async let re = try? service.fetchAll(RecurringTransaction.self, userId: uid, memberIds: members)
            async let go = try? service.fetchAll(SavingsGoal.self, userId: uid, memberIds: members)
            async let pp = try? service.fetchAll(PaymentPlan.self, userId: uid, memberIds: members)
            async let po = try? service.fetchAll(PaymentOccurrence.self, userId: uid, memberIds: members)
            var snap = Snapshot(workspaces: try await ws, accounts: try await ac, categories: try await ca,
                                budgets: try await bu, transactions: try await tx,
                                investments: try await iv, debts: try await de)
            snap.recurring = await re ?? all.recurring
            snap.goals = await go ?? all.goals
            snap.paymentPlans = await pp ?? all.paymentPlans
            snap.paymentOccurrences = await po ?? all.paymentOccurrences
            // Hâlâ gönderilemeyen yerel değişiklikler buluttaki eski halin üstüne
            for e in outbox?.entries ?? [] { snap.overlay(table: e.table, row: e.row) }
            apply(snap)
            cache.save(snap, userId: uid)
            lastSync = Date()
            lastError = rejected > 0 ? "\(rejected) çevrimdışı değişiklik sunucu tarafından kabul edilmedi." : nil
        } catch {
            if (error as NSError).code == NSURLErrorCancelled { return }
            // Oturum başka yerden kapatıldıysa (şifre değişti, web'den tüm
            // cihazlardan çıkış) sessizce eski veriyle kalma — giriş ekranına dön.
            if !(await service.hasValidSession()) {
                await signOut(discardPending: false)
                lastError = "Oturumunuz sona erdi. Yeniden giriş yapın."
                return
            }
            lastError = "Veriler güncellenemedi. Bağlantınızı kontrol edin."
        }

        await refreshPrices()
    }

    /// Kurlar + portföydeki varlıkların fiyatları. Başarısızsa eski fiyatlar kalır.
    public func refreshPrices() async {
        guard !isDemo else { return }
        let assets = Set(all.investments.filter(\.isLive).map(\.asset))
        guard let book = await PricesService.fetch(assets: assets, previous: prices.hasRates ? prices : nil) else { return }
        prices = book
        fx = FX(rates: book.fxRates)
        if let d = try? JSONEncoder().encode(book) { UserDefaults.standard.set(d, forKey: Self.pricesKey) }
        recomputeBalances()
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
        investments = all.investments.filter(inActive)
        debts = all.debts.filter(inActive)
        recurring = all.recurring.filter(inActive)
            .sorted { $0.name.compare($1.name, locale: Locale(identifier: "tr_TR")) == .orderedAscending }
        goals = all.goals.filter(inActive)
        paymentPlans = all.paymentPlans.filter(inActive)
        paymentOccurrences = all.paymentOccurrences.filter(inActive)
        recomputeBalances()
    }

    private static func txOrder(_ a: Transaction, _ b: Transaction) -> Bool {
        let da = a.date.prefix(10), db = b.date.prefix(10)
        return da != db ? da > db : a.createdAt > b.createdAt
    }

    private func recomputeBalances() {
        reportTransactions = Installments.collapse(transactions, fx: fx)
        let posted = Calc.excludeFuture(transactions)
        var out: [String: Double] = [:]
        for a in accounts { out[a.id] = Calc.balance(of: a, posted: posted, fx: fx) }
        balances = out
        holdings = Portfolio.holdings(investments, prices: prices)
            .sorted { $0.currentValue > $1.currentValue }
        writeWidgetSnapshot()
    }

    // MARK: Widget

    /// Ana ekran widget'ının okuduğu özet (App Group). Widget ağa çıkmaz.
    private func writeWidgetSnapshot() {
        guard userId != nil, !isDemo else { return }   // örnek veri gerçek widget'ın üzerine yazmasın
        let my = MonthYear.current()
        let flow = Calc.monthlyFlow(reportTransactions, my, fx: fx)
        let states = budgetStates(my)
        let lines = states.prefix(3).map { s -> WidgetSnapshot.BudgetLine in
            let info = Calc.budgetLabel(s.budget, categories)
            return .init(name: info.label, colorHex: info.cats.first?.color ?? "#6B7280", spent: s.spent,
                         limit: s.limit, percent: s.percentUsed, status: s.status.rawValue)
        }
        let snap = WidgetSnapshot(
            month: String(format: "%04d-%02d", my.year, my.month), monthTitle: DateUtil.monthTitle(my),
            expense: flow.expense, income: flow.income, net: flow.net, netWorth: netWorth,
            budgetSpent: Money.sum(states) { $0.spent }, budgetLimit: Money.sum(states) { $0.limit },
            budgets: Array(lines), amountsHidden: Fmt.amountsHidden, updatedAt: Date(),
            pendingCount: dueApprovals.count + dueRecurring.count)
        let changed = snap.withoutDate != WidgetSnapshot.load()?.withoutDate
        snap.save()
        if changed { reloadWidgets() }
    }

    /// "Tutarları gizle" değişince widget da gizlesin.
    public func amountsHiddenChanged() { writeWidgetSnapshot() }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
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

    /// Hesapların toplamı (TRY; döviz hesapları kurla)
    public var accountsTotal: Double { Calc.netWorth(accounts, balances: balances, fx: fx) }
    /// Yatırımların güncel değeri (TRY)
    public var investValue: Double { Money.sum(holdings) { $0.currentValue } }
    /// Kalan borç (yalnız "borçluyum", kapanmamış)
    public var debtBurden: Double { Calc.debtBurden(debts) }
    /// Net değer — web panosu ile aynı: hesaplar + yatırımlar − kalan borç
    public var netWorth: Double { Money.sub(Money.add(accountsTotal, investValue), debtBurden) }
    /// Toplam varlık — pozitif bakiyeler + yatırımlar (brüt)
    public var totalAssets: Double {
        Money.add(Calc.netWorth(accounts, balances: balances, fx: fx, onlyPositive: true), investValue)
    }

    public var hasForeignAccountsWithoutRates: Bool {
        fx.rates == nil && activeAccounts.contains { $0.currency != .TRY }
    }

    public func budgetStates(_ my: MonthYear = .current()) -> [Calc.BudgetState] {
        budgets.map { Calc.enrichBudget($0, reportTransactions, my, categories: categories, fx: fx) }
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
        guard userId != nil else { throw ServiceError.notSignedIn }
        if let e = draft.validationError() { throw ServiceError.message(e) }
        guard let account = account(draft.accountId) else { throw ServiceError.message("Hesap bulunamadı.") }
        if let editing, editing.isLinked {
            throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den düzenleyin.")
        }
        let record = editing.map { draft.applying(to: $0, account: account, fx: fx) }
            ?? draft.makeNew(account: account, workspaceId: activeWorkspaceId, fx: fx, now: Self.nowISO())
        try await write(record, in: \.transactions)
    }

    /// Silme = tombstone (deleted_at), gerçek DELETE yok.
    public func delete(_ t: Transaction) async throws {
        guard userId != nil else { throw ServiceError.notSignedIn }
        if t.isLinked { throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den silin.") }
        try await write(t.tombstoned(at: Self.nowISO()), in: \.transactions)
    }

    /// Yerel kopyayı güncelle (bulut yazması ya da kuyruğa alma sonrası) ve önbelleğe al.
    private func replaceLocal<T: SyncRecord>(_ r: T, in kp: WritableKeyPath<Snapshot, [T]>) {
        if let i = all[keyPath: kp].firstIndex(where: { $0.id == r.id }) {
            all[keyPath: kp][i] = r
        } else {
            all[keyPath: kp].append(r)
        }
        rescope()
        if !isDemo, let uid = userId { cache.save(all, userId: uid) }
    }

    /// Tek kayıt yaz: buluta upsert, sonra yerel kopya (user_id oturumdan).
    /// Ağ yoksa satır çevrimdışı kuyruğa girer ve yerelde hemen görünür; bağlantı
    /// gelince gönderilir. Sunucu reddederse (yetki, doğrulama) hata fırlatılır.
    private func write<T: SyncRecord>(_ record: T, in kp: WritableKeyPath<Snapshot, [T]>) async throws {
        guard let uid = userId else { throw ServiceError.notSignedIn }
        let row = record.rowForWrite(updatedAt: Self.nowISO())
        if !isDemo {
            guard let service else { throw ServiceError.notSignedIn }
            do {
                try await service.upsertRow(T.table, row, userId: uid)
            } catch where SupabaseService.isNetworkError(error) {
                if outbox == nil { openOutbox(uid) }
                outbox?.enqueue(table: T.table, row: row)
                pendingWrites = outbox?.count ?? 0
            }
        }
        var raw = row
        raw["user_id"] = .string(uid)
        replaceLocal(T(raw: raw), in: kp)
    }

    // MARK: Çevrimdışı kuyruk

    private func openOutbox(_ uid: String) {
        guard !isDemo else { return }
        outbox = Outbox(userId: uid)
        pendingWrites = outbox?.count ?? 0
    }

    /// Bekleyenleri sırayla gönder. Ağ hatasında durur (sonra yeniden denenir);
    /// sunucu reddettiyse satır kuyruktan düşer — çekiş bulut halini geri getirir.
    @discardableResult
    public func flushOutbox() async -> Int {
        guard !isDemo, !isFlushing, let service, let uid = userId, let entries = outbox?.entries, !entries.isEmpty
        else { return 0 }
        isFlushing = true
        defer { isFlushing = false; pendingWrites = outbox?.count ?? 0 }
        var rejected = 0
        for e in entries.sorted(by: { $0.seq < $1.seq }) {
            do {
                try await service.upsertRow(e.table, e.row, userId: uid)
                outbox?.remove(e)
            } catch where SupabaseService.isNetworkError(error) {
                return rejected
            } catch {
                outbox?.remove(e)
                rejected += 1
            }
        }
        return rejected
    }

    /// Bağlantı gelince bekleyenleri gönder.
    private func startPathMonitor() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor [weak self] in
                guard let self, self.pendingWrites > 0 else { return }
                await self.refresh()
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "fintrack.path"))
    }

    // MARK: Onay bekleyenler

    /// Tarihi gelmiş (≤ bugün) onay bekleyen işlemler — web "future-tx-due".
    public var dueApprovals: [Transaction] {
        let today = DateUtil.today()
        return transactions.filter { Calc.awaitsApproval($0) && String($0.date.prefix(10)) <= today }
    }

    /// Önümüzdeki 7 gün içinde onay bekleyecek olanlar — web "future-tx-upcoming".
    public var upcomingApprovals: [Transaction] {
        let today = DateUtil.today()
        guard let t = DateUtil.parseDay(today),
              let h = DateUtil.calendar.date(byAdding: .day, value: 7, to: t) else { return [] }
        let horizon = DateUtil.day(h)
        return transactions.filter {
            let d = String($0.date.prefix(10))
            return Calc.awaitsApproval($0) && d > today && d <= horizon
        }
    }

    /// Onayla (erken onay dahil). Yalnız approvalStatus + approvedAt değişir;
    /// yan etkisi yok, bağlı satırlar da onaylanabilir (web approveTx).
    public func approve(_ t: Transaction) async throws {
        guard Calc.awaitsApproval(t) else { return }
        try await write(t.approved(at: Self.nowISO()), in: \.transactions)
    }

    // MARK: Tekrarlayanlar

    public var dueRecurring: [RecurringTransaction] { recurring.filter { Recurrence.isDue($0) } }

    /// Kaçırılan tüm dönemler için işlem yaz, sonra imleci ilerlet (web approveRecurring).
    /// Kimlikler deterministik: aynı dönem web'de de onaylandıysa kopya oluşmaz.
    public func approveRecurring(_ r: RecurringTransaction) async throws {
        let today = DateUtil.today()
        let existing = Set(all.transactions.filter(\.isLive).map(\.id))
        let out = Recurrence.approve(r, asOf: today, existingIds: existing,
                                     workspaceId: r.workspaceId ?? activeWorkspaceId, fx: fx, now: Self.nowISO())
        for t in out.transactions { try await write(t, in: \.transactions) }
        try await write(out.template, in: \.recurring)
    }

    public func skipRecurring(_ r: RecurringTransaction) async throws {
        try await write(Recurrence.skip(r, asOf: DateUtil.today()), in: \.recurring)
    }

    /// Duraklat / sürdür — imleç değişmez (sürdürünce birikmiş dönemler onaya düşer, web ile aynı).
    public func setRecurringActive(_ r: RecurringTransaction, _ active: Bool) async throws {
        var t = r
        t.isActive = active
        try await write(t, in: \.recurring)
    }

    // MARK: Yaklaşanlar

    public struct Upcoming: Identifiable, Hashable, Sendable {
        public enum Kind: Hashable, Sendable { case recurring, planned, cardDue }
        public var id: String
        public var kind: Kind
        public var title: String
        public var date: String
        public var amount: Double
        public var currency: CurrencyCode
        public var type: TransactionType
        public var refId: String
    }

    /// Önümüzdeki `days` gün (bugün hariç): sırası gelecek tekrarlayanlar, onay
    /// bekleyecek planlı işlemler, ödenmemiş kart ekstrelerinin son ödeme günleri.
    public func upcoming(days: Int = 7) -> [Upcoming] {
        let today = DateUtil.today()
        guard let t = DateUtil.parseDay(today),
              let h = DateUtil.calendar.date(byAdding: .day, value: days, to: t) else { return [] }
        let horizon = DateUtil.day(h)
        var out: [Upcoming] = []
        for r in recurring where r.isActive {
            for d in Recurrence.occurrences(r, asOf: horizon) where d > today {
                out.append(.init(id: "r:\(r.id):\(d)", kind: .recurring, title: r.name, date: d,
                                 amount: r.amount, currency: r.currency, type: r.type, refId: r.id))
            }
        }
        for tx in upcomingApprovals {
            out.append(.init(id: "t:\(tx.id)", kind: .planned,
                             title: tx.description.isEmpty ? (category(tx.categoryId)?.name ?? tx.type.label) : tx.description,
                             date: String(tx.date.prefix(10)), amount: tx.amount, currency: tx.currency,
                             type: tx.type, refId: tx.id))
        }
        for a in activeAccounts where a.type == .credit_card {
            guard let s = cardStatements(a, count: 1).statements.first, let due = s.dueDate,
                  due >= today, due <= horizon, s.status == .open || s.status == .partial else { continue }
            out.append(.init(id: "c:\(a.id):\(due)", kind: .cardDue, title: "\(a.name) son ödeme", date: due,
                             amount: max(0, Money.sub(s.total, s.paid)), currency: a.currency, type: .transfer, refId: a.id))
        }
        return out.sorted { $0.date != $1.date ? $0.date < $1.date : $0.title < $1.title }
    }

    // MARK: Kart ekstresi

    /// Kredi kartının açık dönemi ve son `count` ekstresi (web CardStatementPanel).
    public func cardStatements(_ a: Account, count: Int = 6) -> CardStatementResult {
        CardStatements.forCard(a, accounts: accounts, transactions: transactions,
                               plans: paymentPlans, occurrences: paymentOccurrences, fx: fx, count: count)
    }

    public func cardDays(_ a: Account) -> CardDays {
        BankRules.resolveCardDays(account: a, plan: CardStatements.plan(for: a, in: paymentPlans)).days
    }

    // MARK: Hedefler

    public func goalProgress(_ g: SavingsGoal) -> Goals.Progress {
        Goals.progress(g, accounts: accounts, balances: balances, fx: fx)
    }

    /// Yeni hedef ya da düzenleme (tüm alanlar). Yeni hedef aktif alana yazılır.
    public func saveGoal(_ g: SavingsGoal) async throws {
        var out = g
        if out.raw["workspaceId"] == nil { out.raw["workspaceId"] = JSONValue(activeWorkspaceId) }
        if out.createdAt.isEmpty { out.createdAt = Self.nowISO() }
        try await write(out, in: \.goals)
    }

    public func adjustGoal(_ g: SavingsGoal, by delta: Double) async throws {
        try await write(Goals.adjusted(g, by: delta), in: \.goals)
    }

    public func deleteGoal(_ g: SavingsGoal) async throws {
        var raw = g.raw
        raw["deleted_at"] = .string(Self.nowISO())
        try await write(SavingsGoal(raw: raw), in: \.goals)
    }
}

struct Snapshot {
    var workspaces: [Workspace] = []
    var accounts: [Account] = []
    var categories: [Category] = []
    var budgets: [Budget] = []
    var transactions: [Transaction] = []
    var investments: [InvestmentTransaction] = []
    var debts: [Debt] = []
    var recurring: [RecurringTransaction] = []
    var goals: [SavingsGoal] = []
    var paymentPlans: [PaymentPlan] = []
    var paymentOccurrences: [PaymentOccurrence] = []
}

extension WidgetSnapshot {
    /// Karşılaştırma için zaman damgasız hali (değişmeyen özeti yeniden yazıp widget'ı boşuna yenilemeyelim)
    var withoutDate: WidgetSnapshot { var c = self; c.updatedAt = .distantPast; return c }
}
