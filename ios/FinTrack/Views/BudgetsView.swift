import SwiftUI
import FinTrackCore
import FinTrackData

struct BudgetsView: View {
    @Environment(AppModel.self) private var model
    @State private var month = MonthYear.current()

    var body: some View {
        NavigationStack {
            let states = model.budgetStates(month)
            List {
                Section {
                    monthSwitcher
                    if !states.isEmpty { totals(states) }
                }
                Section {
                    ForEach(states, id: \.budget.id) { s in
                        NavigationLink(value: s.budget) { BudgetProgressRow(state: s) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if model.budgets.isEmpty {
                    ContentUnavailableView("Bütçe yok", systemImage: "chart.pie",
                                           description: Text("Bütçeler web'den eklenir."))
                }
            }
            .refreshable { await model.refresh() }
            .navigationTitle("Bütçeler")
            .navigationDestination(for: Budget.self) { BudgetDetailView(budget: $0, month: month) }
        }
    }

    private var monthSwitcher: some View {
        HStack {
            Button { month = month.previous } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Önceki ay")
            Spacer()
            Text(DateUtil.monthTitle(month)).font(.headline)
            Spacer()
            Button { month = month.next } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Sonraki ay")
                .disabled(month == .current())
        }
        .buttonStyle(.borderless)
    }

    private func totals(_ states: [Calc.BudgetState]) -> some View {
        let limit = Money.sum(states) { $0.limit }
        let spent = Money.sum(states) { $0.spent }
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Toplam").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                Text("\(Fmt.currency(spent)) / \(Fmt.currency(limit))")
                    .font(.subheadline.monospacedDigit())
            }
            ProgressView(value: min(spent, limit), total: max(limit, 1)).tint(Theme.accent)
        }
    }
}

struct BudgetProgressRow: View {
    @Environment(AppModel.self) private var model
    let state: Calc.BudgetState
    var compact = false

    private var color: Color {
        switch state.status {
        case .ok: Theme.accent
        case .warning: Theme.warning
        case .exceeded: Theme.expense
        }
    }

    var body: some View {
        let info = Calc.budgetLabel(state.budget, model.categories)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if let c = info.cats.first {
                    let i = Icons.category(c.icon)
                    IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color), size: compact ? 24 : 32)
                }
                Text(info.label).font(compact ? .subheadline : .body).lineLimit(1)
                Spacer()
                Text("%\(Int(state.percentUsed.rounded()))")
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(state.status == .ok ? Color.secondary : color)
            }
            ProgressView(value: min(state.spent, state.limit), total: max(state.limit, 1))
                .tint(color)
            if !compact {
                HStack {
                    Text("\(Fmt.currency(state.spent)) / \(Fmt.currency(state.limit))")
                    Spacer()
                    if state.status == .exceeded {
                        Text("\(Fmt.currency(Money.sub(state.spent, state.limit))) aşıldı").foregroundStyle(Theme.expense)
                    } else {
                        Text("\(Fmt.currency(state.remaining)) kaldı")
                    }
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                if state.carryover > 0 {
                    Text("Geçen aydan devreden \(Fmt.currency(state.carryover))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, compact ? 0 : 4)
    }
}

/// Bütçeye bu ay yazılan işlemler (alt kategoriler dahil).
struct BudgetDetailView: View {
    @Environment(AppModel.self) private var model
    let budget: Budget
    let month: MonthYear
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    private var txs: [Transaction] {
        let ids = Calc.expandCategoryIds(Calc.budgetCategoryIds(budget), model.categories)
        let r = DateUtil.monthRange(month)
        return model.transactions.filter { t in
            t.type == .expense && Calc.isFlow(t) && DateUtil.isInRange(t.date, r.from, r.to)
                && Calc.categorySlices(t).contains { $0.categoryId.map(ids.contains) ?? false }
        }
    }

    var body: some View {
        let state = Calc.enrichBudget(budget, model.transactions, month, categories: model.categories, fx: model.fx)
        TransactionList(transactions: txs, editing: $editing, pendingDelete: $pendingDelete)
            .safeAreaInset(edge: .top) {
                BudgetProgressRow(state: state)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(.bar)
            }
            .overlay {
                if txs.isEmpty { ContentUnavailableView("Bu ay harcama yok", systemImage: "tray") }
            }
            .navigationTitle(Calc.budgetLabel(budget, model.categories).label)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $editing) { TransactionFormView(editing: $0) }
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }
}
