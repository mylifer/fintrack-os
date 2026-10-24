import SwiftUI
import FinTrackCore
import FinTrackData

/// Borç satırı: kalan tutar ve ilerleme. Ödeme kaydı web'de (bağlı işlem + taksit sayacı).
struct DebtRow: View {
    let debt: Debt

    private var overdue: Bool {
        guard !debt.isSettled, let due = debt.dueDate else { return false }
        return String(due.prefix(10)) < DateUtil.today()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                IconBadge(symbol: debt.owe ? "arrow.up.right" : "arrow.down.left",
                          color: debt.owe ? Theme.expense : Theme.income, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(debt.name).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(overdue ? Theme.expense : .secondary).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Fmt.currency(debt.remaining))
                        .font(.body.monospacedDigit().weight(.semibold))
                    Text("kalan").font(.caption2).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: debt.progress, total: 100)
                .tint(debt.owe ? Theme.accent : Theme.income)
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var parts: [String] = []
        if let c = debt.counterparty, !c.isEmpty { parts.append(c) }
        if let m = debt.monthlyPayment, m > 0 { parts.append("aylık \(Fmt.currency(m))") }
        if let due = debt.dueDate {
            parts.append(overdue ? "gecikti · \(DateUtil.display(due, "d MMM"))" : "vade \(DateUtil.display(due, "d MMM"))")
        }
        return parts.isEmpty ? debt.typeLabel : parts.joined(separator: " · ")
    }
}

struct DebtDetailView: View {
    @Environment(AppModel.self) private var model
    let debt: Debt
    @State private var paying = false
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?
    @State private var showPlan = false

    /// Güncel hali (ödeme sonrası)
    private var d: Debt { model.debts.first { $0.id == debt.id } ?? debt }

    /// Bu borca bağlı ödemeler (debtId), yeni → eski
    private var payments: [Transaction] {
        model.transactions.filter { $0.debtId == debt.id }
    }

    var body: some View {
        let d = self.d
        let plan = d.paymentPlan()
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(d.owe ? "Kalan borç" : "Kalan alacak").font(.subheadline).foregroundStyle(.secondary)
                    Text(Fmt.currency(d.remaining)).font(.system(size: 30, weight: .bold).monospacedDigit())
                        .contentTransition(.numericText())
                    ProgressView(value: d.progress, total: 100).tint(d.owe ? Theme.accent : Theme.income)
                    Text("\(Fmt.currency(d.paidAmount)) / \(Fmt.currency(d.totalAmount)) ödendi · %\(d.progress.rounded().safeInt)")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            if d.owe && !d.isSettled {
                Section {
                    Button { paying = true } label: {
                        Label("Ödeme yap", systemImage: "arrow.up.right.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .foregroundStyle(Theme.onAccent)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                LabeledContent("Tür", value: d.typeLabel)
                if let c = d.counterparty, !c.isEmpty { LabeledContent("Karşı taraf", value: c) }
                if let m = d.monthlyPayment, m > 0 { LabeledContent("Aylık ödeme", value: Fmt.currency(m)) }
                if !plan.isEmpty {
                    LabeledContent("Taksit", value: "\(plan.filter { $0.status == .paid }.count) / \(plan.count) ödendi")
                }
                if let r = d.interestRate, r > 0 {
                    LabeledContent("Yıllık faiz", value: "%\(String(format: "%.2f", r).replacingOccurrences(of: ".", with: ","))")
                }
                if !d.startDate.isEmpty { LabeledContent("Başlangıç", value: DateUtil.display(d.startDate)) }
                if let due = d.dueDate { LabeledContent("Vade", value: DateUtil.display(due)) }
                if let a = model.account(d.accountId) { LabeledContent("Ödeme hesabı", value: a.name) }
                if d.isSettled { LabeledContent("Durum", value: "Kapandı") }
            }
            if !plan.isEmpty {
                Section {
                    DisclosureGroup("Taksit planı", isExpanded: $showPlan) {
                        ForEach(plan, id: \.index) { row in
                            HStack {
                                Text("\(row.index).").monospacedDigit().foregroundStyle(.secondary).frame(width: 28, alignment: .leading)
                                Text(DateUtil.display(row.date))
                                Spacer()
                                Text(Fmt.currency(row.amount)).monospacedDigit()
                                planBadge(row.status)
                            }
                            .font(.subheadline)
                        }
                    }
                }
            }
            if let n = d.notes, !n.isEmpty {
                Section("Not") { Text(n) }
            }
            if !payments.isEmpty {
                Section {
                    ForEach(payments) { t in
                        Button { editing = t } label: { TransactionRow(t: t) }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if t.canDeleteOnIOS {
                                    Button(role: .destructive) { pendingDelete = t } label: { Label("Sil", systemImage: "trash") }
                                }
                            }
                    }
                } header: {
                    Text("Ödemeler")
                } footer: {
                    Text("Silinen ödeme borcun ödenen tutarından da düşülür.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(d.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $paying) { DebtPaySheet(debt: d) }
        .sheet(item: $editing) { TransactionFormView(editing: $0) }
        .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }

    private func planBadge(_ s: Debt.PlanStatus) -> some View {
        let (text, color): (String, Color) = switch s {
        case .paid: ("Ödendi", Theme.income)
        case .partial: ("Kısmi", Theme.warning)
        case .overdue: ("Gecikti", Theme.expense)
        case .pending: ("Bekliyor", .secondary)
        }
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 6).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

/// Borç ödemesi (web "Ödeme Yap"): tutar sıradaki taksit, hesap borcun hesabı.
struct DebtPaySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let debt: Debt

    @State private var amountText = ""
    @State private var accountId: String?
    @State private var date = Date()
    @State private var paymentId = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private var account: Account? { model.account(accountId) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(account?.currency.symbol ?? "₺").font(.system(size: 26, weight: .semibold)).foregroundStyle(.secondary)
                        TextField("0", text: $amountText)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 36, weight: .bold).monospacedDigit())
                            .focused($focused)
                            .onChange(of: amountText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { amountText = fixed }
                            }
                    }
                } footer: {
                    if let a = account, a.currency != .TRY {
                        Text("Tutar \(a.currency.rawValue) cinsinden; borca güncel kurla TL olarak yazılır.")
                    } else {
                        Text("Kalan \(Fmt.currency(debt.remaining)).")
                    }
                }
                Section {
                    Picker("Hesap", selection: $accountId) {
                        Text("Seçin").tag(String?.none)
                        ForEach(model.activeAccounts) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                    }
                    DatePicker("Tarih", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                } footer: {
                    Text("Hesaptan \"\(debt.name) ödemesi\" olarak düşülür\(DateUtil.day(date) > DateUtil.today() ? "; gelecek tarihli ödeme onay bekler" : "").")
                }
            }
            .disabled(busy)
            .navigationTitle("Ödeme yap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Öde", action: pay).bold().disabled(Fmt.parseAmount(amountText) <= 0 || accountId == nil)
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            amountText = Fmt.amountInput(debt.nextInstallmentAmount())
            let accounts = model.activeAccounts
            accountId = accounts.first { $0.id == debt.accountId }?.id ?? accounts.first?.id
            focused = true
        }
    }

    private func pay() {
        busy = true
        Task {
            do {
                try await model.payDebt(debt, accountId: accountId, amount: Fmt.parseAmount(amountText), date: date, id: paymentId)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
