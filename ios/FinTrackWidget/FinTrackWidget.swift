import WidgetKit
import SwiftUI
import FinTrackCore

/* ── Ana ekran / kilit ekranı widget'ları ─────────────────────────────────
   Widget ağa çıkmaz, oturum taşımaz: uygulamanın App Group'a yazdığı özeti
   (WidgetSnapshot) gösterir. Uygulama her veri değişiminde özeti yazıp
   widget'ı yeniler; widget ayrıca saatte bir kendini tazeler (ay dönümü,
   "x dk önce" yazısı). "Tutarları gizle" açıksa tutarlar ₺••• görünür.
─────────────────────────────────────────────────────────────────────────── */

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now, snapshot: context.isPreview ? (WidgetSnapshot.load() ?? .sample) : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let entry = Entry(date: .now, snapshot: WidgetSnapshot.load())
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: .now)!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Biçim

private let accent = Color(red: 0, green: 0.85, blue: 0.85)
private let expenseRed = Color(red: 0.86, green: 0.24, blue: 0.24)
private let incomeGreen = Color(red: 0.13, green: 0.66, blue: 0.36)
private let warn = Color(red: 0.96, green: 0.62, blue: 0.04)

private func money(_ v: Double, _ s: WidgetSnapshot) -> String {
    s.amountsHidden ? "₺•••" : Fmt.whole(v)
}

private func signedWhole(_ v: Double, _ s: WidgetSnapshot) -> String {
    s.amountsHidden ? "₺•••" : "\(v < 0 ? "−" : "+")\(Fmt.whole(abs(v)))"
}

