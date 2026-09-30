import SwiftUI
import FinTrackCore
import FinTrackData

struct AccountsView: View {
    @Environment(AppModel.self) private var model
    @State private var showArchived = false
    @State private var showSettled = false
    @State private var path = NavigationPath()

    private var openOwe: [Debt] { model.debts.filter { $0.owe && !$0.isSettled }.sorted { $0.remaining > $1.remaining } }
    private var openOwed: [Debt] { model.debts.filter { !$0.owe && !$0.isSettled }.sorted { $0.remaining > $1.remaining } }
    private var settled: [Debt] { model.debts.filter(\.isSettled) }

    private var groups: [(type: AccountType, items: [Account])] {
        let list = model.accounts.filter { showArchived || !$0.isArchived }
        return AccountType.allCases.compactMap { type in
            let items = list.filter { $0.type == type }
            return items.isEmpty ? nil : (type, items)
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NetWorthBreakdown()
                }

                Section {
                    if model.accounts.contains(where: { $0.type == .credit_card && !$0.isArchived }) || model.debts.contains(where: { $0.owe && !$0.isSettled }) {
                        NavigationLink(value: PaymentsRoute()) { PaymentsLinkRow() }
                    }
                    NavigationLink(value: ForecastRoute()) {
                        HStack(spacing: 12) {
                            IconBadge(symbol: "chart.line.uptrend.xyaxis", color: Theme.tint, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Nakit akışı tahmini")
                                Text("Önümüzdeki aylarda bakiye").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                ForEach(groups, id: \.type) { g in
                    Section(g.type.label) {
                        ForEach(g.items) { a in
                            NavigationLink(value: a) { AccountRow(account: a) }
                        }
                    }
                }
                if !openOwe.isEmpty {
                    Section {
                        ForEach(openOwe) { d in NavigationLink(value: d) { DebtRow(debt: d) } }
                    } header: {
                        sectionHeader("Borçlarım", Fmt.currency(Calc.debtBurden(model.debts)))
                    }
                }
                if !openOwed.isEmpty {
                    Section {
                        ForEach(openOwed) { d in NavigationLink(value: d) { DebtRow(debt: d) } }
                    } header: {
                        sectionHeader("Alacaklarım", Fmt.currency(Money.sum(openOwed) { $0.remaining }))
                    }
                }
                if !settled.isEmpty {
                    Section {
                        DisclosureGroup("Kapanan borçlar (\(settled.count))", isExpanded: $showSettled) {
                            ForEach(settled) { d in NavigationLink(value: d) { DebtRow(debt: d) } }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if model.accounts.isEmpty {
                    ContentUnavailableView("Hesap yok", systemImage: "building.columns",
                                           description: Text("Hesaplar web'den eklenir."))
                }
            }
            .refreshable { await model.refresh() }
            .navigationTitle("Hesaplar")
            .navigationDestination(for: Account.self) { AccountDetailView(account: $0) }
            .navigationDestination(for: Debt.self) { DebtDetailView(debt: $0) }
            .navigationDestination(for: CardStatementsRoute.self) { CardStatementsView(accountId: $0.accountId) }
            .navigationDestination(for: PaymentsRoute.self) { _ in PaymentsView() }
            .navigationDestination(for: ForecastRoute.self) { _ in ForecastView() }
            .onAppear(perform: openDebugAccount)
            .toolbar {
                if model.accounts.contains(where: \.isArchived) {
                    ToolbarItem(placement: .topBarTrailing) {
                        Toggle(isOn: $showArchived) { Image(systemName: "archivebox") }
                            .toggleStyle(.button)
                            .accessibilityLabel("Arşivlenmiş hesapları göster")
                    }
                }
            }
        }
    }
}

extension AccountsView {
    /// DEBUG: `-account <id>` hesap detayını açar (simülatör ekran doğrulaması)
    fileprivate func openDebugAccount() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if path.isEmpty, args.contains("-payments") { path.append(PaymentsRoute()); return }
        if path.isEmpty, args.contains("-forecast") { path.append(ForecastRoute()); return }
        if path.isEmpty, let i = args.firstIndex(of: "-debt"), i + 1 < args.count,
           let d = model.debts.first(where: { $0.id == args[i + 1] }) {
            path.append(d)
            return
        }
        guard path.isEmpty, let i = args.firstIndex(of: "-account"), i + 1 < args.count,
              let a = model.account(args[i + 1]) else { return }
        path.append(a)
        if args.contains("-statements") { path.append(CardStatementsRoute(accountId: a.id)) }
        #endif
    }
}

private func sectionHeader(_ title: String, _ value: String) -> some View {
    HStack {
        Text(title)
        Spacer()
        Text(value).monospacedDigit()
    }
}

/// Net değer — web panosuyla aynı: hesaplar + yatırımlar − kalan borç.
struct NetWorthBreakdown: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Net değer").font(.subheadline).foregroundStyle(.secondary)
            Text(Fmt.currency(model.netWorth))
                .font(.system(size: 30, weight: .bold).monospacedDigit())
                .minimumScaleFactor(0.6).lineLimit(1)
            VStack(spacing: 4) {
                line("Hesaplar", Fmt.currency(model.accountsTotal))
                if !model.holdings.isEmpty { line("Yatırımlar", Fmt.currency(model.investValue)) }
                if model.debtBurden > 0 { line("Kalan borç", "−" + Fmt.currency(model.debtBurden)) }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            Text("Toplam varlık \(Fmt.currency(model.totalAssets))")
                .font(.caption).foregroundStyle(.secondary)
            if model.hasForeignAccountsWithoutRates {
                Text("Kurlar alınamadı; döviz hesapları çevrilmeden eklendi.")
                    .font(.caption).foregroundStyle(Theme.warning)
            }
        }
        .padding(.vertical, 4)
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack { Text(label); Spacer(); Text(value) }
    }
}

struct AccountRow: View {
    @Environment(AppModel.self) private var model
    let account: Account

    /// Ödenmemiş ekstrenin son ödemesi 7 gün içindeyse (ya da geçtiyse) kısa not.
    private var dueNote: String? {
        guard let st = model.cardStatements(account, count: 1).statements.first, let due = st.dueDate,
              st.status == .open || st.status == .partial || st.status == .overdue,
              let a = DateUtil.parseDay(DateUtil.today()), let b = DateUtil.parseDay(due),
              let days = DateUtil.calendar.dateComponents([.day], from: a, to: b).day, days <= 7 else { return nil }
        let left = Fmt.currency(max(0, Money.sub(st.total, st.paid)), account.currency)
        if days < 0 { return "Son ödeme geçti · \(left)" }
        if days == 0 { return "Son ödeme bugün · \(left)" }
        return "Son ödeme \(DateUtil.display(due, "d MMM")) · \(left)"
    }

    var body: some View {
        let balance = model.balances[account.id] ?? account.initialBalance
        HStack(spacing: 12) {
            IconBadge(symbol: Icons.account(account.type), color: Color(hex: account.color))
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name).lineLimit(1)
                if account.type == .credit_card, let due = dueNote {
                    Text(due).font(.caption.weight(.semibold)).foregroundStyle(Theme.warning)
                } else if account.type == .credit_card, account.creditLimit != nil {
                    let avail = Calc.availableCredit(account, balance: balance, model.transactions)
                    Text("Kullanılabilir \(Fmt.currency(avail, account.currency))")
                        .font(.caption).foregroundStyle(.secondary)
                } else if account.isArchived {
                    Text("Arşivde").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(Fmt.currency(balance, account.currency))
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(balance < 0 ? Theme.expense : .primary)
        }
    }
}

struct AccountDetailView: View {
    @Environment(AppModel.self) private var model
    let account: Account
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    @AppStorage("fintrack.showPlanned") private var showPlanned = true
    @State private var reconciling = false

    /// Hesabın işlemleri + tekrarlayanların önümüzdeki 60 gündeki dönemleri (web ile aynı)
    private var txs: [Transaction] {
        let own = model.transactions.filter { Calc.touchesAccount($0, account.id) }
        let planned = showPlanned ? model.plannedRecurringRows(accountId: account.id) : []
        guard !planned.isEmpty else { return own }
        return (planned + own).sorted {
            let a = $0.date.prefix(10), b = $1.date.prefix(10)
            return a != b ? a > b : $0.createdAt > $1.createdAt
        }
    }

    var body: some View {
        let balance = model.balances[account.id] ?? account.initialBalance
        let txs = self.txs
        TransactionList(transactions: txs, perspectiveAccountId: account.id,
                        editing: $editing, pendingDelete: $pendingDelete)
            .safeAreaInset(edge: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(account.type.label).font(.caption).foregroundStyle(.secondary)
                    Text(Fmt.currency(balance, account.currency))
                        .font(.system(size: 30, weight: .bold).monospacedDigit())
                        .foregroundStyle(balance < 0 ? Theme.expense : .primary)
                    if account.type != .credit_card { BalanceSparkline(account: account) }
                    if account.type == .credit_card, let limit = account.creditLimit {
                        let avail = Calc.availableCredit(account, balance: balance, model.transactions)
                        ProgressView(value: min(max(limit - avail, 0), limit), total: max(limit, 1))
                            .tint(Theme.accent)
                        Text("Limit \(Fmt.currency(limit, account.currency)) · Kullanılabilir \(Fmt.currency(avail, account.currency))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if account.type == .credit_card {
                        Divider().padding(.vertical, 4)
                        CardStatementSummary(account: account)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.bar)
            }
            .overlay {
                if txs.isEmpty { ContentUnavailableView("Bu hesapta işlem yok", systemImage: "tray") }
            }
            .navigationTitle(account.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { reconciling = true } label: { Label("Bakiyeyi eşitle", systemImage: "equal.circle") }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Hesap işlemleri")
                }
            }
            .sheet(isPresented: $reconciling) { ReconcileSheet(account: account) }
            .onAppear {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-reconcile") { reconciling = true }
                #endif
            }
            .refreshable { await model.refresh() }
            .transactionEditor($editing)
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }
}

/// Hesaplar ekranında Ödeme Takibi girişi: bu ayın kalanı ve gecikmiş sayısı.
struct PaymentsLinkRow: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let (s, carry): (PaymentSummary, Int) = {
            if let d = model.derived { return (d.paymentSummary, d.paymentCarryOverdue) }
            let board = model.paymentBoard(month: String(DateUtil.today().prefix(7)))
            return (PaymentSchedule.summarizeRows(board.monthRows, fx: model.fx), board.carryRows.count)
        }()
        let overdue = s.overdueCount + carry
        HStack(spacing: 12) {
            IconBadge(symbol: "calendar.badge.checkmark", color: Theme.planned, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text("Ödeme Takibi")
                Text(overdue > 0 ? "\(overdue) gecikmiş ödeme" : "Bu ay kalan \(Fmt.currency(s.remainingTry))")
                    .font(.caption)
                    .foregroundStyle(overdue > 0 ? Theme.expense : .secondary)
            }
        }
    }
}
