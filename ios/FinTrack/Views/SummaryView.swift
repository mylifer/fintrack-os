import SwiftUI
import FinTrackCore
import FinTrackData

struct SummaryView: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
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
                    PendingCard(editing: $editing, openRecurring: { router.openPlan(.recurring) })
                    monthCard
                    UpcomingCard(editing: $editing)
                    if hasHistory { trendCard }
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
                .contentTransition(.numericText())
            comparison
            AdaptiveStack {
                stat("Gelir", Fmt.currency(flow.income), Theme.income)
                stat("Net", Fmt.signed(flow.net), flow.net >= 0 ? Theme.income : Theme.expense)
            }
            let slices = categorySlices
            if !slices.isEmpty {
                Divider()
                CategoryDonut(slices: slices, total: Money.sum(slices) { $0.amount })
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// Geçen ayın aynı dönemine göre (1…bugünün günü) gider değişimi.
    @ViewBuilder private var comparison: some View {
        let c = Calc.monthToDateExpense(model.reportTransactions, fx: model.fx)
        if c.previous > 0 {
            let pct = (c.current - c.previous) / c.previous * 100
            let up = pct >= 0
            HStack(spacing: 4) {
                Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                    .font(.caption.bold())
                Text("%\(Int(abs(pct).rounded()))")
                    .font(.caption.bold().monospacedDigit())
                Text("geçen ayın aynı dönemine göre")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(up ? Theme.expense : Theme.income)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Geçen ayın aynı dönemine göre yüzde \(Int(abs(pct).rounded())) \(up ? "fazla" : "az") harcama")
        }
    }

    private var trendCard: some View {
        let series = Calc.monthlySeries(model.reportTransactions, endingAt: month, count: 6, fx: model.fx)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Son 6 ay").font(.headline)
                Spacer()
                let past = series.dropLast().map(\.flow.expense).filter { $0 > 0 }
                if !past.isEmpty {
                    Text("Ort. gider \(Fmt.whole(Money.sum(past) / Double(past.count)))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            TrendChart(series: series)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var hasHistory: Bool {
        let from = DateUtil.monthRange(month.previous).from
        return model.reportTransactions.contains { String($0.date.prefix(10)) < from || $0.date.prefix(7) == from.prefix(7) }
    }

    /// Bu ayın giderleri üst kategoriye toplanmış; en büyük 4 + "Diğer".
    private var categorySlices: [CategorySlice] {
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
        let sorted = byTop.filter { $0.value > 0 }.sorted { $0.value > $1.value }
        var out = sorted.prefix(4).map { id, amount in
            let c = model.category(id)
            return CategorySlice(id: id.isEmpty ? "none" : id, name: c?.name ?? "Kategorisiz",
                                 amount: amount, color: c.map { Color(hex: $0.color) } ?? .gray)
        }
        let rest = sorted.dropFirst(4)
        if !rest.isEmpty {
            out.append(CategorySlice(id: "other", name: "Diğer", amount: Money.sum(rest) { $0.value },
                                     color: Color(.systemGray3)))
        }
        return out
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
                    Text(Fmt.currency(model.accountsTotal))
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
                if !model.holdings.isEmpty || model.debtBurden > 0 {
                    Divider()
                    HStack {
                        Text("Net değer").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(Fmt.currency(model.netWorth)).font(.subheadline.weight(.semibold).monospacedDigit())
                    }
                    Text("Hesaplar + yatırımlar \(Fmt.currency(model.investValue)) − borç \(Fmt.currency(model.debtBurden))")
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
