import SwiftUI
import FinTrackCore
import FinTrackData

/// Ödeme Takibi (web /payments liste görünümü): kart ekstreleri ve kredi
/// taksitleri ay ay. "Öde" web payRow: ödeme işlemi + ayın kaydı "ödendi".
/// Tutar/gün düzenleme ve "atla" web'de (Ayarlar → Web).
struct PaymentsView: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @State private var month = String(DateUtil.today().prefix(7))
    @State private var paying: PaymentRow?

    var body: some View {
        let board = model.paymentBoard(month: month)
        let summary = PaymentSchedule.summarizeRows(board.monthRows, fx: model.fx)
        let setup = board.targets.filter { $0.isActive && $0.needsSetup }
        List {
            Section {
                monthSwitcher
                summaryView(summary, carry: board.carryRows)
            }
            if !setup.isEmpty {
                Section {
                    Link(destination: WebLinks.cardCalendar) {
                        Label("\(setup.count) kartın son ödeme günü girilmedi: \(setup.map(\.name).joined(separator: ", ")). Web'de Kart Takvimi'nden girin.",
                              systemImage: "exclamationmark.circle")
                            .font(.footnote)
                    }
                }
            }
            section("Önceki aylardan gecikmiş", board.carryRows, showMonth: true)
            section("Gecikmiş", board.monthRows.filter { $0.isActionable && $0.timing == .overdue })
            section("Bugün ve önümüzdeki 7 gün", board.monthRows.filter { $0.isActionable && ($0.timing == .today || $0.timing == .soon) })
            section("Ayın geri kalanı", board.monthRows.filter { $0.isActionable && ($0.timing == .later || $0.timing == .done) })
            section("Ödenenler", board.monthRows.filter { $0.state == .paid || $0.state == .clear }, done: true)
            section("Atlananlar", board.monthRows.filter { $0.state == .skipped }, done: true)
        }
        .listStyle(.insetGrouped)
        .overlay {
            if board.targets.filter(\.isActive).isEmpty {
                ContentUnavailableView("Takip edilen ödeme yok", systemImage: "calendar.badge.checkmark",
                                       description: Text("Kredi kartları ve 'borçluyum' borçlar burada ay ay izlenir."))
            }
        }
        .refreshable { await model.refresh() }
        .navigationTitle("Ödeme Takibi")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $paying) { PayRowSheet(row: $0) }
    }

    private var monthSwitcher: some View {
        HStack {
            Button { month = PaymentSchedule.shiftMonth(month, -1) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Önceki ay")
            Spacer()
            Text(title(month)).font(.headline)
            Spacer()
            Button { month = PaymentSchedule.shiftMonth(month, 1) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Sonraki ay")
        }
        .buttonStyle(.borderless)
    }

    private func title(_ m: String) -> String {
        let p = m.split(separator: "-").compactMap { Int($0) }
        return p.count == 2 ? DateUtil.monthTitle(MonthYear(month: p[1], year: p[0])) : m
    }

    private func summaryView(_ s: PaymentSummary, carry: [PaymentRow]) -> some View {
        let carryOverdue = carry.count
        let carryTry = Money.sum(carry) { model.fx.toBaseTry($0.remaining, $0.target.currency) }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bu ay ödenecek").font(.caption).foregroundStyle(.secondary)
                    Text(Fmt.currency(s.totalTry)).font(.title2.bold().monospacedDigit())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Kalan").font(.caption).foregroundStyle(.secondary)
                    Text(Fmt.currency(s.remainingTry)).font(.headline.monospacedDigit())
                        .foregroundStyle(s.remainingTry > 0 ? Color.primary : Theme.income)
                }
            }
            ProgressView(value: min(s.paidTry, max(s.totalTry, 0.01)), total: max(s.totalTry, 0.01))
                .tint(Theme.income)
            AdaptiveStack(spacing: 14) {
                Text("Ödenen \(Fmt.currency(s.paidTry))")
                if s.overdueCount + carryOverdue > 0 {
                    Text("Gecikmiş \(s.overdueCount + carryOverdue) · \(Fmt.currency(Money.add(s.overdueTry, carryTry)))")
                        .foregroundStyle(Theme.expense)
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            if s.unknownCount > 0 {
                Text("\(s.unknownCount) ödemenin tutarı girilmedi (web'de girilir).")
                    .font(.caption).foregroundStyle(Theme.warning)
            }
            if let next = s.next {
                Text("Sıradaki: \(next.target.name) · \(DateUtil.display(next.dueDate, "d MMM"))\(next.amount.map { " · " + Fmt.currency($0, next.target.currency) } ?? "")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func section(_ title: String, _ rows: [PaymentRow], showMonth: Bool = false, done: Bool = false) -> some View {
        if !rows.isEmpty {
            Section {
                ForEach(rows) { r in
                    PaymentRowView(row: r, showMonth: showMonth) { pay(r) }
                }
            } header: {
                HStack {
                    Text(title)
                    Spacer()
                    let sum = done ? Money.sum(rows) { model.fx.toBaseTry($0.paidAmount, $0.target.currency) }
                                   : Money.sum(rows) { model.fx.toBaseTry($0.remaining, $0.target.currency) }
                    Text(sum > 0 ? "\(rows.count) · \(Fmt.whole(sum))\(done ? " ödendi" : "")" : "\(rows.count) ödeme")
                        .monospacedDigit()
                }
            }
        }
    }

    private func pay(_ r: PaymentRow) { paying = r }
}

struct PaymentRowView: View {
    @Environment(AppModel.self) private var model
    let row: PaymentRow
    var showMonth = false
    var onPay: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconBadge(symbol: row.target.kind == .card ? "creditcard" : "building.columns",
                      color: Color(hex: row.target.color), size: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.target.name).lineLimit(1)
                pill
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                if let note = amountNote {
                    Text(note).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 6) {
                Text(amountText)
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(row.amount == nil && row.paidAmount == 0 ? Color.secondary : Color.primary)
                    .lineLimit(1)
                if row.isActionable {
                    Button("Öde", action: onPay)
                        .font(.caption.bold())
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                        .foregroundStyle(Theme.onAccent)
                        .controlSize(.small)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .contain)
    }

    private var subtitle: String {
        var parts: [String] = []
        let kind = row.target.kind == .card ? "Kredi kartı" : (row.target.debt?.counterparty.flatMap { $0.isEmpty ? nil : $0 } ?? "Borç")
        parts.append(kind)
        parts.append((showMonth ? DateUtil.display(row.dueDate, "d MMM yyyy") : DateUtil.display(row.dueDate, "d MMM EEE")) + " · " + dueLabel)
        if let from = model.account(row.fromAccountId) { parts.append(from.name) }
        return parts.joined(separator: " · ")
    }

    /// web dueLabel
    private var dueLabel: String {
        switch row.state {
        case .paid: return row.paidDate.map { "\(DateUtil.display($0, "d MMM")) ödendi" } ?? "Ödendi"
        case .skipped: return "Bu ay atlandı"
        case .clear: return "Ödenecek tutar yok"
        default: break
        }
        if row.timing == .done { return "Takip başlangıcından önce" }
        let d = row.daysLeft
        if d < 0 { return "\(-d) gün gecikti" }
        if d == 0 { return "Son gün bugün" }
        if d == 1 { return "Yarın" }
        return "\(d) gün kaldı"
    }

    private var amountText: String {
        let cur = row.target.currency
        if let a = row.amount { return Fmt.currency(a, cur) }
        if row.paidAmount > 0 { return Fmt.currency(row.paidAmount, cur) }
        return "Tutar girilmedi"
    }

    /// web amountNote
    private var amountNote: String? {
        let cur = row.target.currency
        switch row.state {
        case .partial:
            return "\(Fmt.currency(row.paidAmount, cur)) ödendi · kalan \(Fmt.currency(row.remaining, cur))"
        case .paid where row.amount != nil && row.paidAmount != row.amount:
            return "\(Fmt.currency(row.paidAmount, cur)) ödendi"
        case .paid, .skipped, .clear:
            return nil
        default:
            if row.amountSource == .custom { return "bu aya özel" }
            if row.amountSource == .derived { return "aylık taksit" }
            if row.target.kind == .card && row.amount == nil && row.isActionable { return "ekstre tutarını web'de girin" }
            return nil
        }
    }

    /// web durum etiketi
    private var pill: some View {
        let (text, color): (String, Color) = {
            let oto = row.paidVia == .detected ? " · oto" : ""
            switch row.state {
            case .paid: return ("Ödendi" + oto, Theme.income)
            case .partial: return ((row.timing == .overdue ? "Kısmi · gecikti" : "Kısmi") + oto, Theme.warning)
            case .skipped: return ("Atlandı", .secondary)
            case .clear: return ("Borç yok", .secondary)
            case .open:
                switch row.timing {
                case .overdue: return ("Gecikti", Theme.expense)
                case .today: return ("Bugün", Theme.warning)
                case .soon: return ("Yaklaşıyor", Theme.planned)
                case .later: return ("Bekliyor", .secondary)
                case .done: return ("Takip dışı", .secondary)
                }
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
            .fixedSize()
    }
}

struct PaymentsRoute: Hashable {}
