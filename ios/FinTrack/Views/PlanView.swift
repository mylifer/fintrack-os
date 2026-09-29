import SwiftUI
import FinTrackCore
import FinTrackData

enum PlanSection: String, CaseIterable {
    case budgets, goals, recurring

    var label: String {
        switch self {
        case .budgets: "Bütçeler"
        case .goals: "Hedefler"
        case .recurring: "Tekrarlayan"
        }
    }
}

/// Plan sekmesi: bütçeler, birikim hedefleri, tekrarlayan işlemler.
struct PlanView: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    @State private var month = MonthYear.current()
    @State private var newGoal = false

    var body: some View {
        @Bindable var router = router
        NavigationStack {
            Group {
                switch router.planSection {
                case .budgets: BudgetsContent(month: $month)
                case .goals: GoalsContent()
                case .recurring: RecurringContent()
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Bölüm", selection: $router.planSection) {
                    ForEach(PlanSection.allCases, id: \.self) { s in
                        Text(badged(s)).tag(s)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)
            }
            .refreshable { await model.refresh() }
            .navigationTitle("Plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if router.planSection == .goals {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { newGoal = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("Hedef ekle")
                    }
                }
            }
            .navigationDestination(for: Budget.self) { BudgetDetailView(budget: $0, month: month) }
            .navigationDestination(for: RecurringTransaction.self) { RecurringDetailView(template: $0) }
            .sheet(isPresented: $newGoal) { GoalFormView(editing: nil) }
        }
    }

    private func badged(_ s: PlanSection) -> String {
        if s == .recurring, !model.dueRecurring.isEmpty { return "\(s.label) (\(model.dueRecurring.count))" }
        return s.label
    }
}

// MARK: - Hedefler

struct GoalsContent: View {
    @Environment(AppModel.self) private var model
    @State private var editing: SavingsGoal?
    @State private var adjusting: SavingsGoal?

    private var sorted: [SavingsGoal] { Goals.sorted(model.goals, progress: model.goalProgress) }

