import SwiftUI
import Charts
import FinTrackCore
import FinTrackData

/// Abonelikler — "abonelik" etiketli giderlerden türetilir (web /subscriptions).
/// Şablon değil: her ödeme kullanıcının girdiği işlemdir.
struct SubscriptionsContent: View {
    @Environment(AppModel.self) private var model
    @State private var sortByDate = false

    var body: some View {
        let summary = Subscriptions.summarize(model.transactions, fx: model.fx)
        let groups = sortByDate ? summary.groups.sorted { $0.lastDate > $1.lastDate } : summary.groups
        List {
            if summary.serviceCount > 0 {
                Section { stats(summary) }
                if let banner = riseBanner(summary.groups) {
                    Section { banner }
                }
                Section("Son 12 ay") { history }
                Section {
                    ForEach(groups) { g in
                        NavigationLink(value: SubscriptionKey(key: g.key)) { SubscriptionRow(group: g) }
                    }
                } header: {
                    HStack {
                        Text("Servisler")
                        Spacer()
                        Picker("Sırala", selection: $sortByDate) {
                            Text("Tutar").tag(false)
                            Text("Son tarih").tag(true)
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .textCase(nil)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if summary.serviceCount == 0 {
                ContentUnavailableView {
                    Label("Henüz abonelik yok", systemImage: "repeat.circle")
                } description: {
                    Text("Netflix, Spotify gibi ödemeleri eklerken \"Abonelik\"i açın; burada toplanır, zamlar yakalanır.")
                }
            }
        }
    }

    private func stats(_ s: SubscriptionsSummary) -> some View {
        HStack(spacing: 0) {
            tile("Bu ay", Fmt.whole(s.monthTotalTry))
            Divider().frame(height: 32)
            tile("Aylık tahmini", Fmt.whole(s.monthlyEstimateTry))
            Divider().frame(height: 32)
            tile("Abonelik", "\(s.serviceCount)")
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// Son 3 ayda zam gelen abonelikler (web: fiyat değişimi ≥ %1, 90 gün).
    private func riseBanner(_ groups: [SubscriptionGroup]) -> AnyView? {
        guard let t = DateUtil.parseDay(DateUtil.today()),
              let from = DateUtil.calendar.date(byAdding: .day, value: -90, to: t) else { return nil }
        let cutoff = DateUtil.day(from)
        let rises = groups.filter { ($0.priceChange?.date ?? "") >= cutoff }
        guard !rises.isEmpty else { return nil }
        let extra = rises.reduce(0.0) { acc, g in
            acc + model.fx.toBaseTry(g.priceChange!.to - g.priceChange!.from, g.currency)
        }
        let names = rises.map { "\($0.name) +%\(Int($0.priceChange!.pct.rounded()))" }.joined(separator: ", ")
        return AnyView(
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Son 3 ayda \(rises.count) aboneliğe zam geldi — aylık +\(Fmt.whole(extra))")
                        .font(.subheadline.weight(.semibold))
                    Text(names).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "arrow.up.forward.circle.fill").foregroundStyle(Theme.warning)
            }
        )
    }

    private var history: some View {
        let months = Subscriptions.subscriptionMonthlyHistory(model.transactions, months: 12, fx: model.fx)
        let avg = months.isEmpty ? 0 : Money.sum(months) { $0.totalTry } / Double(months.count)
        return VStack(alignment: .leading, spacing: 8) {
            Chart(months, id: \.month) { m in
                BarMark(x: .value("Ay", String(m.month.suffix(2))), y: .value("Tutar", m.totalTry), width: .ratio(0.6))
                    .foregroundStyle(Theme.accent.gradient)
                    .cornerRadius(3)
            }
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { v in
                    AxisGridLine()
                    if !Fmt.amountsHidden, let d = v.as(Double.self) { AxisValueLabel { Text(TrendChart.compact(d)) } }
                }
            }
            .chartXAxis {
                AxisMarks { v in
                    AxisValueLabel {
                        if let s = v.as(String.self), let m = Int(s) {
                            Text(DateUtil.calendar.shortMonthSymbols[m - 1].prefix(3))
                        }
                    }
                }
            }
            .frame(height: 140)
            .accessibilityLabel("Son 12 ayın abonelik harcaması, aylık ortalama \(Fmt.whole(avg))")
            Text("Aylık ortalama \(Fmt.whole(avg))").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// NavigationLink değeri (String başka yerde kullanılıyor)
struct SubscriptionKey: Hashable { let key: String }

struct BrandBadge: View {
    let brand: SubscriptionBrand?
    let name: String
    var size: CGFloat = 36

    var body: some View {
        let color = brand.map { Color(hex: $0.colorHex) } ?? Color(.systemGray)
        let initials = String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased(with: Locale(identifier: "tr_TR"))
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(color.gradient)
            .frame(width: size, height: size)
            .overlay {
                Text(initials.isEmpty ? "?" : initials)
                    .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }
}

struct SubscriptionRow: View {
    let group: SubscriptionGroup

    var body: some View {
        HStack(spacing: 12) {
            BrandBadge(brand: group.brand, name: group.name)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(group.name).lineLimit(1)
                    if let p = group.priceChange {
                        Text("Zam +%\(Int(p.pct.rounded()))")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .foregroundStyle(Theme.warning)
                            .background(Theme.warning.opacity(0.15), in: Capsule())
                    }
                }
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.currency(group.latestAmount, group.currency))
                    .font(.body.monospacedDigit().weight(.semibold))
                Text("son ödeme").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var subtitle: String {
        var parts = [DateUtil.display(group.lastDate, "d MMM")]
        if group.count > 1 { parts.append("\(group.count) ödeme") }
        return parts.joined(separator: " · ")
    }
}

struct SubscriptionDetailView: View {
    @Environment(AppModel.self) private var model
    let key: String
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    var body: some View {
        if let g = Subscriptions.findSubscriptionGroup(model.transactions, key: key, fx: model.fx) {
            TransactionList(transactions: g.txs, editing: $editing, pendingDelete: $pendingDelete)
                .safeAreaInset(edge: .top) {
                    HStack(spacing: 14) {
                        BrandBadge(brand: g.brand, name: g.name, size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Fmt.currency(g.latestAmount, g.currency))
                                .font(.title2.bold().monospacedDigit())
                            Text("Aylık tahmini \(Fmt.whole(g.monthlyEstimateTry)) · toplam \(Fmt.whole(g.totalTry)) · \(g.count) ödeme")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(.bar)
                }
                .navigationTitle(g.name)
                .navigationBarTitleDisplayMode(.inline)
                .sheet(item: $editing) { TransactionFormView(editing: $0) }
                .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
        } else {
            ContentUnavailableView("Abonelik bulunamadı", systemImage: "questionmark.circle")
        }
    }
}
