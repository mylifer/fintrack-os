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
    /// Etkin alanın kişileri (arşivliler dahil, ada göre)
    public private(set) var people: [Person] = []
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
    /// Arka planda hesaplanan türetimler (nil: ilk hesap sürüyor → ekranlar anında hesaplar).
    /// Ay dönünce eskisi kullanılmaz.
    public var derived: Derived? {
        guard let d = derivedStore, d.day == DateUtil.today(), d.workspaceId == activeWorkspaceId else { return nil }
        return d
    }
    /// Türetim her tamamlandığında artar (hatırlatmalar güncel ekstreden kurulsun)
    public private(set) var derivedStamp = 0
    private var derivedStore: Derived?
    private var derivedGeneration = 0

    // Tüm alanlar (çalışma alanı değişince yeniden süzmek için)
    private var all = Snapshot()

    private var service: SupabaseService?
    private let cache = LocalCache()
    private var outbox: Outbox?
    private var isFlushing = false
    private var refreshAgain = false
    /// Çekiş sürerken yazılan satırlar — eski görüntü bunları geri almasın
    private var writesDuringRefresh: [(table: String, row: JSONObject)] = []
    private var retryTask: Task<Void, Never>?
    private var debtOpChain: Task<Void, Error>?
    private var batchDepth = 0
    private var batchDirty = false
    private var saveTask: Task<Void, Never>?
    private var derivedTask: Task<Void, Never>?
    private var retryDelay: UInt64 = 15
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
        saveTask?.cancel()   // gecikmeli önbellek yazımı çıkıştan sonra dosyayı geri yazmasın
        if !isDemo, let uid = userId { cache.clear(userId: uid) }
        derivedStore = nil
        if discardPending { outbox?.clear() }
        outbox = nil
        pendingWrites = 0
        retryTask?.cancel()
        retryTask = nil
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
    /// Çekiş sürerken gelen yenileme isteği kaybolmasın: bitince bir tur daha.
    public func refresh() async {
        guard !isDemo, service != nil, userId != nil else { return }
        if isRefreshing { refreshAgain = true; return }
        isRefreshing = true
        defer { isRefreshing = false }
        repeat {
            refreshAgain = false
            await refreshOnce()
        } while refreshAgain && userId != nil
    }

    private func refreshOnce() async {
        guard let service, let uid = userId else { return }
        writesDuringRefresh = []

        // Oturum önce doğrulanır: yenilenemeyen belirteçle istekler anon gider,
        // RLS boş liste döner — boş görüntüyü önbelleğe yazma, kuyruğu silme.
        switch await service.sessionStatus() {
        case .invalid:
            await signOut(discardPending: false)
            lastError = "Oturumunuz sona erdi. Yeniden giriş yapın."
            return
        case .offline:
            lastError = "Bağlantı yok. Son eşitlenen veriler gösteriliyor."
            scheduleRetry()
            return
        case .valid:
            break
        }

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
            async let pe = try? service.fetchAll(Person.self, userId: uid, memberIds: members)
            var snap = Snapshot(workspaces: try await ws, accounts: try await ac, categories: try await ca,
                                budgets: try await bu, transactions: try await tx,
                                investments: try await iv, debts: try await de)
            snap.recurring = await re ?? all.recurring
            snap.goals = await go ?? all.goals
            snap.paymentPlans = await pp ?? all.paymentPlans
            snap.paymentOccurrences = await po ?? all.paymentOccurrences
            snap.people = await pe ?? all.people
            guard userId == uid else { return }   // çekiş sürerken çıkış yapıldı
            // Görüntü alındıktan SONRA yapılan yazmalar ve hâlâ gönderilemeyenler üste
            for e in outbox?.entries ?? [] { snap.overlay(table: e.table, row: e.row) }
            for w in writesDuringRefresh { snap.overlay(table: w.table, row: w.row) }
            apply(snap)
            scheduleCacheSave()
            lastSync = Date()
            lastError = rejected > 0 ? "\(rejected) çevrimdışı değişiklik sunucu tarafından kabul edilmedi." : nil
        } catch {
            if (error as NSError).code == NSURLErrorCancelled { return }
            if await service.sessionStatus() == .invalid {
                await signOut(discardPending: false)
                lastError = "Oturumunuz sona erdi. Yeniden giriş yapın."
                return
            }
            lastError = "Veriler güncellenemedi. Bağlantınızı kontrol edin."
            scheduleRetry()
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
        derivedStore = nil   // eski alanın özeti bir an bile görünmesin
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
        people = all.people.filter(inActive)
            .sorted { $0.name.compare($1.name, locale: Locale(identifier: "tr_TR")) == .orderedAscending }
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
        scheduleDerived()
    }

    /// Gün döndüyse (uygulama çevrimdışı açıldığında çekiş türetimi tetiklemez)
    public func refreshDerivedIfStale() {
        // Bakiyeler de dünün "tarihi gelmiş" kesimine göre: hepsi yeniden
        if let d = derivedStore, d.day != DateUtil.today() { recomputeBalances() }
    }

    /// Pahalı türetimleri arka planda yeniden hesapla; en son isteğin sonucu kalır.
    private func scheduleDerived() {
        derivedGeneration += 1
        let gen = derivedGeneration
        let input = Derived.Input(transactions: transactions, reportTransactions: reportTransactions,
                                  accounts: accounts, categories: categories, budgets: budgets,
                                  plans: paymentPlans, occurrences: paymentOccurrences, fx: fx,
                                  workspaceId: activeWorkspaceId, debts: debts, balances: balances)
        derivedTask?.cancel()
        derivedTask = Task.detached(priority: .userInitiated) { [weak self] in
            guard !Task.isCancelled else { return }   // daha yeni bir istek geldi
            let d = Derived.compute(input)
            await MainActor.run {
                guard let self, self.derivedGeneration == gen else { return }
                self.derivedStore = d
                self.derivedStamp += 1
                self.writeWidgetSnapshot()
            }
        }
    }

    // MARK: Widget

    /// Ana ekran widget'ının okuduğu özet (App Group). Widget ağa çıkmaz.
    private func writeWidgetSnapshot() {
        guard userId != nil, !isDemo else { return }   // örnek veri gerçek widget'ın üzerine yazmasın
        let my = MonthYear.current()
        let flow = derived?.monthFlow ?? Calc.monthlyFlow(reportTransactions, my, fx: fx)
        let states = budgetStates(my)
        let lines = states.prefix(6).map { s -> WidgetSnapshot.BudgetLine in
            let info = Calc.budgetLabel(s.budget, categories)
            return .init(name: info.label, colorHex: info.cats.first?.color ?? "#6B7280", spent: s.spent,
                         limit: s.limit, percent: s.percentUsed, status: s.status.rawValue)
        }
        let snap = WidgetSnapshot(
            month: String(format: "%04d-%02d", my.year, my.month), monthTitle: DateUtil.monthTitle(my),
            expense: flow.expense, income: flow.income, net: flow.net, netWorth: netWorth,
            budgetSpent: Money.sum(states) { $0.spent }, budgetLimit: Money.sum(states) { $0.limit },
            budgets: Array(lines), amountsHidden: Fmt.amountsHidden, updatedAt: Date(),
            pendingCount: dueApprovals.count + dueRecurring.count,
            upcoming: upcoming(days: 14).prefix(8).map {
                .init(title: $0.title, date: $0.date, amount: $0.amount, currency: $0.currency.rawValue,
                      isIncome: $0.type == .income, kind: Self.widgetKind($0.kind))
            })
        let changed = snap.withoutDate != WidgetSnapshot.load()?.withoutDate
        snap.save()
        if changed { reloadWidgets() }
    }

    nonisolated static func widgetKind(_ k: Upcoming.Kind) -> String {
        switch k {
        case .cardDue: "cardDue"
        case .recurring: "recurring"
        case .planned: "planned"
        }
    }

    /// "Tutarları gizle" değişince widget da gizlesin.
    public func amountsHiddenChanged() { writeWidgetSnapshot() }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    // MARK: Türetilmiş

    /// Arşivlenmiş kişi de çözülür (bağlı işlemde adı görünsün)
    public func person(_ id: String?) -> Person? {
        guard let id, !id.isEmpty else { return nil }
        return people.first { $0.id == id } ?? all.people.first { $0.id == id }
    }

    /// Formda seçilebilecekler: arşivde olmayan, verilen roldeki kişiler
    public func pickerPeople(_ role: Person.Role) -> [Person] {
        people.filter { $0.role == role && !$0.isArchived }
    }

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

    /// Kullanılan etiketler (işlem sayısı ↓). Yalnız arka plan türetiminden —
    /// 20 bin işlemde her çizimde yeniden toplamamak için; hazır değilse boş.
    public var knownTags: [Tags.Aggregate] { derived?.tags ?? [] }

    /// Bütçe kümesinin özeti (ekran önbellekleri için anahtar)
    public var budgetsSignature: Int { Derived.signature(budgets) }

    public func budgetStates(_ my: MonthYear = .current()) -> [Calc.BudgetState] {
        if let d = derived, d.month == my, d.budgetsSignature == Derived.signature(budgets) { return d.budgetStates }
        return Self.budgetStates(budgets, reportTransactions, my, categories: categories, fx: fx)
    }

    /// Web bütçe sayfası yalnız aylık bütçeleri gösterir (eski yıllıklar hariç)
    nonisolated static func budgetStates(_ budgets: [Budget], _ report: [Transaction], _ my: MonthYear,
                                         categories: [FinTrackCore.Category], fx: FX) -> [Calc.BudgetState] {
        budgets.filter { $0.period == "monthly" }
            .map { Calc.enrichBudget($0, report, my, categories: categories, fx: fx) }
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

    /// `now`, ama satırın mevcut damgasından eski değil (+1 ms). Sunucudaki
    /// keep_newer_row eski damgalı yazmayı sessizce yok sayar: saati ileri bir
    /// cihazın düzenlediği satırda iOS düzenlemesi kaybolmasın.
    nonisolated static func stamp(after current: String?, now: String) -> String {
        guard let current, current >= now, let d = iso.date(from: current) else { return now }
        return iso.string(from: d.addingTimeInterval(0.001))
    }

    /// Yeni işlem ya da var olan işlemin düzenlemesi.
    /// `newId`: formun bir kez ürettiği kimlik — belirsiz hatadan sonra tekrar
    /// denemede aynı satır güncellenir, ikinci işlem oluşmaz.
    public func save(_ draft: TransactionDraft, editing: Transaction?, newId: String? = nil) async throws {
        guard userId != nil else { throw ServiceError.notSignedIn }
        if let e = draft.validationError() { throw ServiceError.message(e) }
        guard let account = account(draft.accountId) else { throw ServiceError.message("Hesap bulunamadı.") }
        if let editing, editing.isLinked {
            throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den düzenleyin.")
        }
        let record = editing.map { draft.applying(to: $0, account: account, fx: fx) }
            ?? draft.makeNew(id: newId ?? UUID().uuidString.lowercased(), account: account,
                             workspaceId: activeWorkspaceId, fx: fx, now: Self.nowISO())
        try await write(record, in: \.transactions)
    }

    /// Bakiye eşitleme (web ReconcileBalanceModal): gerçek bakiyeyle fark tek satır.
    public func reconcile(_ account: Account, actual input: Double, id: String = UUID().uuidString.lowercased()) async throws {
        guard userId != nil else { throw ServiceError.notSignedIn }
        let balance = balances[account.id] ?? account.initialBalance
        let t = try Reconcile.make(account: account, input: input, balance: balance, fx: fx,
                                   workspaceId: account.workspaceId ?? activeWorkspaceId, now: Self.nowISO(), id: id)
        try await write(t, in: \.transactions)
    }

    /// Vadesi dolan mevduatın net faizini işle, vadeyi yenile ya da bitir
    /// (web processDepositInterest). Önce buluttan TAZE veri çekilir (web'de
    /// işlenmiş/düzenlenmiş vade yeniden işlenmesin); faiz satırı zaten varsa
    /// yazılmaz. Hesapta yalnız deposit* sütunları kısmi güncellenir — tam satır
    /// yazılsa web'in o arada yaptığı değişiklikler (ad, arşiv, silme) ezilirdi.
    /// Döner: bu çağrıda yazılan net faiz (zaten işlenmişse 0).
    @discardableResult
    public func processDeposit(_ account: Account, renew: Bool) async throws -> Double {
        guard let uid = userId else { throw ServiceError.notSignedIn }
        if !isDemo {
            // Süren yenileme varsa bitmesini bekle (yoksa refresh hemen döner ve
            // taze veri gelmemiş görünürdü), sonra kendi turunu çalıştır
            for _ in 0..<150 where isRefreshing { try? await Task.sleep(nanoseconds: 200_000_000) }
            let before = lastSync
            await refresh()
            guard userId == uid, let s = lastSync, s != before else {
                throw ServiceError.message("Güncel veriler alınamadı. Bağlantınızı kontrol edip tekrar deneyin.")
            }
        }
        guard let current = self.account(account.id), current.isLive, !current.isArchived else {
            throw ServiceError.message("Hesap web'de silinmiş ya da arşivlenmiş.")
        }
        guard let t = Deposit.terms(current), DateUtil.today() >= t.end
        else { throw ServiceError.message("Vade henüz dolmamış ya da koşullar web'de değişmiş; ekran güncellendi.") }
        let balance = balances[current.id] ?? current.initialBalance
        let now = Self.nowISO()
        guard let r = Deposit.process(account: current, balance: balance, categories: categories, renew: renew, fx: fx,
                                      workspaceId: current.workspaceId ?? activeWorkspaceId, now: now)
        else { return 0 }
        var written = 0.0
        if let tx = r.interest, !Deposit.interestBooked(all.transactions, accountId: current.id, end: t.end) {
            try await write(tx, in: \.transactions)
            written = tx.amount
        }
        var cols = Deposit.nextColumns(t, renew: renew)
        // Damga satırdakinden eski olmasın (saati ileri bir cihaz yazmış olabilir):
        // keep_newer_row eskiyi sessizce yok sayardı
        cols["updatedAt"] = .string(Self.stamp(after: current.updatedAt, now: now))
        if !isDemo {
            guard let service else { throw ServiceError.notSignedIn }
            do {
                try await service.updateColumns(Account.table, id: current.id, cols)
            } catch {
                // Faiz yazıldıysa tekrar denemede ikinci kez yazılmaz (interestBooked)
                throw ServiceError.message(written > 0
                    ? "Faiz işlendi ama vade güncellenemedi. Tekrar deneyin; faiz ikinci kez yazılmaz."
                    : "Vade güncellenemedi: \(error.localizedDescription)")
            }
        }
        guard userId == uid else { return written }
        var raw = current.raw
        for (k, v) in cols { raw[k] = v }
        if isRefreshing { writesDuringRefresh.append((Account.table, raw)) }
        replaceLocal(Account(raw: raw), in: \.accounts)
        return written
    }

    /// Taksitli alışveriş: N satır aynı grupta (web addInstallmentGroup).
    /// `seed`: formun bir kez ürettiği grup kimliği; satır kimlikleri ondan
    /// türetilir (tekrar denemede aynı grup güncellenir, ikinci grup oluşmaz).
    public func saveInstallments(_ draft: TransactionDraft, count: Int, seed: String = UUID().uuidString.lowercased()) async throws {
        guard userId != nil else { throw ServiceError.notSignedIn }
        guard let account = account(draft.accountId) else { throw ServiceError.message("Hesap bulunamadı.") }
        let rows = try Installments.makeGroup(draft, count: count, account: account, workspaceId: activeWorkspaceId,
                                              fx: fx, now: Self.nowISO(), groupId: seed,
                                              ids: (0..<count).map { DeterministicID.uuid("inst:\(seed):\($0)") })
        // İlk satır yazılırsa grup "kaydedildi" sayılır: kalanlar geçici hatada
        // kuyruğa alınır (yarım grup kalıp kullanıcı tekrar deneyerek ikinci grup
        // oluşturmasın)
        guard let first = rows.first else { return }
        try await batched {
            try await write(first, in: \.transactions)
            for r in rows.dropFirst() { await writeFollowUp(r, in: \.transactions) }
        }
    }

    /// Silme = tombstone (deleted_at), gerçek DELETE yok.
    /// Borç ödemesi silinirse borcun ödenen tutarı ve taksit sayacı geri alınır (web).
    public func delete(_ t: Transaction) async throws {
        guard userId != nil else { throw ServiceError.notSignedIn }
        guard t.canDeleteOnIOS else { throw ServiceError.message("Bu işlem başka kayıtlara bağlı; web'den silin.") }
        if t.isPlainInstallment, let group = t.installGroupId {
            // Taksit: TÜM grup silinir (web remove)
            let now = Self.nowISO()
            let rows = all.transactions.filter { $0.installGroupId == group && $0.isLive }
            guard let first = rows.first else { return }
            try await batched {
                try await write(first.tombstoned(at: now), in: \.transactions)
                for row in rows.dropFirst() { await writeFollowUp(row.tombstoned(at: now), in: \.transactions) }
            }
            return
        }
        guard t.isPlainDebtPayment, let debtId = t.debtId else {
            try await write(t.tombstoned(at: Self.nowISO()), in: \.transactions)
            return
        }
        try await serializedDebtOp {
            try await self.write(t.tombstoned(at: Self.nowISO()), in: \.transactions)
            // Borcun EN GÜNCEL hali, işlem yazıldıktan sonra okunur
            if let debt = self.all.debts.first(where: { $0.id == debtId && $0.isLive }) {
                await self.writeFollowUp(DebtPayments.revert(debt, payment: t, fx: self.fx), in: \.debts)
            }
        }
    }

    /// Borç ödemesi (web debts/page handlePay): işlem + borç satırı.
    public func payDebt(_ debt: Debt, accountId: String?, amount: Double, date: Date,
                        id: String = UUID().uuidString.lowercased()) async throws {
        guard let account = account(accountId), !account.isArchived else { throw ServiceError.message("Hesap seçin.") }
        try await serializedDebtOp {
            let latest = self.all.debts.first { $0.id == debt.id } ?? debt
            let out = try DebtPayments.pay(latest, from: account, amount: amount, date: DateUtil.day(date), fx: self.fx,
                                           workspaceId: self.activeWorkspaceId, now: Self.nowISO(), id: id)
            try await self.write(out.transaction, in: \.transactions)
            let fresh = self.all.debts.first { $0.id == debt.id } ?? latest
            await self.writeFollowUp(fresh.applyingPayment(out.transaction.amountTry ?? 0, installments: 1), in: \.debts)
        }
    }

    /// Borcu etkileyen işlemler sırayla: iki işlem aynı eski paidAmount'tan
    /// hesaplayıp birbirinin artışını ezmesin.
    private func serializedDebtOp(_ op: @escaping @MainActor () async throws -> Void) async throws {
        let previous = debtOpChain
        let task = Task { @MainActor in
            _ = await previous?.result
            try await op()
        }
        debtOpChain = task
        try await task.value
    }

    /// İlk kaydı izleyen bağlı yazma (ör. ödemeden sonra borç satırı): ilk kayıt
    /// zaten yazıldığı için bu ADIM HATA FIRLATMAZ — kalıcı olmayan her hatada
    /// kuyruğa alınır (kullanıcı tekrar deneyip mükerrer ödeme yapmasın).
    private func writeFollowUp<T: SyncRecord>(_ record: T, in kp: WritableKeyPath<Snapshot, [T]>) async {
        do {
            try await write(record, in: kp)
        } catch where !SupabaseService.isPermanentWriteError(error) {
            guard let uid = userId else { return }
            let row = record.rowForWrite(updatedAt: Self.stamp(after: record.updatedAt, now: Self.nowISO()))
            if outbox == nil { openOutbox(uid) }
            outbox?.enqueue(table: T.table, row: row)
            pendingWrites = outbox?.count ?? 0
            var raw = row
            raw["user_id"] = .string(uid)
            replaceLocal(T(raw: raw), in: kp)
            scheduleRetry()
        } catch {
            lastError = "İşlem kaydedildi ama bağlı kayıt güncellenemedi; web'den kontrol edin."
        }
    }

    /// Yerel kopyayı güncelle (bulut yazması ya da kuyruğa alma sonrası) ve önbelleğe al.
    private func replaceLocal<T: SyncRecord>(_ r: T, in kp: WritableKeyPath<Snapshot, [T]>) {
        if let i = all[keyPath: kp].firstIndex(where: { $0.id == r.id }) {
            all[keyPath: kp][i] = r
        } else {
            all[keyPath: kp].append(r)
        }
        if batchDepth > 0 { batchDirty = true; return }
        rescope()
        scheduleCacheSave()
    }

    /// Çok satırlı işlemler (taksit grubu, grup silme, birikmiş dönemler): yerel
    /// yeniden hesap ve önbellek yazımı işlem sonunda BİR kez.
    private func batched<R>(_ body: () async throws -> R) async rethrows -> R {
        batchDepth += 1
        defer {
            batchDepth -= 1
            if batchDepth == 0 && batchDirty {
                batchDirty = false
                rescope()
                scheduleCacheSave()
            }
        }
        return try await body()
    }

    /// Önbelleği arka planda ve gecikmeli yaz (art arda yazmalar tek dosya yazımı).
    private func scheduleCacheSave() {
        guard !isDemo, let uid = userId else { return }
        saveTask?.cancel()
        let snap = all, cache = cache
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            cache.save(snap, userId: uid)
        }
    }

    /// Tek kayıt yaz: buluta upsert, sonra yerel kopya (user_id oturumdan).
    /// Ağ yoksa satır çevrimdışı kuyruğa girer ve yerelde hemen görünür; bağlantı
    /// gelince gönderilir. Sunucu reddederse (yetki, doğrulama) hata fırlatılır.
    private func write<T: SyncRecord>(_ record: T, in kp: WritableKeyPath<Snapshot, [T]>) async throws {
        guard let uid = userId else { throw ServiceError.notSignedIn }
        let row = record.rowForWrite(updatedAt: Self.stamp(after: record.updatedAt, now: Self.nowISO()))
        if !isDemo {
            guard let service else { throw ServiceError.notSignedIn }
            do {
                try await service.upsertRow(T.table, row, userId: uid)
            } catch where SupabaseService.isNetworkError(error) || SupabaseService.isAuthError(error) {
                guard userId == uid else { return }   // beklerken çıkış yapıldı: kuyruğa alma
                if outbox == nil { openOutbox(uid) }
                outbox?.enqueue(table: T.table, row: row)
                pendingWrites = outbox?.count ?? 0
                if SupabaseService.isAuthError(error) {
                    // Oturumu doğrula: düştüyse giriş ekranı, değişiklik kuyrukta bekler
                    Task { await refresh() }
                } else {
                    scheduleRetry()
                }
            }
            guard userId == uid else { return }
        }
        if isRefreshing { writesDuringRefresh.append((T.table, row)) }
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

    /// Bekleyenleri sırayla gönder (yalnız oturum doğrulandıktan sonra çağrılır).
    /// Ağ hatasında durur. Kalıcı veri hatası ya da — oturum geçerliyken — yetki
    /// reddi (ör. paylaşılan alandan çıkarıldınız) satırı düşürür: yoksa kuyruk
    /// sonsuza dek tıkanır, arkasındakiler hiç gitmezdi. Geçici hata (5xx, 429)
    /// satırı bekletir, sıradakine geçilir.
    @discardableResult
    public func flushOutbox() async -> Int {
        guard !isDemo, !isFlushing, let service, let uid = userId, let entries = outbox?.entries, !entries.isEmpty
        else { return 0 }
        isFlushing = true
        defer { isFlushing = false; pendingWrites = outbox?.count ?? 0 }
        var rejected = 0
        var failedTransient = false
        for e in entries.sorted(by: { $0.seq < $1.seq }) {
            do {
                try await service.upsertRow(e.table, e.row, userId: uid)
                outbox?.remove(e)
            } catch where SupabaseService.isNetworkError(error) {
                scheduleRetry()
                return rejected
            } catch where SupabaseService.isPermanentWriteError(error) || SupabaseService.isAuthError(error) {
                outbox?.remove(e)
                rejected += 1
            } catch {
                failedTransient = true
            }
        }
        if failedTransient { scheduleRetry() } else { retryDelay = 15 }
        return rejected
    }

    /// Bekleyen varken artan aralıkla yeniden dene (15 sn → 5 dk; web scheduleRetry).
    private func scheduleRetry() {
        guard !isDemo, retryTask == nil, pendingWrites > 0 || outbox?.isEmpty == false else { return }
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 300)
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            guard let self, !Task.isCancelled else { return }
            self.retryTask = nil
            if self.pendingWrites > 0 { await self.refresh() }
        }
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
        try await batched {
            for t in out.transactions { try await write(t, in: \.transactions) }
            try await write(out.template, in: \.recurring)
        }
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

        public init(id: String, kind: Kind, title: String, date: String, amount: Double,
                    currency: CurrencyCode, type: TransactionType, refId: String) {
            self.id = id; self.kind = kind; self.title = title; self.date = date
            self.amount = amount; self.currency = currency; self.type = type; self.refId = refId
        }
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

    // MARK: Ödeme Takibi

    /// Seçilen ayın ödeme satırları (web PaymentBoard liste görünümü): o ayın
    /// satırları + önceki aylardan gecikmişler. Kartlar ve 'borçluyum' borçlar.
    public func paymentBoard(month: String) -> (targets: [PaymentTarget], monthRows: [PaymentRow], carryRows: [PaymentRow]) {
        Self.paymentRows(accounts: accounts, debts: debts, plans: paymentPlans, occurrences: paymentOccurrences,
                         transactions: transactions, balances: balances, fx: fx, month: month)
    }

    nonisolated static func paymentRows(accounts: [Account], debts: [Debt], plans: [PaymentPlan],
                                        occurrences: [PaymentOccurrence], transactions: [Transaction],
                                        balances: [String: Double], fx: FX, month: String)
        -> (targets: [PaymentTarget], monthRows: [PaymentRow], carryRows: [PaymentRow]) {
        let targets = PaymentSchedule.buildTargets(accounts: accounts, debts: debts, plans: plans, balances: balances)
        let shown = targets.filter(\.isActive)
        let earliest = shown.map(\.startMonth).min() ?? month
        let allRows = PaymentSchedule.buildSchedule(
            targets: shown, occurrences: occurrences, transactions: transactions,
            from: min(month, earliest), to: month, today: DateUtil.today(),
            cardPayments: CardPayments.assignCardPayments(accounts: accounts, transactions: transactions), fx: fx)
        // Kalanı 0 ve aylık tutarı olmayan borcun AÇIK ayları: ödenecek bir şey yok
        // (web bunları sürekli "gecikmiş" gösteriyor). Ödenmiş ayları kalır.
        let rows = allRows.filter { r in
            !(r.target.kind == .debt && r.target.outstanding == 0 && r.target.defaultAmount == nil
              && r.state == .open && r.remaining == 0)
        }
        return (targets, rows.filter { $0.month == month }, rows.filter { $0.month < month && $0.timing == .overdue })
    }

    /// Ödeme Takibi "Öde" (web payRow): isteğe bağlı ödeme işlemi (+ borçta borç
    /// satırı) ve ayın kaydı "ödendi". Borç işlemleriyle aynı sıraya girer.
    public func payRow(_ row: PaymentRow, input: PaymentActions.PayInput,
                       transactionId: String = UUID().uuidString.lowercased()) async throws {
        try await serializedDebtOp {
            let from = self.account(input.fromAccountId)
            let out = try PaymentActions.pay(row: row, input: input, from: from, occurrences: self.all.paymentOccurrences,
                                             existingTransactionIds: Set(self.all.transactions.filter(\.isLive).map(\.id)),
                                             fx: self.fx, workspaceId: self.activeWorkspaceId, now: Self.nowISO(),
                                             transactionId: transactionId)
            if let t = out.transaction { try await self.write(t, in: \.transactions) }
            if let delta = out.debtDeltaTry, let debt = self.all.debts.first(where: { $0.id == row.target.id }) {
                await self.writeFollowUp(debt.applyingPayment(delta, installments: 1), in: \.debts)
            }
            // Ay kaydı işlem yazıldıktan SONRA güncel satırın üstüne (arada gelen
            // web düzenlemesi — not, kesim tarihi — ezilmesin)
            let current = self.all.paymentOccurrences.first { $0.id == out.occurrence.id && $0.isLive }
            let occurrence = PaymentActions.remerge(out.occurrence, onto: current)
            if out.transaction != nil {
                await self.writeFollowUp(occurrence, in: \.paymentOccurrences)
            } else {
                // Tek yazma bu: hata kullanıcıya dönsün (sessizce "ödendi" sanılmasın)
                try await self.write(occurrence, in: \.paymentOccurrences)
            }
        }
    }

    // MARK: Kart ekstresi

    /// Kredi kartının açık dönemi ve son `count` ekstresi (web CardStatementPanel).
    public func cardStatements(_ a: Account, count: Int = 6) -> CardStatementResult {
        if count <= 12, var r = derived?.cards[a.id] {
            r.statements = Array(r.statements.prefix(count))
            return r
        }
        return CardStatements.forCard(a, accounts: accounts, transactions: transactions,
                                      plans: paymentPlans, occurrences: paymentOccurrences, fx: fx, count: count)
    }

    public func cardDays(_ a: Account) -> CardDays {
        BankRules.resolveCardDays(account: a, plan: CardStatements.plan(for: a, in: paymentPlans)).days
    }

    public func saveRecurring(_ draft: RecurringDraft, editing: RecurringTransaction?,
                              newId: String = UUID().uuidString.lowercased()) async throws {
        if let e = draft.validationError() { throw ServiceError.message(e) }
        guard let account = account(draft.accountId) else { throw ServiceError.message("Hesap bulunamadı.") }
        let r = draft.build(editing: editing, account: account,
                            workspaceId: editing?.workspaceId ?? activeWorkspaceId, id: newId, now: Self.nowISO())
        try await write(r, in: \.recurring)
    }

    /// Şablonu sil (tombstone). Daha önce üretilmiş işlemler yerinde kalır (web ile aynı).
    public func deleteRecurring(_ r: RecurringTransaction) async throws {
        var raw = r.raw
        raw["deleted_at"] = .string(Self.nowISO())
        try await write(RecurringTransaction(raw: raw), in: \.recurring)
    }

    // MARK: Bütçeler

    public func saveBudget(_ draft: BudgetDraft, editing: Budget?, newId: String = UUID().uuidString.lowercased()) async throws {
        if let e = draft.validationError() { throw ServiceError.message(e) }
        let b = draft.build(editing: editing, categories: categories,
                            workspaceId: editing?.workspaceId ?? activeWorkspaceId, id: newId)
        try await write(b, in: \.budgets)
    }

    public func deleteBudget(_ b: Budget) async throws {
        var out = b
        out.raw["deleted_at"] = .string(Self.nowISO())
        try await write(out, in: \.budgets)
    }

    /// Başka bütçede kullanılan kategoriler (formda seçilemez — web ile aynı)
    public func categoriesUsedByOtherBudgets(except id: String?) -> Set<String> {
        Set(budgets.filter { $0.id != id }.flatMap(Calc.budgetCategoryIds))
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

struct Snapshot: Sendable {
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
    var people: [Person] = []
}

extension WidgetSnapshot {
    /// Karşılaştırma için zaman damgasız hali (değişmeyen özeti yeniden yazıp widget'ı boşuna yenilemeyelim)
    var withoutDate: WidgetSnapshot { var c = self; c.updatedAt = .distantPast; return c }
}
