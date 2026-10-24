import SwiftUI
import Charts
import FinTrackCore
import FinTrackData

/// İstatistikler (web /statistics): dönem toplamı ve ortalamalar, işlem
/// sayıları, en çok harcanan / gelen kategoriler ve alıcılar.
struct StatisticsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("fintrack.includeFundGain") private var includeFundGain = false
    @State private var preset: Statistics.Preset = .thisMonth
    @State private var customFrom = Date()
    @State private var customTo = Date()
    @State private var accountId: String?

    var body: some View {
        let r = Statistics.range(preset, customFrom: DateUtil.day(customFrom), customTo: DateUtil.day(customTo),
                                 transactions: model.transactions)
        let s = Statistics.compute(reportTransactions: model.reportTransactions, from: r.from, to: r.to,
                                   accountId: accountId, categories: model.categories, people: model.people,
                                   fx: model.fx, includeFundGain: includeFundGain)
        List {
            Section {
                Picker("Dönem", selection: $preset) {
                    ForEach(Statistics.Preset.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                if preset == .custom {
                    DatePicker("Başlangıç", selection: $customFrom, displayedComponents: .date)
                    DatePicker("Bitiş", selection: $customTo, in: customFrom..., displayedComponents: .date)
                }
                Picker("Hesap", selection: $accountId) {
                    Text("Tüm hesaplar").tag(String?.none)
                    ForEach(model.activeAccounts) { Text($0.name).tag(Optional($0.id)) }
                }
                Toggle("Fon getirileri dahil", isOn: $includeFundGain)
            } footer: {
                Text("\(DateUtil.display(s.from)) – \(DateUtil.display(s.to)) · \(s.days) gün")
            }
            .environment(\.locale, Locale(identifier: "tr_TR"))

            Section("Dönem toplamı") {
                averages("Gider", s.expense, Theme.expense)
                averages("Gelir", s.income, Theme.income)
                LabeledContent("Net", value: Fmt.signed(Money.sub(s.income.total, s.expense.total)))
            }

            Section("İşlem sayısı") {
                LabeledContent("Gider", value: "\(s.counts.expense)")
                LabeledContent("Gelir", value: "\(s.counts.income)")
                LabeledContent("Transfer", value: "\(s.counts.transfer)")
                if s.counts.refund > 0 { LabeledContent("İade", value: "\(s.counts.refund)") }
                LabeledContent("Toplam", value: "\(s.counts.total)").bold()
            }

            netWorthSection

            ranks("En çok harcanan kategoriler", s.topExpenseCategories)
            ranks("En çok gelir getiren kategoriler", s.topIncomeCategories)
            ranks("En çok ödeme yapılan alıcılar", s.topExpensePayees)
            ranks("En çok gelir gelen kişiler", s.topIncomePayees)
        }
        .listStyle(.insetGrouped)
        .navigationTitle("İstatistikler")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// Net varlık trendi (web Raporlar): son 12 ay sonu + bugün
    @ViewBuilder private var netWorthSection: some View {
        let pts = NetWorthHistory.monthly(accounts: model.accounts, balances: model.balances,
                                          transactions: model.transactions, investments: model.investments,
                                          prices: model.prices, debts: model.debts, fx: model.fx)
        if pts.count > 1, let lo = pts.map(\.value).min(), let hi = pts.map(\.value).max() {
            Section {
                Chart {
                    ForEach(Array(pts.enumerated()), id: \.offset) { _, p in
                        if let d = DateUtil.parseDay(p.date) {
                            AreaMark(x: .value("Tarih", d), yStart: .value("Alt", lo), yEnd: .value("Net", p.value))
                                .foregroundStyle(Theme.tint.opacity(0.15))
                            LineMark(x: .value("Tarih", d), y: .value("Net", p.value))
                                .foregroundStyle(Theme.tint)
                        }
                    }
                }
                .chartYScale(domain: lo...(hi == lo ? lo + 1 : hi))
                .chartXAxis { AxisMarks(values: .stride(by: .month, count: 3)) { _ in AxisValueLabel(format: .dateTime.month(.abbreviated)) } }
                .frame(height: 160)
                .environment(\.locale, Locale(identifier: "tr_TR"))
                HStack {
                    VStack(alignment: .leading) {
                        Text("En yüksek").font(.caption2).foregroundStyle(.secondary)
                        Text(Fmt.whole(hi)).font(.caption.monospacedDigit())
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("Bugün").font(.caption2).foregroundStyle(.secondary)
                        Text(Fmt.whole(pts.last?.value ?? 0)).font(.caption.monospacedDigit().bold())
                    }
                }
            } header: {
                Text("Net varlık (12 ay)")
            } footer: {
                Text("Hesaplar + yatırımlar − kalan borç. Yatırımlar güncel fiyatla değerlenir (web ile aynı).")
            }
        }
    }

    private func averages(_ title: String, _ a: Statistics.Average, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.subheadline.bold())
                Spacer()
                Text(Fmt.currency(a.total)).font(.headline.monospacedDigit()).foregroundStyle(color)
            }
            HStack {
                stat("Günlük", a.daily)
                Spacer()
                stat("Aylık", a.monthly)
                Spacer()
                stat("Yıllık", a.yearly)
            }
        }
        .padding(.vertical, 2)
    }

    private func stat(_ label: String, _ v: Double) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(Fmt.whole(v)).font(.caption.monospacedDigit())
        }
    }

    @ViewBuilder private func ranks(_ title: String, _ items: [Statistics.Rank]) -> some View {
        if !items.isEmpty {
            Section(title) {
                ForEach(items) { it in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Circle().fill(Color(hex: it.color)).frame(width: 8, height: 8)
                            Text(it.name).lineLimit(1)
                            Spacer()
                            Text(Fmt.currency(it.amount)).monospacedDigit()
                        }
                        ProgressView(value: min(it.pct, 100), total: 100).tint(Color(hex: it.color))
                        Text(String(format: "%%%.1f", it.pct).replacingOccurrences(of: ".", with: ","))
                            .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
