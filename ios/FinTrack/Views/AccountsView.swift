import SwiftUI
import FinTrackCore
import FinTrackData

struct AccountsView: View {
    @Environment(AppModel.self) private var model
    @State private var showArchived = false

    private var groups: [(type: AccountType, items: [Account])] {
        let list = model.accounts.filter { showArchived || !$0.isArchived }
        return AccountType.allCases.compactMap { type in
            let items = list.filter { $0.type == type }
            return items.isEmpty ? nil : (type, items)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Net değer").font(.subheadline).foregroundStyle(.secondary)
                        Text(Fmt.currency(model.netWorth))
                            .font(.system(size: 30, weight: .bold).monospacedDigit())
                        let assets = Calc.netWorth(model.accounts, balances: model.balances, fx: model.fx, onlyPositive: true)
                        Text("Toplam varlık \(Fmt.currency(assets))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                } footer: {
                    Text("Borç takibindeki kalan borçlar web'deki Net Varlık kartında ayrıca düşülür.")
                }

                ForEach(groups, id: \.type) { g in
                    Section(g.type.label) {
                        ForEach(g.items) { a in
                            NavigationLink(value: a) { AccountRow(account: a) }
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

struct AccountRow: View {
    @Environment(AppModel.self) private var model
    let account: Account

    var body: some View {
        let balance = model.balances[account.id] ?? account.initialBalance
        HStack(spacing: 12) {
            IconBadge(symbol: Icons.account(account.type), color: Color(hex: account.color))
            VStack(alignment: .leading, spacing: 2) {
                Text(account.name).lineLimit(1)
                if account.type == .credit_card, account.creditLimit != nil {
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

    private var txs: [Transaction] {
        model.transactions.filter { Calc.touchesAccount($0, account.id) }
    }

    var body: some View {
        let balance = model.balances[account.id] ?? account.initialBalance
        TransactionList(transactions: txs, perspectiveAccountId: account.id,
                        editing: $editing, pendingDelete: $pendingDelete)
            .safeAreaInset(edge: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(account.type.label).font(.caption).foregroundStyle(.secondary)
                    Text(Fmt.currency(balance, account.currency))
                        .font(.system(size: 30, weight: .bold).monospacedDigit())
                        .foregroundStyle(balance < 0 ? Theme.expense : .primary)
                    if account.type == .credit_card, let limit = account.creditLimit {
                        let avail = Calc.availableCredit(account, balance: balance, model.transactions)
                        ProgressView(value: min(max(limit - avail, 0), limit), total: max(limit, 1))
                            .tint(Theme.accent)
                        Text("Limit \(Fmt.currency(limit, account.currency)) · Kullanılabilir \(Fmt.currency(avail, account.currency))")
                            .font(.caption).foregroundStyle(.secondary)
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
            .refreshable { await model.refresh() }
            .sheet(item: $editing) { TransactionFormView(editing: $0) }
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }
}