private func hex(_ h: String) -> Color {
    var s = h.hasPrefix("#") ? String(h.dropFirst()) : h
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    let v = UInt64(s, radix: 16) ?? 0x6B7280
    return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

private func statusColor(_ status: String) -> Color {
    status == "exceeded" ? expenseRed : status == "warning" ? warn : accent
}

private extension WidgetSnapshot {
    var budgetRatio: Double { budgetLimit > 0 ? min(1, budgetSpent / budgetLimit) : 0 }
    var budgetPercent: Int { budgetLimit > 0 ? Int((budgetSpent / budgetLimit * 100).rounded()) : 0 }
    var budgetColor: Color {
        let p = budgetLimit > 0 ? budgetSpent / budgetLimit * 100 : 0
        return p >= 100 ? expenseRed : p >= 80 ? warn : accent
    }
    var monthName: String { monthTitle.components(separatedBy: " ").first ?? monthTitle }

    static let sample = WidgetSnapshot(
        month: String(DateUtil.today().prefix(7)), monthTitle: DateUtil.monthTitle(.current()),
        expense: 32_071, income: 68_000, net: 35_929, netWorth: 125_268,
        budgetSpent: 8_071, budgetLimit: 15_600,
        budgets: [
            .init(name: "Market", colorHex: "#22C55E", spent: 4_821, limit: 7_800, percent: 62, status: "ok"),
            .init(name: "Ulaşım", colorHex: "#3B82F6", spent: 1_890, limit: 4_000, percent: 47, status: "ok"),
            .init(name: "Kahve ve Cafe", colorHex: "#713F12", spent: 355, limit: 800, percent: 44, status: "ok"),
        ],
        amountsHidden: false, updatedAt: .now)
}

// MARK: - Görünümler

struct EmptyState: View {
    var text = "Uygulamayı açıp giriş yapın."
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "chart.line.uptrend.xyaxis").foregroundStyle(accent)
            Text("FinTrack").font(.headline)
            Text(text).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct StaleNote: View {
    let s: WidgetSnapshot
    var body: some View {
        if !s.isCurrentMonth {
            Text("Yeni ay — uygulamayı açın").font(.caption2).foregroundStyle(warn)
        } else {
            (Text("Güncelleme ") + Text(s.updatedAt, style: .time))
                .font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

struct SmallView: View {
    let s: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(s.monthName) harcaması").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(money(s.expense, s))
                .font(.system(size: 26, weight: .bold).monospacedDigit())
                .minimumScaleFactor(0.5).lineLimit(1)
            Spacer(minLength: 0)
            if s.budgetLimit > 0 {
                HStack {
                    Text("Bütçe").font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Text("%\(s.budgetPercent)").font(.caption2.bold().monospacedDigit())
                        .foregroundStyle(s.budgetPercent >= 80 ? s.budgetColor : Color.secondary)
                }
                ProgressView(value: s.budgetRatio).tint(s.budgetColor)
            } else {
                Text("Net \(signedWhole(s.net, s))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(s.net >= 0 ? incomeGreen : expenseRed)
            }
            StaleNote(s: s)
        }
    }
}

struct MediumView: View {
    let s: WidgetSnapshot
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(s.monthName) harcaması").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(money(s.expense, s))
                    .font(.system(size: 24, weight: .bold).monospacedDigit())
                    .minimumScaleFactor(0.5).lineLimit(1)
                HStack(spacing: 4) {
                    Text("Gelir").foregroundStyle(.secondary)
                    Text(money(s.income, s)).foregroundStyle(incomeGreen)
                }
                .font(.caption.monospacedDigit()).lineLimit(1)
                HStack(spacing: 4) {
                    Text("Net").foregroundStyle(.secondary)
                    Text(signedWhole(s.net, s))
                        .foregroundStyle(s.net >= 0 ? incomeGreen : expenseRed)
                }
                .font(.caption.monospacedDigit()).lineLimit(1)
                Spacer(minLength: 0)
                HStack {
                    StaleNote(s: s)
                    Spacer()
                    Link(destination: URL(string: "fintrack://add")!) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color(red: 0.02, green: 0.15, blue: 0.15))
                            .frame(width: 28, height: 28)
                            .background(accent, in: Circle())
                    }
                    .accessibilityLabel("İşlem ekle")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                if s.budgets.isEmpty {
                    Text("Bütçe yok").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(s.budgets, id: \.name) { b in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Circle().fill(hex(b.colorHex)).frame(width: 6, height: 6)
                                Text(b.name).font(.caption2).lineLimit(1)
                                Spacer(minLength: 2)
                                Text("%\(Int(b.percent.rounded()))")
                                    .font(.caption2.bold().monospacedDigit())
                                    .foregroundStyle(b.status == "ok" ? Color.secondary : statusColor(b.status))
                            }
                            ProgressView(value: b.limit > 0 ? min(1, b.spent / b.limit) : 0)
                                .tint(statusColor(b.status))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(URL(string: "fintrack://budgets"))
        }
    }
}

struct RectangularView: View {
    let s: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(s.monthName) harcaması").font(.caption2).widgetAccentable()
            Text(money(s.expense, s)).font(.headline.monospacedDigit()).minimumScaleFactor(0.6)
            if s.budgetLimit > 0 {
                ProgressView(value: s.budgetRatio)
                Text("Bütçe %\(s.budgetPercent)").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

struct CircularView: View {
    let s: WidgetSnapshot
    var body: some View {
        Gauge(value: s.budgetRatio) {
            Image(systemName: "chart.pie")
        } currentValueLabel: {
            Text("\(s.budgetPercent)").monospacedDigit()
        }
        .gaugeStyle(.accessoryCircular)
    }
}

struct WidgetRoot: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    var body: some View {
        Group {
            if let s = entry.snapshot {
                switch family {
                case .systemMedium: MediumView(s: s)
                case .accessoryRectangular: RectangularView(s: s)
                case .accessoryCircular: CircularView(s: s)
                case .accessoryInline:
                    Text("\(s.monthName): \(money(s.expense, s)) harcandı")
                default: SmallView(s: s)
                }
            } else {
                switch family {
                case .accessoryRectangular, .accessoryCircular, .accessoryInline: Text("FinTrack")
                default: EmptyState()
                }
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
        .widgetURL(URL(string: "fintrack://summary"))
    }
}

struct FinTrackSummaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FinTrackSummary", provider: Provider()) { WidgetRoot(entry: $0) }
            .configurationDisplayName("Bu ay")
            .description("Bu ayın harcaması, geliri ve bütçe durumu.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct FinTrackWidgets: WidgetBundle {
    var body: some Widget { FinTrackSummaryWidget() }
}

#Preview(as: .systemMedium) { FinTrackSummaryWidget() } timeline: { Entry(date: .now, snapshot: .sample) }
#Preview(as: .systemSmall) { FinTrackSummaryWidget() } timeline: { Entry(date: .now, snapshot: .sample) }