    var body: some View {
        List {
            if !model.goals.isEmpty {
                Section { summary }
            }
            ForEach(sorted) { g in
                Section {
                    GoalCard(goal: g, progress: model.goalProgress(g),
                             onAdjust: model.goalProgress(g).linkedAccountId == nil ? { adjusting = g } : nil)
                        .contentShape(Rectangle())
                        .onTapGesture { editing = g }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(12)
        .overlay {
            if model.goals.isEmpty {
                ContentUnavailableView {
                    Label("Henüz birikim hedefin yok", systemImage: "target")
                } description: {
                    Text("Tatil, araba, acil durum fonu… Hedefini ve tarihini gir; ayda ne kadar biriktirmen gerektiğini hesaplayalım.")
                }
            }
        }
        .sheet(item: $editing) { GoalFormView(editing: $0) }
        .sheet(item: $adjusting) { GoalAdjustSheet(goal: $0) }
    }

    private var summary: some View {
        let ps = model.goals.map(model.goalProgress)
        let saved = Money.sum(ps) { $0.current }
        let target = Money.sum(model.goals) { $0.targetAmount }
        let monthly = Money.sum(ps.filter { !$0.done }) { $0.monthlyNeeded ?? 0 }
        return HStack(spacing: 0) {
            tile("Biriken", Fmt.whole(saved))
            Divider().frame(height: 32)
            tile("Toplam hedef", Fmt.whole(target))
            Divider().frame(height: 32)
            tile("Ayda gereken", Fmt.whole(monthly))
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
}

struct GoalCard: View {
    @Environment(AppModel.self) private var model
    let goal: SavingsGoal
    let progress: Goals.Progress
    var onAdjust: (() -> Void)?

    var body: some View {
        let color = Color(hex: goal.color)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle().fill(color).frame(width: 10, height: 10)
                Text(goal.name).font(.headline).lineLimit(1)
                Spacer()
                if progress.done {
                    badge("Tamamlandı", Theme.income)
                } else if progress.overdue {
                    badge("Süre doldu", Theme.expense)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(Fmt.currency(progress.current))
                    .font(.title3.bold().monospacedDigit())
                Text("/ \(Fmt.currency(goal.targetAmount))")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                Text("%\(Int(progress.percent.rounded()))")
                    .font(.subheadline.bold().monospacedDigit()).foregroundStyle(color)
            }
            ProgressView(value: progress.percent, total: 100).tint(color)
            Text(status).font(.caption).foregroundStyle(progress.overdue ? Theme.expense : .secondary)
            HStack {
                Text(source).font(.caption2).foregroundStyle(.tertiary)
                Spacer()
                if let onAdjust {
                    Button("Ekle / Çıkar", action: onAdjust)
                        .font(.caption.bold())
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private var status: String {
        let p = progress
        if p.done { return "Hedefe ulaşıldı." }
        if p.overdue, let d = goal.targetDate {
            return "Hedef tarihi (\(DateUtil.display(d))) geçti — \(Fmt.currency(p.remaining)) eksik."
        }
        if let m = p.monthlyNeeded, let d = goal.targetDate, let left = p.monthsLeft {
            return "\(DateUtil.display(d)) için ayda \(Fmt.currency(m)) biriktirmelisin (\(left) ay, \(Fmt.currency(p.remaining)) kaldı)."
        }
        return "\(Fmt.currency(p.remaining)) kaldı · hedef tarihi yok."
    }

    private var source: String {
        if let id = progress.linkedAccountId, let a = model.account(id) { return "İlerleme: \(a.name) bakiyesi" }
        return "Elle takip ediliyor"
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption2.bold())
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

/// Elle takip edilen hedefe tutar ekle / çıkar (işlem oluşturmaz — web ile aynı).
struct GoalAdjustSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let goal: SavingsGoal
    @State private var text = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("₺").font(.system(size: 26, weight: .semibold)).foregroundStyle(.secondary)
                        TextField("0", text: $text)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 36, weight: .bold).monospacedDigit())
                            .focused($focused)
                    }
                } footer: {
                    Text("Şu an \(Fmt.currency(goal.savedAmount ?? 0)). Bu yalnız hedefin sayacını değiştirir; hesaplarına işlem yazılmaz.")
                }
                Section {
                    Button { apply(1) } label: { Label("Ekle", systemImage: "plus.circle.fill") }
                    Button(role: .destructive) { apply(-1) } label: { Label("Çıkar", systemImage: "minus.circle.fill") }
                }
                .disabled(Fmt.parseAmount(text) <= 0 || busy)
            }
            .navigationTitle(goal.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } } }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private func apply(_ sign: Double) {
        busy = true
        Task {
            do {
                try await model.adjustGoal(goal, by: sign * Fmt.parseAmount(text))
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}

/// Hedef ekle / düzenle (web GoalFormModal alanları).
struct GoalFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: SavingsGoal?

    @State private var name = ""
    @State private var amountText = ""
    @State private var hasDate = false
    @State private var date = Calendar.current.date(byAdding: .month, value: 6, to: Date()) ?? Date()
    @State private var accountId: String?
    @State private var savedText = ""
    @State private var color = SavingsGoal.colors[0]
    @State private var notes = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && Fmt.parseAmount(amountText) > 0
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Hedef adı (ör. Tatil)", text: $name)
                    HStack {
                        Text("Hedef tutar")
                        Spacer()
                        TextField("0", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                        Text("₺").foregroundStyle(.secondary)
                    }
                    Toggle("Hedef tarihi", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("Tarih", selection: $date, in: Date()..., displayedComponents: .date)
                            .environment(\.locale, Locale(identifier: "tr_TR"))
                    }
                }
                Section {
                    Picker("İlerleme", selection: $accountId) {
                        Text("Elle takip et").tag(String?.none)
                        ForEach(pickable) { a in Text("\(a.name) (\(a.currency.rawValue))").tag(Optional(a.id)) }
                    }
                    if accountId == nil {
                        HStack {
                            Text("Şu ana kadar biriken")
                            Spacer()
                            TextField("0", text: $savedText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                            Text("₺").foregroundStyle(.secondary)
                        }
                    }
                } footer: {
                    Text(accountId == nil ? "Biriktirdikçe hedef kartındaki \"Ekle\" ile güncelle."
                                          : "İlerleme bu hesabın bakiyesinden hesaplanır.")
                }
                Section("Renk") {
                    HStack(spacing: 12) {
                        ForEach(SavingsGoal.colors, id: \.self) { c in
                            Button { color = c } label: {
                                Circle().fill(Color(hex: c)).frame(width: 28, height: 28)
                                    .overlay { if c == color { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Renk \(c)")
                            .accessibilityAddTraits(c == color ? .isSelected : [])
                        }
                    }
                }
                Section { TextField("Not", text: $notes, axis: .vertical).lineLimit(1...4) }
                if editing != nil {
                    Section { Button("Hedefi sil", role: .destructive) { confirmDelete = true } }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni hedef" : "Hedefi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Kaydet", action: save).bold().disabled(!valid) }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("Hedef silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: delete)
            }
        }
        .onAppear(perform: setUp)
    }

    /// Arşivlenmemiş hesaplar + şu an bağlı olan (arşivde olsa da).
    private var pickable: [Account] {
        model.accounts.filter { !$0.isArchived || $0.id == editing?.accountId }
    }

    private func setUp() {
        guard let g = editing else {
            color = SavingsGoal.colors[model.goals.count % SavingsGoal.colors.count]
            return
        }
        name = g.name
        amountText = Fmt.amountInput(g.targetAmount)
        if let d = g.targetDate, let parsed = DateUtil.parseDay(d) { hasDate = true; date = parsed }
        accountId = g.accountId
        savedText = g.savedAmount.map(Fmt.amountInput) ?? ""
        color = g.color
        notes = g.notes ?? ""
    }

    private func save() {
        var g = editing ?? SavingsGoal(raw: ["id": .string(UUID().uuidString.lowercased()), "deleted_at": .null])
        g.name = name.trimmingCharacters(in: .whitespaces)
        g.targetAmount = Fmt.parseAmount(amountText)
        g.targetDate = hasDate ? DateUtil.day(date) : nil
        g.accountId = accountId
        // Bağlıyken eski elle girilen tutar korunur (bağ kaldırılınca kaldığı yerden sürer — web)
        g.savedAmount = accountId == nil ? max(0, Fmt.parseAmount(savedText)) : editing?.savedAmount
        g.color = color
        let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        g.notes = n.isEmpty ? nil : n
        busy = true
        Task {
            do {
                try await model.saveGoal(g)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    private func delete() {
        guard let g = editing else { return }
        busy = true
        Task {
            do {
                try await model.deleteGoal(g)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}

// MARK: - Tekrarlayanlar

struct RecurringContent: View {
    @Environment(AppModel.self) private var model
    @State private var busy: Set<String> = []
    @State private var errorMessage: String?

    private var active: [RecurringTransaction] { model.recurring.filter { $0.isActive && !Recurrence.isDue($0) } }
    private var paused: [RecurringTransaction] { model.recurring.filter { !$0.isActive } }

    var body: some View {
        List {
            if !model.recurring.isEmpty {
                Section { monthlyLoad }
            }
            if !model.dueRecurring.isEmpty {
                Section {
                    ForEach(model.dueRecurring) { r in dueRow(r) }
                } header: {
                    Text("Bekleyen")
                } footer: {
                    Text("Kaydet, birikmiş her dönem için işlemi yazar. Atla yalnız bu dönemi geçer.")
                }
            }
            if !active.isEmpty {
                Section("Etkin") {
                    ForEach(active.sorted { $0.nextDueDate < $1.nextDueDate }) { r in
                        NavigationLink(value: r) { RecurringRow(r: r) }
                    }
                }
            }
            if !paused.isEmpty {
                Section("Duraklatılmış") {
                    ForEach(paused) { r in NavigationLink(value: r) { RecurringRow(r: r) } }
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.recurring.isEmpty {
                ContentUnavailableView("Tekrarlayan işlem yok", systemImage: "arrow.triangle.2.circlepath",
                                       description: Text("Kira, maaş, fatura gibi düzenli işlemler web'den tanımlanır; onayı buradan da yapılır."))
            }
        }
        .alert("İşlem yapılamadı", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    /// Etkin şablonların aylığa çevrilmiş toplamı (web forecast sürücü çarpanları).
    private var monthlyLoad: some View {
        let live = model.recurring.filter(\.isActive)
        func monthly(_ r: RecurringTransaction) -> Double {
            let f: Double = switch r.frequency { case .daily: 30.4375; case .weekly: 4.34524; case .monthly: 1; case .yearly: 1.0 / 12 }
            return Money.mul(model.fx.toBaseTry(r.amount, r.currency), f)
        }
        let out = Money.sum(live.filter { $0.type == .expense }, monthly)
        let inc = Money.sum(live.filter { $0.type == .income }, monthly)
        return HStack(spacing: 0) {
            VStack(spacing: 2) {
                Text("Aylık gider").font(.caption).foregroundStyle(.secondary)
                Text(Fmt.whole(out)).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Theme.expense)
            }.frame(maxWidth: .infinity)
            Divider().frame(height: 32)
            VStack(spacing: 2) {
                Text("Aylık gelir").font(.caption).foregroundStyle(.secondary)
                Text(Fmt.whole(inc)).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(Theme.income)
            }.frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }

    private func dueRow(_ r: RecurringTransaction) -> some View {
        let missed = Recurrence.occurrences(r, asOf: DateUtil.today()).count
        return VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: r) { RecurringRow(r: r, subtitleOverride: missed > 1 ? "\(missed) dönem birikti" : nil) }
            HStack(spacing: 10) {
                Button { run(r.id) { try await model.approveRecurring(r) } } label: {
                    Label(missed > 1 ? "\(missed) dönemi kaydet" : "Kaydet", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .foregroundStyle(Theme.onAccent)
                Button { run(r.id) { try await model.skipRecurring(r) } } label: {
                    Text("Atla").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.small)
            .disabled(busy.contains(r.id))
        }
        .padding(.vertical, 2)
    }

    private func run(_ id: String, _ action: @escaping () async throws -> Void) {
        busy.insert(id)
        Task {
            do { try await action(); Haptics.success() } catch { errorMessage = error.localizedDescription }
            busy.remove(id)
        }
    }
}

struct RecurringRow: View {
    @Environment(AppModel.self) private var model
    let r: RecurringTransaction
    var subtitleOverride: String?

    var body: some View {
        HStack(spacing: 12) {
            RecurringIcon(r: r)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name).lineLimit(1)
                Text(subtitleOverride ?? subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(r.signedAmountText)
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(r.type == .income ? Theme.income : .primary)
        }
        .opacity(r.isActive ? 1 : 0.6)
    }

    private var subtitle: String {
        r.isActive ? "\(r.frequency.label) · \(DateUtil.display(r.nextDueDate, "d MMM"))" : r.frequency.label
    }
}

struct RecurringDetailView: View {
    @Environment(AppModel.self) private var model
    let template: RecurringTransaction
    @State private var busy = false
    @State private var errorMessage: String?

    /// Güncel hali (onay/duraklatma sonrası)
    private var r: RecurringTransaction { model.recurring.first { $0.id == template.id } ?? template }

    private var upcoming: [String] {
        guard r.isActive,
              let t = DateUtil.parseDay(DateUtil.today()),
              let h = DateUtil.calendar.date(byAdding: .month, value: 12, to: t) else { return [] }
        return Array(Recurrence.occurrences(r, asOf: DateUtil.day(h)).prefix(6))
    }

    /// Bu şablondan yazılmış işlemler (deterministik kimlikle tanınır)
    private var generated: [Transaction] {
        model.transactions.filter { $0.date <= DateUtil.today() }.filter {
            Recurrence.transactionId(templateId: r.id, date: String($0.date.prefix(10))) == $0.id
        }
        .prefix(12).map { $0 }
    }

    var body: some View {
        List {
            Section {
                LabeledContent("Tutar", value: Fmt.currency(r.amount, r.currency))
                LabeledContent("Sıklık", value: r.frequency.label)
                LabeledContent("Tür", value: r.type.label)
                if let a = model.account(r.accountId) { LabeledContent(r.type == .transfer ? "Kaynak" : "Hesap", value: a.name) }
                if let to = model.account(r.toAccountId) { LabeledContent("Hedef", value: to.name) }
                if let c = model.category(r.categoryId) { LabeledContent("Kategori", value: c.name) }
                LabeledContent("Başlangıç", value: DateUtil.display(r.startDate))
                if let e = r.endDate { LabeledContent("Bitiş", value: DateUtil.display(e)) }
                if let l = r.lastGeneratedDate { LabeledContent("Son kayıt", value: DateUtil.display(l)) }
            }
            Section {
                Toggle("Etkin", isOn: Binding(get: { r.isActive }, set: { v in
                    run { try await model.setRecurringActive(r, v) }
                }))
                if r.isActive {
                    Button("Sıradaki dönemi atla (\(DateUtil.display(r.nextDueDate, "d MMM")))") {
                        run { try await model.skipRecurring(r) }
                    }
                }
            } footer: {
                Text("Duraklatılan şablon yeniden etkinleşince aradaki dönemler onaya düşer.")
            }
            .disabled(busy)
            if !upcoming.isEmpty {
                Section("Sıradaki dönemler") {
                    ForEach(upcoming, id: \.self) { d in
                        HStack {
                            Text(DateUtil.display(d, "d MMMM yyyy, EEEE"))
                            Spacer()
                            if d <= DateUtil.today() { Text("Bekliyor").font(.caption.bold()).foregroundStyle(Theme.warning) }
                        }
                    }
                }
            }
            if !generated.isEmpty {
                Section("Kaydedilenler") {
                    ForEach(generated) { TransactionRow(t: $0) }
                }
            }
            if let n = r.notes, !n.isEmpty { Section("Not") { Text(n) } }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(r.name)
        .navigationBarTitleDisplayMode(.inline)
        .alert("İşlem yapılamadı", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        busy = true
        Task {
            do { try await action(); Haptics.success() } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
