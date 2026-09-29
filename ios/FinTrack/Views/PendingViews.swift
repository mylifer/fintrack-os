import SwiftUI
import FinTrackCore
import FinTrackData

/// Özet'in en üstünde: tarihi gelmiş onay bekleyen işlemler ve vadesi gelen
/// tekrarlayanlar (web bildirim merkezi). Onay yoksa görünmez.
struct PendingCard: View {
    @Environment(AppModel.self) private var model
    @Binding var editing: Transaction?
    var openRecurring: () -> Void
    @State private var busy: Set<String> = []
    @State private var errorMessage: String?
    @State private var rejecting: Transaction?

    var body: some View {
        let txs = model.dueApprovals
        let recs = model.dueRecurring
        if !txs.isEmpty || !recs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "bell.badge.fill").foregroundStyle(Theme.warning)
                    Text("Onay bekliyor").font(.headline)
                    Spacer()
                    Text("\(txs.count + recs.count)")
                        .font(.caption.bold().monospacedDigit())
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Theme.warning.opacity(0.18), in: Capsule())
                }
                ForEach(recs) { r in
                    recurringRow(r)
                    Divider()
                }
                ForEach(txs) { t in
                    txRow(t)
                    if t.id != txs.last?.id { Divider() }
                }
                Text("Onaylanan işlem tarihinde bakiyeye girer.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .alert("İşlem yapılamadı", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("İşlem reddedilsin mi?", isPresented: Binding(
                get: { rejecting != nil }, set: { if !$0 { rejecting = nil } }
            ), titleVisibility: .visible, presenting: rejecting) { t in
                Button("Reddet ve sil", role: .destructive) { run(t.id) { try await model.delete(t) } }
            } message: { t in
                Text("\(t.description.isEmpty ? t.type.label : t.description) silinir.")
            }
        }
    }

    private func txRow(_ t: Transaction) -> some View {
        HStack(spacing: 8) {
            Button { editing = t } label: { TransactionRow(t: t) }
                .buttonStyle(.plain)
            approveButton(id: t.id) { try await model.approve(t) }
        }
        .contextMenu {
            Button { run(t.id) { try await model.approve(t) } } label: { Label("Onayla", systemImage: "checkmark") }
            Button { editing = t } label: { Label(t.isLinked ? "Görüntüle" : "Düzenle", systemImage: "pencil") }
            if !t.isLinked {
                Button(role: .destructive) { rejecting = t } label: { Label("Reddet", systemImage: "xmark") }
            }
        }
    }

    private func recurringRow(_ r: RecurringTransaction) -> some View {
        let missed = Recurrence.occurrences(r, asOf: DateUtil.today()).count
        return HStack(spacing: 8) {
            Button(action: openRecurring) {
                HStack(spacing: 12) {
                    RecurringIcon(r: r)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.name).lineLimit(1)
                        Text(missed > 1 ? "\(missed) dönem birikti · \(DateUtil.display(r.nextDueDate, "d MMM")) itibarıyla"
                                        : "Tekrarlayan · \(DateUtil.display(r.nextDueDate, "d MMM"))")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Text(r.signedAmountText)
                        .font(.subheadline.monospacedDigit().weight(.semibold))
                        .foregroundStyle(r.type == .income ? Theme.income : .primary)
                }
            }
            .buttonStyle(.plain)
            approveButton(id: r.id) { try await model.approveRecurring(r) }
        }
        .contextMenu {
            Button { run(r.id) { try await model.approveRecurring(r) } } label: { Label("Kaydet", systemImage: "checkmark") }
            Button { run(r.id) { try await model.skipRecurring(r) } } label: { Label("Bu dönemi atla", systemImage: "forward") }
        }
    }

    private func approveButton(id: String, _ action: @escaping () async throws -> Void) -> some View {
        Button { run(id, action) } label: {
            Group {
                if busy.contains(id) { ProgressView().controlSize(.small) }
                else { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
            }
            .frame(width: 32, height: 32)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.accent, in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(busy.contains(id))
        .accessibilityLabel("Onayla")
    }

    private func run(_ id: String, _ action: @escaping () async throws -> Void) {
        busy.insert(id)
        Task {
            do {
                try await action()
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy.remove(id)
        }
    }
}

/// Tekrarlayan şablonun ikonu: kategori rengi + dönüş işareti.
struct RecurringIcon: View {
    @Environment(AppModel.self) private var model
    let r: RecurringTransaction
    var size: CGFloat = 36

    var body: some View {
        if r.type == .transfer {
            IconBadge(symbol: "arrow.left.arrow.right", color: .secondary, size: size)
        } else if let c = model.category(r.categoryId) {
            let i = Icons.category(c.icon)
            IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color), size: size)
        } else {
            IconBadge(symbol: "arrow.triangle.2.circlepath", color: .gray, size: size)
        }
    }
}

extension RecurringTransaction {
    /// Gelir +, gider −, transfer işaretsiz (işlem satırlarıyla aynı).
    var signedAmountText: String {
        switch type {
        case .income: Fmt.signed(amount, currency)
        case .expense: Fmt.signed(-amount, currency)
        case .transfer: Fmt.currency(amount, currency)
        }
    }
}

/// Önümüzdeki 7 gün: tekrarlayanlar, planlı işlemler, kart son ödemeleri.
struct UpcomingCard: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @Binding var editing: Transaction?

    var body: some View {
        let items = model.upcoming()
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Yaklaşanlar").font(.headline)
                    Spacer()
                    Text("7 gün").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(items.prefix(5)) { item in
                    Button { open(item) } label: { row(item) }
                        .buttonStyle(.plain)
                    if item.id != items.prefix(5).last?.id { Divider() }
                }
                if items.count > 5 {
                    Text("+\(items.count - 5) daha").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func row(_ u: AppModel.Upcoming) -> some View {
        HStack(spacing: 12) {
            VStack(spacing: 0) {
                Text(DateUtil.display(u.date, "d")).font(.headline.monospacedDigit())
                Text(DateUtil.display(u.date, "MMM")).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(u.title).lineLimit(1)
                Text(kindLabel(u)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(amountText(u))
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(u.type == .income ? Theme.income : .primary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func kindLabel(_ u: AppModel.Upcoming) -> String {
        let days = daysUntil(u.date)
        let when = days == 1 ? "yarın" : "\(days) gün sonra"
        switch u.kind {
        case .recurring: return "Tekrarlayan · \(when)"
        case .planned: return "Planlı · \(when)"
        case .cardDue: return days == 0 ? "Kart ekstresi · bugün" : "Kart ekstresi · \(when)"
        }
    }

    private func amountText(_ u: AppModel.Upcoming) -> String {
        switch u.type {
        case .income: Fmt.signed(u.amount, u.currency)
        case .expense: Fmt.signed(-u.amount, u.currency)
        case .transfer: Fmt.currency(u.amount, u.currency)
        }
    }

    private func daysUntil(_ d: String) -> Int {
        guard let a = DateUtil.parseDay(DateUtil.today()), let b = DateUtil.parseDay(d) else { return 0 }
        return DateUtil.calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    private func open(_ u: AppModel.Upcoming) {
        switch u.kind {
        case .recurring: router.openPlan(.recurring)
        case .planned: editing = model.transactions.first { $0.id == u.refId }
        case .cardDue: router.tab = .accounts
        }
    }
}
