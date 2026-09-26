import SwiftUI
import FinTrackCore
import FinTrackData

struct SummaryView: View {
    @Environment(AppModel.self) private var model
    @Binding var quickAdd: Bool
    var openTab: (MainTabView.Tab) -> Void
    @State private var settings = false
    @State private var editing: Transaction?

    private var month: MonthYear { .current() }
    /// Web panosuyla aynı: taksitli alım satın alma ayına tam tutarla (collapseInstallments)
    private var flow: Calc.Flow { Calc.monthlyFlow(model.reportTransactions, month, fx: model.fx) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    SyncErrorBanner()
                    monthCard
                    netWorthCard
                    budgetsCard
                    recentCard
                }
                .padding(16)
            }
            .background(Color(.systemGroupedBackground))
            .refreshable { await model.refresh() }
            .navigationTitle(workspaceTitle)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { settings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Ayarlar")
                }
                ToolbarItem(placement: .topBarTrailing) { AddButton(isPresented: $quickAdd) }
            }
            .sheet(isPresented: $settings) { SettingsView() }
            .sheet(item: $editing) { TransactionFormView(editing: $0) }
        }
    }

    private var workspaceTitle: String {
        model.workspaces.count > 1
            ? (model.workspaces.first { $0.id == model.activeWorkspaceId }?.name ?? "Özet")
            : "Özet"
    }

    private var monthCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(DateUtil.monthTitle(month)) harcaması")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(Fmt.currency(flow.expense))
                .font(.system(size: 34, weight: .bold).monospacedDigit())
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            HStack(spacing: 20) {
                stat("Gelir", Fmt.currency(flow.income), Theme.income)
                stat("Net", Fmt.signed(flow.net), flow.net >= 0 ? Theme.income : Theme.expense)
            }
            if let top = topCategories, !top.isEmpty {
                Divider()
                ForEach(top, id: \.name) { item in
                    HStack {
                        Circle().fill(item.color).frame(width: 8, height: 8)
                        Text(item.name).font(.subheadline)
                        Spacer()
                        Text(Fmt.currency(item.amount)).font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// Bu ayın en çok harcanan 3 üst kategorisi (alt kategoriler üstüne toplanır).
    private var topCategories: [(name: String, amount: Double, color: Color)]? {
        let r = DateUtil.monthRange(month)
        let inMonth = model.reportTransactions.filter {
            Calc.isFlow($0) && DateUtil.isInRange($0.date, r.from, r.to)
        }
        var byTop: [String: Double] = [:]
        for (catId, amount) in Calc.expenseByCategory(inMonth, fx: model.fx) {
            var c = model.category(catId)
            while let p = c?.parentId, let parent = model.category(p) { c = parent }
            byTop[c?.id ?? "", default: 0] = Money.add(byTop[c?.id ?? "", default: 0], amount)
        }
        return byTop.filter { $0.value > 0 }
            .sorted { $0.value > $1.value }
            .prefix(3)
            .map { id, amount in
                let c = model.category(id)
                return (c?.name ?? "Kategorisiz", amount, c.map { Color(hex: $0.color) } ?? .gray)
            }
    }

    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(color)
        }
    }

    private var netWorthCard: some View {
        Button { openTab(.accounts) } label: {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Hesaplar").font(.headline)
                    Spacer()
                    Text(Fmt.currency(model.netWorth))
                        .font(.headline.monospacedDigit())
                    Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                }
                ForEach(model.activeAccounts.prefix(5)) { a in
                    HStack(spacing: 10) {
                        IconBadge(symbol: Icons.account(a.type), color: Color(hex: a.color), size: 28)
                        Text(a.name).font(.subheadline).lineLimit(1)
                        Spacer()
                        Text(Fmt.currency(model.balances[a.id] ?? 0, a.currency))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle((model.balances[a.id] ?? 0) < 0 ? Theme.expense : .primary)
                    }
                }
                if model.activeAccounts.count > 5 {
                    Text("+\(model.activeAccounts.count - 5) hesap daha")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if model.hasForeignAccountsWithoutRates {
                    Text("Kurlar alınamadı; döviz hesapları toplama çevrilmeden eklendi.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var budgetsCard: some View {
        let states = model.budgetStates(month)
        if !states.isEmpty {
            Button { openTab(.budgets) } label: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Bütçeler").font(.headline)
                        Spacer()
                        let over = states.filter { $0.status == .exceeded }.count
                        if over > 0 {
                            Text("\(over) aşıldı").font(.caption.bold()).foregroundStyle(Theme.expense)
                        }
                        Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                    }
                    ForEach(states.prefix(3), id: \.budget.id) { s in
                        BudgetProgressRow(state: s, compact: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }
            .buttonStyle(.plain)
        }
    }

    private var recentCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Son işlemler").font(.headline)
                Spacer()
                Button("Tümü") { openTab(.transactions) }.font(.subheadline)
            }
            let recent = model.transactions.filter { Calc.isPosted($0) }.prefix(5)
            if recent.isEmpty {
                Text("Henüz işlem yok.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(Array(recent)) { t in
                Button { editing = t } label: { TransactionRow(t: t) }
                    .buttonStyle(.plain)
                if t.id != recent.last?.id { Divider() }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
