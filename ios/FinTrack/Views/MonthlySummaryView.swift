import SwiftUI
import FinTrackCore
import FinTrackData

struct MonthlySummaryRoute: Hashable {}

/// Aylık Özet (web /reports/monthly): bir ayın tek sayfalık dökümü — gelir,
/// gider, net, tasarruf oranı; önceki ay ve geçen yılla kıyas; kategoriler,
/// bütçe sonuçları ve en büyük giderler. Yalnız okur.
struct MonthlySummaryView: View {
    @Environment(AppModel.self) private var model
    @State private var month = MonthlySummary.defaultMonth()
    @State private var cached: (key: String, month: MonthYear, value: MonthlySummary, budgets: [Calc.BudgetState])?

    /// derivedStamp her veri değişikliğinden sonraki türetimde artar
    private var key: String { "\(month.year)-\(month.month)|\(model.derivedStamp)|\(model.budgetsSignature)|\(DateUtil.today())" }
    private var isCurrent: Bool { month == .current() }

    var body: some View {
        List {
            Section {
                HStack {
                    Button { month = month.previous } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Önceki ay")
                    Spacer()
                    Text(DateUtil.monthTitle(month)).font(.headline)
                    Spacer()
                    Button { month = month.next } label: { Image(systemName: "chevron.right") }
                        .accessibilityLabel("Sonraki ay")
                        .disabled(isCurrent)
                }
                .buttonStyle(.borderless)
                if let s = summary, s.partial {
                    Label("Ay sürüyor · \(s.daysCounted)/\(s.daysInMonth) gün — kıyaslar ayın ilk \(s.daysCounted) günüyle",
                          systemImage: "calendar.badge.clock")
                        .font(.caption).foregroundStyle(Theme.warning)
                }
            }
            if let s = summary {
                content(s)
            } else {
                Section { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Aylık özet")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let s = summary {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: shareText(s)) { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel("Özeti paylaş")
                        .disabled(Fmt.amountsHidden)
                }
            }
        }
        .task(id: key) {
            // Ay okları art arda basılınca hesaplar yığılmasın
            if cached != nil { try? await Task.sleep(for: .milliseconds(150)) }
            guard !Task.isCancelled else { return }
            let txs = model.reportTransactions, fx = model.fx, my = month, k = key
            let budgets = model.budgets, categories = model.categories
            let (value, states) = await Task.detached(priority: .userInitiated) {
                // web: yalnız aylık bütçeler, en çok kullanılan önce
                let states = budgets.filter { $0.period == "monthly" }
                    .map { Calc.enrichBudget($0, txs, my, categories: categories, fx: fx) }
                    .sorted { $0.percentUsed > $1.percentUsed }
                return (MonthlySummary.build(txs, month: my, fx: fx), states)
            }.value
            guard !Task.isCancelled else { return }
            cached = (k, my, value, states)
        }
    }

    /// Başka ayın sonucu gösterilmez; aynı ayın önceki sonucu yeniden hesaplanırken
    /// ekranda kalır (her senkronda boş sayfaya dönmesin).
    private var summary: MonthlySummary? {
        guard let c = cached, c.month == month else { return nil }
        return c.value
    }

    private var budgets: [Calc.BudgetState] {
        guard let c = cached, c.month == month else { return [] }
        return c.budgets
    }

    // MARK: İçerik

