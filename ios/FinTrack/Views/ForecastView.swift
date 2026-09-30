import SwiftUI
import Charts
import FinTrackCore
import FinTrackData

struct ForecastRoute: Hashable {}

/// Nakit akışı tahmini (web /forecast): bugünkü bakiye + aktif tekrarlayanlar,
/// ileri tarihli işlemler ve borç taksitleri → önümüzdeki aylarda bakiye.
struct ForecastView: View {
    @Environment(AppModel.self) private var model
    @State private var horizon = 6
    @State private var mode: ForecastMode = .total

    private var result: ForecastResult {
        let funds = Money.sum(model.holdings.filter { $0.kind == .fund }) { $0.currentValue }
        return Forecast.build(accounts: model.accounts.filter { !$0.isArchived }, balances: model.balances,
                              recurring: model.recurring, transactions: model.transactions, debts: model.debts,
                              fx: model.fx, investmentsTry: model.investValue, fundsTry: funds,
                              horizonMonths: horizon, today: DateUtil.today(), mode: mode)
    }

    var body: some View {
        let r = result
        List {
            Section {
                Picker("Ufuk", selection: $horizon) {
                    Text("3 Ay").tag(3)
                    Text("6 Ay").tag(6)
                    Text("12 Ay").tag(12)
                }
                .pickerStyle(.segmented)
                Picker("Kapsam", selection: $mode) {
                    Text("Tüm varlıklar").tag(ForecastMode.total)
                    Text("Sadece nakit").tag(ForecastMode.cash)
                }
                .pickerStyle(.segmented)
            } footer: {
                Text(mode == .total
                     ? "Başlangıç: hesaplar + yatırımlar (net değer, borç hariç)."
                     : "Başlangıç: nakit, vadesiz ve birikim hesapları + fonlar. Kart ödemeleri nakitten düşer.")
            }

            if model.recurring.filter(\.isActive).isEmpty && r.events.isEmpty {
                Section {
                    ContentUnavailableView("Tahmin için veri yok", systemImage: "chart.line.uptrend.xyaxis",
                                           description: Text("Tahmin aktif tekrarlayan gelir ve giderlerinize göre hesaplanır. Önce Plan → Tekrarlayan'dan ekleyin."))
                }
            } else {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Bugün").font(.caption).foregroundStyle(.secondary)
                                Text(Fmt.whole(r.start)).font(.headline.monospacedDigit())
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(DateUtil.display(r.horizonEnd)).font(.caption).foregroundStyle(.secondary)
                                Text(Fmt.whole(r.points.last?.balance ?? r.start))
                                    .font(.headline.monospacedDigit())
                                    .foregroundStyle((r.points.last?.balance ?? 0) < 0 ? Theme.expense : .primary)
                            }
                        }
                        chart(r)
                    }
                    .padding(.vertical, 4)
                    if let s = r.shortfallDate {
                        Label {
                            Text("\(DateUtil.display(s)) tarihinde bakiyen eksiye düşebilir.").font(.subheadline.weight(.semibold))
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.expense)
                        }
                    }
                }
                Section {
                    AdaptiveStack(spacing: 12) {
                        tile("Toplam gelir", Fmt.whole(r.totalIncome), Theme.income)
                        tile("Toplam gider", (r.totalExpense > 0 ? "−" : "") + Fmt.whole(r.totalExpense), Theme.expense)
                        tile("Net", (r.net < 0 ? "−" : "+") + Fmt.whole(abs(r.net)), r.net >= 0 ? Theme.income : Theme.expense)
                    }
                }
                if !r.drivers.isEmpty {
                    Section("Aylık etkisi en büyük kalemler") {
                        ForEach(r.drivers.prefix(6), id: \.id) { d in
                            HStack {
                                Image(systemName: d.type == .income ? "arrow.down.left" : "arrow.up.right")
                                    .foregroundStyle(d.type == .income ? Theme.income : Theme.expense)
                                    .frame(width: 20)
                                Text(d.name).lineLimit(1)
                                Spacer()
                                Text("\(d.type == .income ? "+" : "−")\(Fmt.whole(d.monthlyTry))/ay")
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !r.events.isEmpty {
                    Section("Olaylar") {
                        ForEach(Array(r.events.prefix(40).enumerated()), id: \.offset) { _, e in
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.name).lineLimit(1)
                                    Text("\(DateUtil.display(e.date, "d MMM yyyy")) · \(label(e.source))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(Fmt.signed(e.delta)).font(.subheadline.monospacedDigit().weight(.semibold))
                                        .foregroundStyle(e.delta >= 0 ? Theme.income : .primary)
                                    Text(Fmt.whole(e.balanceAfter)).font(.caption.monospacedDigit())
                                        .foregroundStyle(e.balanceAfter < 0 ? Theme.expense : .secondary)
                                }
                            }
                        }
                        if r.events.count > 40 {
                            Text("+\(r.events.count - 40) olay daha").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Nakit akışı tahmini")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder private func chart(_ r: ForecastResult) -> some View {
        let values = r.points.map(\.balance)
        let minV = values.min() ?? 0, maxV = values.max() ?? 0
        let pad = max((maxV - minV) * 0.15, abs(maxV) * 0.02, 1)
        // Eksen veri aralığına dar (sıfırdan başlayınca çizgi basık kalıyordu); eksiye inerse 0 görünür
        let yLo = minV - pad
        let yHi = minV < 0 ? max(maxV + pad, pad) : maxV + pad
        let lo = yLo
        Chart {
            ForEach(Array(r.points.enumerated()), id: \.offset) { _, p in
                if let d = DateUtil.parseDay(p.date) {
                    AreaMark(x: .value("Tarih", d), yStart: .value("Alt", lo), yEnd: .value("Bakiye", p.balance))
                        .interpolationMethod(.stepEnd)
                        .foregroundStyle(LinearGradient(colors: [Theme.accent.opacity(0.3), Theme.accent.opacity(0.02)],
                                                        startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Tarih", d), y: .value("Bakiye", p.balance))
                        .interpolationMethod(.stepEnd)
                        .foregroundStyle(Theme.accent)
                }
            }
            if (values.min() ?? 0) < 0 {
                RuleMark(y: .value("Sıfır", 0))
                    .foregroundStyle(Theme.expense.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { v in
                AxisGridLine()
                if !Fmt.amountsHidden, let d = v.as(Double.self) { AxisValueLabel { Text(TrendChart.compact(d)) } }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .month, count: horizon >= 12 ? 3 : 1)) { _ in
                AxisGridLine()
                AxisValueLabel(format: .dateTime.month(.abbreviated).locale(Locale(identifier: "tr_TR")))
            }
        }
        .chartYScale(domain: yLo...yHi)
        .frame(height: 180)
        .accessibilityLabel("Bakiye \(Fmt.whole(r.start)) → \(Fmt.whole(r.points.last?.balance ?? r.start))")
    }

    private func tile(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func label(_ s: ForecastEvent.Source) -> String {
        switch s {
        case .recurring: "Tekrarlayan"
        case .transaction: "Planlı işlem"
        case .debt: "Borç taksiti"
        }
    }
}
