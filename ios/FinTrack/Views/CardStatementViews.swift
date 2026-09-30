import SwiftUI
import FinTrackCore
import FinTrackData

extension StatementStatus {
    var color: Color {
        switch self {
        case .clear, .paid: Theme.income
        case .partial: Theme.warning
        case .open: Theme.planned
        case .overdue: Theme.expense
        }
    }
}

struct StatusPill: View {
    let status: StatementStatus
    var body: some View {
        Text(status.label)
            .font(.caption2.bold())
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(status.color)
            .background(status.color.opacity(0.14), in: Capsule())
    }
}

private func periodText(_ p: StatementPeriod) -> String {
    "\(DateUtil.display(p.from, "d MMM")) – \(DateUtil.display(p.to, "d MMM"))"
}

/// Kredi kartı detayının üstünde: dönem içi harcama ve son ekstre durumu.
/// Uygulamadaki işlemlerden hesaplanır (bankanın ekstresi değil).
struct CardStatementSummary: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    let account: Account

    var body: some View {
        let r = model.cardStatements(account)
        VStack(alignment: .leading, spacing: 10) {
            summaryLink(r)
            if let last = r.statements.first, last.status == .open || last.status == .partial || last.status == .overdue {
                let due = max(0, Money.sub(last.total, last.paid))
                Button {
                    router.payCard(account, amount: amountInPayerCurrency(due), from: defaultPayer)
                } label: {
                    Label("Ekstreyi öde · \(Fmt.currency(due, account.currency))", systemImage: "arrow.right.circle.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(Theme.tint)
            }
        }
    }

    /// Transfer tutarı kaynak hesabın para biriminde (web payRow dönüşümü)
    private func amountInPayerCurrency(_ due: Double) -> Double {
        guard let from = model.account(defaultPayer), from.currency != account.currency,
              model.fx.rate(account.currency) != nil, model.fx.rate(from.currency) != nil else { return due }
        return Money.round(model.fx.fromBaseTry(model.fx.toBaseTry(due, account.currency), from.currency))
    }

    /// Ödeme hesabı: son kullanılan, yoksa ilk TL vadesiz/nakit (kart dışı)
    private var defaultPayer: String? {
        let last = UserDefaults.standard.string(forKey: "fintrack.lastAccountId")
        let payers = model.activeAccounts.filter { $0.type != .credit_card }
        return payers.first { $0.id == last }?.id
            ?? payers.first { $0.currency == .TRY && ($0.type == .checking || $0.type == .cash) }?.id
            ?? payers.first?.id
    }

    private func summaryLink(_ r: CardStatementResult) -> some View {
        NavigationLink(value: CardStatementsRoute(accountId: account.id)) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Dönem içi").font(.caption).foregroundStyle(.secondary)
                    Text(Fmt.currency(r.open.total, account.currency))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                    Text("\(DateUtil.display(r.open.period.to, "d MMM")) kesim")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let last = r.statements.first {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text("Son ekstre").font(.caption).foregroundStyle(.secondary)
                            StatusPill(status: last.status)
                        }
                        Text(Fmt.currency(last.total, account.currency))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                        Text(last.dueDate.map { "Son ödeme \(DateUtil.display($0, "d MMM"))" } ?? "Son ödeme günü girilmemiş")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                    .padding(.top, 14)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Ekstreleri gösterir")
    }
}

struct CardStatementsRoute: Hashable { let accountId: String }

/// Son 12 ekstre + açık dönem; satır açılınca o dönemin harcamaları.
struct CardStatementsView: View {
    @Environment(AppModel.self) private var model
    let accountId: String
    @State private var expanded: Set<String> = []

    var body: some View {
        if let account = model.account(accountId) {
            let r = model.cardStatements(account, count: 12)
            List {
                Section {
                    Text(cycleText(model.cardDays(account)))
                        .font(.footnote).foregroundStyle(.secondary)
                    Link(destination: WebLinks.cardCalendar) {
                        Label("Kesim / son ödeme günlerini düzenle (web)", systemImage: "safari")
                            .font(.footnote)
                    }
                }
                Section {
                    DisclosureGroup(isExpanded: binding("open")) {
                        charges(r.open.charges, account)
                    } label: {
                        row(title: "Dönem sürüyor", period: r.open.period, total: r.open.total, account: account) {
                            Text("\(DateUtil.display(r.open.period.to, "d MMM")) kesilecek")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Ekstreler") {
                    ForEach(r.statements, id: \.period.to) { s in
                        DisclosureGroup(isExpanded: binding(s.period.to)) {
                            charges(s.charges, account)
                        } label: {
                            row(title: nil, period: s.period, total: s.total, account: account) {
                                HStack(spacing: 6) {
                                    StatusPill(status: s.status)
                                    Text(detail(s, account)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Ekstre")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func binding(_ key: String) -> Binding<Bool> {
        Binding(get: { expanded.contains(key) }, set: { v in
            if v { expanded.insert(key) } else { expanded.remove(key) }
        })
    }

    private func row(title: String?, period: StatementPeriod, total: Double, account: Account,
                     @ViewBuilder sub: () -> some View) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title ?? periodText(period)).font(.subheadline.weight(.semibold))
                if title != nil { Text(periodText(period)).font(.caption).foregroundStyle(.secondary) }
                sub()
            }
            Spacer()
            Text(Fmt.currency(total, account.currency)).font(.body.monospacedDigit().weight(.semibold))
        }
        .padding(.vertical, 2)
    }

    private func detail(_ s: CardStatement, _ a: Account) -> String {
        var parts: [String] = []
        if let d = s.dueDate { parts.append("son ödeme \(DateUtil.display(d, "d MMM"))") }
        if let m = s.minPayment, s.total > 0 { parts.append("asgari \(Fmt.whole(m, a.currency))") }
        if s.paid > 0 { parts.append("ödenen \(Fmt.whole(s.paid, a.currency))") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func charges(_ txs: [Transaction], _ a: Account) -> some View {
        if txs.isEmpty {
            Text("Bu dönemde harcama yok.").font(.caption).foregroundStyle(.secondary)
        }
        ForEach(txs) { t in
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label(t)).font(.subheadline).lineLimit(1)
                    Text(DateUtil.display(t.date, "d MMM")).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer()
                Text(t.type == .income ? "−" + Fmt.currency(t.amount, t.currency) : Fmt.currency(t.amount, t.currency))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(t.type == .income ? Theme.income : .primary)
            }
        }
    }

    private func label(_ t: Transaction) -> String {
        let base = t.description.isEmpty ? (model.category(t.categoryId)?.name ?? t.type.label) : t.description
        if let i = t.installIndex, let n = t.installTotal { return "\(base) (\(i)/\(n))" }
        return base
    }

    private func cycleText(_ d: CardDays) -> String {
        let closing = d.statementDay.map { "Kesim her ayın \($0)'i" } ?? "Kesim ay sonu"
        let due: String
        if let g = d.gapDays, d.statementDay != nil { due = "son ödeme kesimden \(g) gün sonra" }
        else if let day = d.dueDay { due = "son ödeme her ayın \(day)'i" }
        else { due = "son ödeme günü girilmemiş" }
        return "\(closing) · \(due). Tutarlar uygulamadaki işlemlerden hesaplanır."
    }
}
