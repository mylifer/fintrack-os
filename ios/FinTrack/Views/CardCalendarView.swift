import SwiftUI
import FinTrackCore
import FinTrackData

/// Kart Takvimi (web /kart-takvimi): her kartın kesim günü, kesim → son ödeme
/// farkı, son ödeme günü, asgari oran ve tatil kuralı; önümüzdeki aylarda
/// kesim / son ödeme tarihleri (aya özel değiştirilebilir) ve ekstre tutarı.
struct CardCalendarView: View {
    @Environment(AppModel.self) private var model
    private var cards: [Account] { model.activeAccounts.filter { $0.type == .credit_card } }

    var body: some View {
        List {
            if cards.isEmpty {
                ContentUnavailableView("Kredi kartı yok", systemImage: "creditcard")
            }
            ForEach(cards) { card in
                NavigationLink { CardCalendarDetail(accountId: card.id) } label: {
                    let d = model.cardDays(card)
                    HStack(spacing: 12) {
                        IconBadge(symbol: "creditcard", color: Color(hex: card.color), size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(card.name)
                            Text(summary(d)).font(.caption).foregroundStyle(d.dueDay == nil ? Theme.warning : .secondary)
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Kart Takvimi")
    }

    private func summary(_ d: CardDays) -> String {
        let kesim = d.statementDay.map { "Kesim \($0)" } ?? "Kesim girilmedi"
        let son = d.dueDay.map { "son ödeme \($0)" } ?? "son ödeme girilmedi"
        return "\(kesim) · \(son)"
    }
}

struct CardCalendarDetail: View {
    @Environment(AppModel.self) private var model
    let accountId: String
    @State private var errorMessage: String?

    private var card: Account? { model.account(accountId) }

    var body: some View {
        if let card {
            let resolved = BankRules.resolveCardDays(account: card, plan: CardStatements.plan(for: card, in: model.paymentPlans))
            let days = resolved.days
            let ovs = CardStatements.overrides(for: card, in: model.paymentOccurrences)
            let statements = model.cardStatements(card, count: 12)
            let thisMonth = String(DateUtil.today().prefix(7))
            let cycles = CardCycles.cardCycles(days, overrides: ovs, from: CardCycles.shiftMonthKey(thisMonth, -1),
                                               to: CardCycles.shiftMonthKey(thisMonth, 5))
            List {
                Section {
                    Picker("Kesim günü", selection: Binding(get: { card.statementDay ?? 0 },
                                                            set: { v in run { try await model.setCardStatementDay(card, v == 0 ? nil : v) } })) {
                        Text("Girilmedi").tag(0)
                        ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                    }
                    Picker("Kesim → son ödeme", selection: Binding(get: { days.gapDays ?? 0 },
                                                                    set: { v in run { try await model.setCardGap(card, v == 0 ? nil : v) } })) {
                        Text("Sabit gün").tag(0)
                        ForEach(BankRules.minGap...BankRules.maxGap, id: \.self) { Text("\($0) gün").tag($0) }
                    }
                    Picker("Son ödeme günü", selection: Binding(get: { days.dueDay ?? 0 },
                                                                set: { v in run { try await model.setCardDueDay(card, v == 0 ? nil : v) } })) {
                        Text("Girilmedi").tag(0)
                        ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                    }
                    .disabled(days.gapDays != nil && card.statementDay != nil)
                    Picker("Tatil / hafta sonu", selection: Binding(get: { days.holidayRule ?? .due },
                                                                    set: { r in run { try await model.setCardHolidayRule(card, r) } })) {
                        Text("Son ödeme ilk iş gününe kayar").tag(HolidayRule.due)
                        Text("Kesim de kayar (fark sabit)").tag(HolidayRule.both)
                    }
                    MinPctField(card: card) { v in run { try await model.setCardMinPct(card, v) } }
                } header: {
                    Text(card.name)
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(resolved.rule.label): \(resolved.rule.note)")
                        if let inc = resolved.inconsistent {
                            Text("Son ödeme kesimden \(inc.gap) gün sonra görünüyor — yasal en az 10 gün.")
                                .foregroundStyle(Theme.warning)
                            HStack {
                                Button("Son ödeme \(inc.suggestDue) olsun") { run { try await model.setCardStatementDay(card, card.statementDay) } }
                                Button("Kesim \(inc.suggestClosing) olsun") { run { try await model.setCardStatementDay(card, inc.suggestClosing) } }
                            }
                            .buttonStyle(.bordered).font(.caption)
                        }
                    }
                }

                Section {
                    ForEach(cycles, id: \.month) { c in
                        CycleRow(card: card, cycle: c,
                                 statement: statements.statements.first { $0.period.to == c.closing },
                                 openTotal: statements.open.period.to == c.closing ? statements.open.total : nil) { closing, due in
                            run { try await model.setCardCycleDate(card, month: c.month, closing: closing, due: due) }
                        }
                    }
                } header: {
                    Text("Aylar")
                } footer: {
                    Text("Bankanız bir ayın tarihini kaydırdıysa tarihe dokunup değiştirin; yalnız o ay değişir. Varsayılana döndürmek için aynı güne geri alın.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Kart Takvimi")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func run(_ op: @escaping () async throws -> Void) {
        Task {
            do { try await op() } catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct CycleRow: View {
    let card: Account
    let cycle: CardCycle
    let statement: CardStatement?
    let openTotal: Double?
    var onChange: (String?, String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(DateUtil.display(cycle.month + "-01", "MMMM yyyy")).font(.subheadline.bold())
                Spacer()
                if let s = statement {
                    Text("\(Fmt.currency(s.total, card.currency)) · \(s.status.label)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                } else if let t = openTotal {
                    Text("Dönem sürüyor · \(Fmt.currency(t, card.currency))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            dateRow("Kesim", cycle.closing, custom: cycle.closingCustom, shifted: cycle.closingShifted) { onChange($0, nil) }
            if let due = cycle.dueDate {
                dateRow("Son ödeme", due, custom: cycle.dueCustom, shifted: cycle.dueShifted) { onChange(nil, $0) }
            }
            if cycle.invalid {
                Text("Kesim, son ödemeden önce olmalı").font(.caption2).foregroundStyle(Theme.expense)
            }
        }
        .padding(.vertical, 2)
    }

    private func dateRow(_ title: String, _ iso: String, custom: Bool, shifted: Bool, set: @escaping (String) -> Void) -> some View {
        HStack {
            Text(title).font(.caption).foregroundStyle(.secondary).frame(width: 74, alignment: .leading)
            DatePicker("", selection: Binding(get: { DateUtil.parseDay(iso) ?? Date() },
                                              set: { set(DateUtil.day($0)) }),
                       displayedComponents: .date)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "tr_TR"))
            if custom { Text("özel").font(.caption2.bold()).foregroundStyle(Theme.planned) }
            else if shifted { Text("tatil kaydı").font(.caption2).foregroundStyle(.secondary) }
        }
    }
}

/// Asgari ödeme oranı: yazarken değil, alan bırakılınca kaydedilir
private struct MinPctField: View {
    let card: Account
    var onCommit: (Double?) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack {
            Text("Asgari ödeme %")
            Spacer()
            TextField("örn. 20", text: $text)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 80)
                .focused($focused)
        }
        .onAppear { text = card.minPayPct.map { $0 != 0 && $0 != 3 ? Fmt.amountInput($0) : "" } ?? "" }
        .onChange(of: focused) { _, f in
            guard !f else { return }
            let v = Fmt.parseAmount(text)
            let old = card.minPayPct.flatMap { $0 != 0 && $0 != 3 ? $0 : nil }
            if (v > 0 ? v : nil) != old { onCommit(v > 0 ? v : nil) }
        }
    }
}
