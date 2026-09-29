import SwiftUI
import FinTrackCore
import FinTrackData

/// Portföy: toplam değer, maliyet, K/Z ve günlük değişim; varlıklar sınıfa göre.
/// Alım/satım web'de (bağlı defter satırları ve stopaj orada yazılıyor).
struct InvestmentsView: View {
    @Environment(AppModel.self) private var model

    private var groups: [(kind: AssetKind, items: [Holding], value: Double)] {
        AssetKind.allCases.compactMap { k in
            let items = model.holdings.filter { $0.kind == k }
            return items.isEmpty ? nil : (k, items, Money.sum(items) { $0.currentValue })
        }
        .sorted { $0.value > $1.value }
    }

    var body: some View {
        NavigationStack {
            List {
                if !model.holdings.isEmpty {
                    Section { summary } footer: { pricesFooter }
                    if groups.count > 1 {
                        Section("Dağılım") {
                            CategoryDonut(slices: groups.map {
                                CategorySlice(id: $0.kind.rawValue, name: $0.kind.label, amount: $0.value, color: $0.kind.color)
                            }, total: model.investValue)
                            .padding(.vertical, 4)
                        }
                    }
                    ForEach(groups, id: \.kind) { g in
                        Section {
                            ForEach(g.items, id: \.asset) { h in
                                NavigationLink(value: h.asset) { HoldingRow(h: h) }
                            }
                        } header: {
                            HStack {
                                Text(g.kind.label)
                                Spacer()
                                Text(Fmt.currency(g.value)).monospacedDigit()
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if model.holdings.isEmpty {
                    ContentUnavailableView("Yatırım yok", systemImage: "chart.line.uptrend.xyaxis",
                                           description: Text("Alım ve satımlar web'den eklenir."))
                }
            }
            .refreshable {
                await model.refresh()
            }
            .navigationTitle("Yatırımlar")
            .navigationDestination(for: String.self) { InvestmentDetailView(asset: $0) }
        }
    }

    private var summary: some View {
        let cost = Money.sum(model.holdings) { $0.totalCost }
        let value = model.investValue
        let pnl = Money.sub(value, cost)
        let dayItems = model.holdings.compactMap(\.dayChange)
        let day = dayItems.isEmpty ? nil : Money.sum(dayItems) { $0 }
        let missing = model.holdings.filter { !$0.hasPrice }.count
        return VStack(alignment: .leading, spacing: 10) {
            Text("Portföy değeri").font(.subheadline).foregroundStyle(.secondary)
            Text(Fmt.currency(value))
                .font(.system(size: 32, weight: .bold).monospacedDigit())
                .minimumScaleFactor(0.6).lineLimit(1)
            AdaptiveStack {
                stat("Maliyet", Fmt.currency(cost), .primary)
                stat("Kâr/Zarar", "\(Fmt.signed(pnl)) \(percent(pnl, of: cost))", pnl >= 0 ? Theme.income : Theme.expense)
            }
            if let day {
                stat("Bugün", Fmt.signed(day), day >= 0 ? Theme.income : Theme.expense)
            }
            if missing > 0 {
                Label("\(missing) varlığın fiyatı alınamadı; toplama 0 olarak girdi.", systemImage: "exclamationmark.triangle")
                    .font(.caption).foregroundStyle(Theme.warning)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var pricesFooter: some View {
        if let at = model.prices.updatedAt {
            Text("Fiyatlar \(at.formatted(.relative(presentation: .named).locale(Locale(identifier: "tr_TR")))) güncellendi. Değerler stopaj öncesi (brüt).")
        } else {
            Text("Fiyatlar henüz alınamadı.")
        }
    }

    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(color)
        }
    }
}

func percent(_ part: Double, of whole: Double) -> String {
    guard whole > 0 else { return "" }
    let p = part / whole * 100
    return String(format: "(%@%%%.1f)", p < 0 ? "−" : "+", abs(p)).replacingOccurrences(of: ".", with: ",")
}

/// Miktar: tam sayıysa binlik ayraçlı, değilse en çok 4 hane (web fmtQty).
func formatQuantity(_ q: Double) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "tr_TR")
    f.numberStyle = .decimal
    f.maximumFractionDigits = q.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 4
    return f.string(from: NSNumber(value: q)) ?? "\(q)"
}

extension AssetKind {
    var color: Color {
        switch self {
        case .gold: Color(hex: "#D4A017")
        case .currency: Color(hex: "#3B82F6")
        case .fund: Color(hex: "#8B5CF6")
        case .stock: Color(hex: "#EF4444")
        case .crypto: Color(hex: "#F59E0B")
        }
    }
}

struct AssetBadge: View {
    let asset: String
    var size: CGFloat = 36

    private var style: (text: String, color: Color) {
        let kind = Asset.kind(asset)
        switch kind {
        case .gold: return ("Au", kind.color)
        case .currency: return (asset == "USD" ? "$" : asset == "EUR" ? "€" : "£", kind.color)
        case .fund: return ("F", kind.color)
        case .stock: return ("H", kind.color)
        case .crypto: return ("₿", kind.color)
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(style.color.opacity(0.16))
            Text(style.text)
                .font(.system(size: size * 0.4, weight: .bold, design: .rounded))
                .foregroundStyle(style.color)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct HoldingRow: View {
    @Environment(AppModel.self) private var model
    let h: Holding

    var body: some View {
        HStack(spacing: 12) {
            AssetBadge(asset: h.asset)
            VStack(alignment: .leading, spacing: 2) {
                Text(Asset.label(h.asset)).lineLimit(1)
                Text("\(formatQuantity(h.quantity)) \(Asset.unit(h.asset))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(h.hasPrice ? Fmt.currency(h.currentValue) : "Fiyat yok")
                    .font(.body.monospacedDigit().weight(.semibold))
                    .foregroundStyle(h.hasPrice ? Color.primary : Color.secondary)
                if h.hasPrice {
                    Text("\(Fmt.signed(h.pnl)) \(percent(h.pnl, of: h.totalCost))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(h.pnl >= 0 ? Theme.income : Theme.expense)
                }
            }
        }
    }
}

struct InvestmentDetailView: View {
    @Environment(AppModel.self) private var model
    let asset: String

    private var holding: Holding? { model.holdings.first { $0.asset == asset } }
    private var txs: [InvestmentTransaction] {
        model.investments.filter { $0.asset == asset }
            .sorted { $0.date != $1.date ? $0.date > $1.date : $0.createdAt > $1.createdAt }
    }
    private var quoteName: String? {
        switch Asset.kind(asset) {
        case .fund: model.prices.quotes[Asset.code(asset)]?.name
        case .stock, .crypto: model.prices.quotes[asset]?.name
        default: nil
        }
    }

    var body: some View {
        List {
            if let h = holding {
                Section {
                    row("Miktar", "\(formatQuantity(h.quantity)) \(Asset.unit(asset))")
                    row("Güncel fiyat", h.hasPrice ? Fmt.currency(h.currentPrice) : "—")
                    if let prev = model.prices.prevPrice(asset), h.hasPrice {
                        let ch = h.currentPrice - prev
                        row("Günlük", "\(Fmt.signed(ch)) \(percent(ch, of: prev))", ch >= 0 ? Theme.income : Theme.expense)
                    }
                    row("Ortalama maliyet", Fmt.currency(h.avgCostPerUnit))
                    row("Toplam maliyet", Fmt.currency(h.totalCost))
                    row("Güncel değer", h.hasPrice ? Fmt.currency(h.currentValue) : "—")
                    if h.hasPrice {
                        row("Kâr/Zarar", "\(Fmt.signed(h.pnl)) \(percent(h.pnl, of: h.totalCost))",
                            h.pnl >= 0 ? Theme.income : Theme.expense)
                    }
                } header: {
                    if let quoteName { Text(quoteName).textCase(nil) }
                }
            }
            Section("İşlemler") {
                ForEach(txs) { t in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.type == "buy" ? "Alım" : "Satış")
                                .foregroundStyle(t.type == "buy" ? Color.primary : Theme.income)
                            Text(DateUtil.display(t.date)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("\(formatQuantity(t.quantity)) × \(Fmt.currency(t.pricePerUnit))")
                                .font(.subheadline.monospacedDigit())
                            Text(Fmt.currency(t.quantity * t.pricePerUnit))
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Asset.label(asset))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ label: String, _ value: String, _ color: Color = .primary) -> some View {
        LabeledContent(label) {
            Text(value).monospacedDigit().foregroundStyle(color)
        }
    }
}