    @ViewBuilder private func content(_ s: MonthlySummary) -> some View {
        let cur = s.current, prev = s.previous, ly = s.lastYear
        Section {
            AdaptiveStack(spacing: 12) {
                kpi("Gelir", Fmt.currency(cur.income), Theme.income) {
                    delta(cur.income, prev.income, goodWhenUp: true, "Önceki ay")
                    delta(cur.income, ly.income, goodWhenUp: true, "Geçen yıl")
                }
                kpi("Gider", Fmt.currency(cur.expense), Theme.expense) {
                    delta(cur.expense, prev.expense, goodWhenUp: false, "Önceki ay")
                    delta(cur.expense, ly.expense, goodWhenUp: false, "Geçen yıl")
                }
            }
            AdaptiveStack(spacing: 12) {
                kpi("Net", Fmt.currency(cur.net), cur.net < 0 ? Theme.expense : .primary) {
                    Text("Önceki ay \(Fmt.currency(prev.net))")
                    Text("Geçen yıl \(Fmt.currency(ly.net))")
                }
                kpi("Tasarruf oranı", rate(cur.savingsRate), (cur.savingsRate ?? 0) < 0 ? Theme.expense : .primary) {
                    Text("Önceki ay \(rate(prev.savingsRate))")
                    Text("Günlük ort. gider \(Fmt.whole(s.dailyAvgExpense))")
                }
            }
        } footer: {
            Text("\(range(cur)) · \(s.txCount) işlem · kıyas: \(range(prev)) ve \(range(ly))")
        }

        if !s.increases.isEmpty {
            Section("Dikkat çekenler") {
                ForEach(s.increases) { c in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "arrow.up.right").foregroundStyle(Theme.expense)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name(c.categoryId)).font(.subheadline.weight(.semibold))
                            Text("önceki aya göre \(Fmt.currency(Money.sub(c.amount, c.prevAmount))) fazla"
                                 + (c.change.map { " (%\($0.rounded().safeInt))" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }

        Section {
            if s.categories.isEmpty {
                Text("Bu ay gider yok.").foregroundStyle(.secondary)
            } else {
                let total = Money.sum(s.categories) { $0.amount }
                ForEach(s.categories) { c in
                    NavigationLink(value: CategoryTxRoute(title: name(c.categoryId),
                                                          categoryIds: c.categoryId.map { [$0] } ?? [],
                                                          uncategorized: c.categoryId == nil,
                                                          month: month, type: .expense)) {
                        categoryRow(c, total: total)
                    }
                }
            }
        } header: {
            HStack { Text("Kategoriler"); Spacer(); Text("önceki ay · geçen yıl").font(.caption).textCase(nil) }
        }

        if !budgets.isEmpty {
            let exceeded = budgets.filter { $0.status == .exceeded }.count
            Section {
                ForEach(budgets, id: \.budget.id) { BudgetProgressRow(state: $0, compact: true) }
            } header: {
                HStack {
                    Text("Bütçeler")
                    Spacer()
                    Text("\(budgets.count - exceeded)/\(budgets.count) limit içinde").font(.caption).textCase(nil)
                        .foregroundStyle(exceeded > 0 ? Theme.expense : Theme.income)
                }
            }
        }

        if !s.largestExpenses.isEmpty {
            Section("En büyük giderler") {
                ForEach(s.largestExpenses) { t in
                    let cat = model.category(t.categoryId)
                    AmountRow {
                        if let c = cat {
                            let i = Icons.category(c.icon)
                            IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color))
                        } else {
                            IconBadge(symbol: "tag", color: .gray)
                        }
                    } title: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.description.isEmpty ? (cat?.name ?? "Gider") : t.description).lineLimit(1)
                            Text(DateUtil.display(t.date, "d MMMM") + (cat.map { " · \($0.name)" } ?? ""))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    } trailing: {
                        Text(Fmt.currency(model.fx.baseAmount(t)))
                            .font(.subheadline.monospacedDigit().weight(.semibold))
                            .lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    private func categoryRow(_ c: MonthlySummary.CategoryRow, total: Double) -> some View {
        let cat = model.category(c.categoryId)
        let share = total > 0 ? c.amount / total * 100 : 0
        return HStack(spacing: 10) {
            if let cat {
                let i = Icons.category(cat.icon)
                IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: cat.color), size: 32)
            } else {
                IconBadge(symbol: "questionmark", color: .gray, size: 32)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(name(c.categoryId)).lineLimit(1)
                    Text("%\(share.rounded().safeInt)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
                Text("\(Fmt.whole(c.prevAmount)) · \(Fmt.whole(c.yearAmount))")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.currency(c.amount)).font(.subheadline.monospacedDigit().weight(.semibold)).lineLimit(1)
                changeBadge(c.change)
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Parçalar

    private func kpi<Extra: View>(_ title: String, _ value: String, _ color: Color,
                                  @ViewBuilder extra: () -> Extra) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
            VStack(alignment: .leading, spacing: 1) { extra() }
                .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// web Delta: % değişim; gelir/net için artış iyi, gider için kötü.
    @ViewBuilder private func delta(_ current: Double, _ prev: Double, goodWhenUp: Bool, _ label: String) -> some View {
        if let pct = MonthlySummary.pctChange(current, prev) {
            let r = pct.rounded().safeInt
            if r == 0 {
                Text("\(label): aynı")
            } else {
                (Text("\(label): ")
                 + Text("\(r > 0 ? "▲" : "▼") %\(abs(r))").fontWeight(.semibold)
                    .foregroundStyle((r > 0) == goodWhenUp ? Theme.income : Theme.expense))
            }
        } else {
            Text("\(label): yeni")
        }
    }

    @ViewBuilder private func changeBadge(_ change: Double?) -> some View {
        if let change {
            let r = change.rounded().safeInt
            Text(r == 0 ? "=" : "\(r > 0 ? "▲" : "▼") %\(abs(r))")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(r == 0 ? Color.secondary : r > 0 ? Theme.expense : Theme.income)
        } else {
            Text("yeni").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func name(_ id: String?) -> String { model.category(id)?.name ?? "Kategorisiz" }
    private func rate(_ r: Double?) -> String { r.map { "%\($0.rounded().safeInt)" } ?? "—" }
    private func range(_ f: MonthlySummary.Flow) -> String {
        "\(DateUtil.display(f.from, "d"))–\(DateUtil.display(f.to, "d MMM yyyy"))"
    }

    private func shareText(_ s: MonthlySummary) -> String {
        var lines = ["FinTrack · \(DateUtil.monthTitle(month)) özeti" + (s.partial ? " (\(s.daysCounted). güne kadar)" : ""),
                     "Gelir: \(Fmt.currency(s.current.income))",
                     "Gider: \(Fmt.currency(s.current.expense))",
                     "Net: \(Fmt.currency(s.current.net))",
                     "Tasarruf oranı: \(rate(s.current.savingsRate))"]
        if !s.categories.isEmpty {
            lines.append("")
            lines.append("Kategoriler:")
            lines += s.categories.prefix(8).map { "• \(name($0.categoryId)): \(Fmt.currency($0.amount))" }
        }
        return lines.joined(separator: "\n")
    }
}
