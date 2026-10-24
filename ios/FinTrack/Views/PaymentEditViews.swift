import SwiftUI
import FinTrackCore
import FinTrackData

/// Ödeme satırını düzenle (web PaymentEditModal): tutar, son ödeme tarihi,
/// ödeme hesabı ve not — yalnız bu ay ya da bu ve sonraki aylar için.
struct PaymentEditSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let row: PaymentRow

    @State private var amountText = ""
    @State private var dueDate = Date()
    @State private var fromAccountId: String?
    @State private var note = ""
    @State private var scope: PaymentEdits.Scope = .month
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Tutar")
                        Spacer()
                        TextField(row.target.defaultAmount.map { Fmt.amountInput($0) } ?? "girilmedi", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .onChange(of: amountText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { amountText = fixed }
                            }
                        Text(row.target.currency.symbol).foregroundStyle(.secondary)
                    }
                    DatePicker(row.target.kind == .card ? "Son ödeme" : "Ödeme günü", selection: $dueDate, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                    Picker("Ödeme hesabı", selection: $fromAccountId) {
                        Text("Seçilmedi").tag(String?.none)
                        ForEach(model.activeAccounts.filter { $0.id != row.target.id }) {
                            Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id))
                        }
                    }
                    TextField("Not", text: $note)
                } header: {
                    Text("\(row.target.name) · \(DateUtil.display(row.dueDate, "MMMM yyyy"))")
                } footer: {
                    Text("Tutar boş bırakılırsa \(row.target.defaultAmount != nil ? "planın tutarı" : "tutar girilmemiş") sayılır.")
                }
                Section {
                    Picker("Uygula", selection: $scope) {
                        Text("Yalnız bu ay").tag(PaymentEdits.Scope.month)
                        Text("Bu ve sonraki aylar").tag(PaymentEdits.Scope.forward)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } footer: {
                    Text(scope == .forward
                         ? "Planın varsayılanı olur; önceki aylar eski değerleriyle korunur."
                         : "Yalnız bu ayın kaydı değişir.")
                }
            }
            .disabled(busy)
            .navigationTitle("Ödemeyi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Kaydet", action: save).bold() }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.large])
        .onAppear {
            // Elle girilmiş tutar varsa o; yoksa boş (= varsayılan)
            if row.custom.amount, let a = row.amount { amountText = Fmt.amountInput(a) }
            else if row.target.defaultAmount == nil, let a = row.amount { amountText = Fmt.amountInput(a) }
            dueDate = DateUtil.parseDay(row.dueDate) ?? Date()
            fromAccountId = row.fromAccountId
            note = row.note ?? ""
        }
    }

    private func save() {
        let t = amountText.trimmingCharacters(in: .whitespaces)
        let amount: Double? = t.isEmpty ? nil : Money.round(Fmt.parseAmount(t))
        if let amount, amount < 0 { errorMessage = "Geçerli bir tutar girin."; return }
        busy = true
        Task {
            do {
                try await model.saveRowEdit(row, values: .init(amount: amount, fromAccountId: fromAccountId,
                                                              dueDate: DateUtil.day(dueDate), note: note), scope: scope)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}

/// Hedefin (kart / borç) takip ayarları (web PlanSettingsModal): ödeme günü,
/// varsayılan tutar ve hesap, başlangıç ayı, takipte mi, not.
struct PlanSettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let target: PaymentTarget

    @State private var isActive = true
    @State private var dayText = ""
    @State private var amountText = ""
    @State private var fromAccountId: String?
    @State private var startMonth = Date()
    @State private var notes = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var isCard: Bool { target.kind == .card }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Takipte", isOn: $isActive)
                } footer: {
                    if target.needsSetup {
                        Text("Ödeme günü girilmedi. Ekstrendeki son ödeme gününü girin; gün girilene kadar bu kart listeye ve uyarılara katılmaz.")
                            .foregroundStyle(Theme.warning)
                    } else if !isActive {
                        Text("Takipten çıkarılınca bu \(isCard ? "kart" : "borç") hiçbir görünümde çıkmaz. Aylık kayıtlar silinmez.")
                    } else {
                        Text("\(isCard ? "Uygulamadaki bakiye" : "Kalan") \(Fmt.currency(target.outstanding, target.currency)).")
                    }
                }
                Section {
                    HStack {
                        Text(isCard ? "Son ödeme günü" : "Ödeme günü")
                        Spacer()
                        TextField("örn. 15", text: $dayText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                            .frame(width: 70)
                    }
                    HStack {
                        Text("Aylık tutar")
                        Spacer()
                        TextField(isCard ? "her ay girilir" : "isteğe bağlı", text: $amountText)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                        Text(target.currency.symbol).foregroundStyle(.secondary)
                    }
                    Picker("Varsayılan ödeme hesabı", selection: $fromAccountId) {
                        Text("Seçilmedi").tag(String?.none)
                        ForEach(model.activeAccounts.filter { $0.id != target.id }) {
                            Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id))
                        }
                    }
                    DatePicker("Takip başlangıcı", selection: $startMonth, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                    TextField("Not", text: $notes)
                } footer: {
                    Text("Kısa aylarda ayın son günü kullanılır. Değişiklik bu aydan itibaren geçerli; önceki aylar korunur.")
                }
            }
            .disabled(busy)
            .navigationTitle(target.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Kaydet", action: save).bold() }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .onAppear {
            isActive = target.isActive
            dayText = target.dayOfMonth.map(String.init) ?? ""
            amountText = target.plan?.amount.map(Fmt.amountInput) ?? ""
            fromAccountId = target.defaultFromAccountId
            startMonth = DateUtil.parseDay(target.startMonth + "-01") ?? Date()
            notes = target.plan?.notes ?? ""
        }
    }

    private func save() {
        guard let day = Int(dayText.trimmingCharacters(in: .whitespaces)), (1...31).contains(day) else {
            errorMessage = isCard ? "Kartın son ödeme gününü 1 ile 31 arasında girin." : "Ödeme günü 1 ile 31 arasında olmalı."
            return
        }
        let t = amountText.trimmingCharacters(in: .whitespaces)
        let amount: Double? = t.isEmpty ? nil : Money.round(Fmt.parseAmount(t))
        if let amount, amount < 0 { errorMessage = "Geçerli bir tutar girin."; return }
        busy = true
        Task {
            do {
                try await model.savePlanSettings(target, values: .init(
                    amount: amount, fromAccountId: fromAccountId, dayOfMonth: day,
                    startMonth: String(DateUtil.day(startMonth).prefix(7)), isActive: isActive, notes: notes))
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
