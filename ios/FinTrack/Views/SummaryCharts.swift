import SwiftUI
import Charts
import FinTrackCore
import FinTrackData

/// Kategori dağılımı dilimi (üst kategoriye toplanmış).
struct CategorySlice: Identifiable, Hashable {
    var id: String
    var name: String
    var amount: Double
    var color: Color
}

/// Bu ayın giderleri — halka + açıklama. En büyük 4 kategori, kalanı "Diğer".
struct CategoryDonut: View {
    let slices: [CategorySlice]
    let total: Double

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Chart(slices) { s in
                SectorMark(angle: .value("Tutar", s.amount), innerRadius: .ratio(0.62), angularInset: 1.5)
                    .cornerRadius(3)
                    .foregroundStyle(s.color)
            }
            .chartLegend(.hidden)
            .frame(width: 104, height: 104)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                ForEach(slices) { s in
                    HStack(spacing: 8) {
                        Circle().fill(s.color).frame(width: 8, height: 8)
                        Text(s.name).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(share(s.amount))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(s.name), \(Fmt.currency(s.amount)), \(share(s.amount))")
                }
            }
        }
    }

    private func share(_ v: Double) -> String {
        guard total > 0 else { return "" }
        return "%\((v / total * 100).rounded().safeInt)"
    }
}

/// Son aylar: gelir ve gider yan yana çubuk. Tutarlar gizliyse eksen değeri yok.
struct TrendChart: View {
    let series: [(month: MonthYear, flow: Calc.Flow)]

    private struct Point: Identifiable {
        var id: String { "\(key)-\(kind)" }
        var key: String
        var label: String
        var kind: String
        var value: Double
        var isCurrent: Bool
    }

    private var points: [Point] {
        let now = MonthYear.current()
        return series.flatMap { item -> [Point] in
            let key = String(format: "%04d-%02d", item.month.year, item.month.month)
            let label = String(DateUtil.monthTitle(item.month).prefix(3))
            let cur = item.month == now
            return [Point(key: key, label: label, kind: "Gelir", value: item.flow.income, isCurrent: cur),
                    Point(key: key, label: label, kind: "Gider", value: item.flow.expense, isCurrent: cur)]
        }
    }

    var body: some View {
        Chart(points) { p in
            BarMark(x: .value("Ay", p.label), y: .value("Tutar", p.value), width: .ratio(0.7))
                .foregroundStyle(by: .value("Tür", p.kind))
                .position(by: .value("Tür", p.kind))
                .cornerRadius(3)
                .opacity(p.isCurrent ? 1 : 0.75)
        }
        .chartForegroundStyleScale(["Gelir": Theme.income, "Gider": Theme.expense])
        .chartLegend(position: .top, alignment: .leading, spacing: 8)
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { v in
                AxisGridLine()
                if !Fmt.amountsHidden, let d = v.as(Double.self) {
                    AxisValueLabel { Text(Self.compact(d)) }
                }
            }
        }
        .frame(height: 170)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        series.map { "\(DateUtil.monthTitle($0.month)): gelir \(Fmt.whole($0.flow.income)), gider \(Fmt.whole($0.flow.expense))" }
            .joined(separator: "; ")
    }

    /// 12.500 → "12,5B", 1.250.000 → "1,3M" (eksen etiketi)
    static func compact(_ v: Double) -> String {
        let a = abs(v)
        let (n, suffix): (Double, String) = a >= 1_000_000 ? (v / 1_000_000, "M") : a >= 1_000 ? (v / 1_000, "B") : (v, "")
        let s = n.truncatingRemainder(dividingBy: 1) == 0 || abs(n) >= 100
            ? String(format: "%.0f", n) : String(format: "%.1f", n)
        return s.replacingOccurrences(of: ".", with: ",") + suffix
    }
}

/// Hesap bakiyesinin son 90 günü — eksensiz mini çizgi. Tutarlar gizliyse çizilmez.
struct BalanceSparkline: View {
    @Environment(AppModel.self) private var model
    let account: Account
    var days = 90

    var body: some View {
        if !Fmt.amountsHidden {
            let current = model.balances[account.id] ?? account.initialBalance
            let points = Calc.balanceHistory(account, current: current, posted: Calc.excludeFuture(model.transactions),
                                             fx: model.fx, days: days)
            let values = points.map(\.balance)
            if let lo = values.min(), let hi = values.max(), hi > lo {
                let color = (values.last ?? 0) >= (values.first ?? 0) ? Theme.income : Theme.expense
                Chart(Array(points.enumerated()), id: \.offset) { i, p in
                    AreaMark(x: .value("Gün", i), yStart: .value("Alt", lo), yEnd: .value("Bakiye", p.balance))
                        .foregroundStyle(LinearGradient(colors: [color.opacity(0.25), color.opacity(0.02)],
                                                        startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.stepEnd)
                    LineMark(x: .value("Gün", i), y: .value("Bakiye", p.balance))
                        .foregroundStyle(color)
                        .lineStyle(StrokeStyle(lineWidth: 1.5))
                        .interpolationMethod(.stepEnd)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: lo...hi)
                .frame(height: 44)
                .accessibilityLabel("Son \(days) günde bakiye \(Fmt.currency(values.first ?? 0, account.currency)) → \(Fmt.currency(values.last ?? 0, account.currency))")
            }
        }
    }
}
