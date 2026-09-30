import SwiftUI
import FinTrackCore
import FinTrackData

/// Tekrarlayan şablon ekle / düzenle (web formunun "Tekrarlayan" sekmesi).
struct RecurringFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: RecurringTransaction?

    @State private var draft = RecurringDraft()
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    private var account: Account? { model.account(draft.accountId) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tür", selection: $draft.type) {
                        ForEach(TransactionType.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField("Ad (ör. Kira)", text: $draft.name)
                    HStack {
                        Text("Tutar")
                        Spacer()
                        TextField("0", text: $draft.amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            .onChange(of: draft.amountText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { draft.amountText = fixed }
                            }
                        Text(account?.currency.symbol ?? "₺").foregroundStyle(.secondary)
                    }
                }
                Section {
                    Picker(draft.type == .transfer ? "Kaynak hesap" : "Hesap", selection: $draft.accountId) {
                        Text("Seçin").tag(String?.none)
                        ForEach(model.activeAccounts) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                    }
                    if draft.type == .transfer {
                        Picker("Hedef hesap", selection: $draft.toAccountId) {
                            Text("Seçin").tag(String?.none)
                            ForEach(model.activeAccounts.filter { $0.id != draft.accountId }) {
                                Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id))
                            }
                        }
                    } else {
                        NavigationLink {
                            CategoryPicker(type: draft.type, selection: $draft.categoryId)
                        } label: {
                            LabeledContent("Kategori", value: model.category(draft.categoryId)?.name ?? "Yok")
                        }
                    }
                }
                Section {
                    Picker("Sıklık", selection: $draft.frequency) {
                        ForEach(RecurringFrequency.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    DatePicker("Başlangıç", selection: $draft.startDate, displayedComponents: .date)
                    Toggle("Bitiş tarihi", isOn: $draft.hasEndDate.animation())
                    if draft.hasEndDate {
                        DatePicker("Bitiş", selection: $draft.endDate, in: draft.startDate..., displayedComponents: .date)
                    }
                } footer: {
                    Text(footer)
                }
                .environment(\.locale, Locale(identifier: "tr_TR"))
                Section {
                    TextField("Açıklama (boşsa ad)", text: $draft.description)
                    TextField("Not", text: $draft.notes, axis: .vertical).lineLimit(1...4)
                }
                if editing != nil {
                    Section {
                        Button("Şablonu sil", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Daha önce kaydedilmiş işlemler silinmez.")
                    }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni tekrarlayan" : "Tekrarlayanı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Kaydet", action: save).bold().disabled(draft.validationError() != nil)
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("Şablon silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: delete)
            }
        }
        .onAppear(perform: setUp)
        .onChange(of: draft.type) { _, t in
            if let c = model.category(draft.categoryId), c.scope != (t == .income ? .income : .expense) {
                draft.categoryId = nil
            }
        }
    }

    private var footer: String {
        let start = DateUtil.day(draft.startDate)
        if start <= DateUtil.today() {
            return "Başlangıç bugün ya da geçmişteyse ilk dönem hemen onaya düşer; Kaydet ile işlem yazılır."
        }
        return "İlk dönem \(DateUtil.display(start)) tarihinde onaya düşer."
    }

    private func setUp() {
        if let editing {
            draft = RecurringDraft(editing: editing)
        } else {
            let last = UserDefaults.standard.string(forKey: "fintrack.lastAccountId")
            let accounts = model.activeAccounts
            draft.accountId = accounts.first { $0.id == last }?.id
                ?? accounts.first { $0.currency == .TRY && ($0.type == .checking || $0.type == .cash) }?.id
                ?? accounts.first?.id
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.saveRecurring(draft, editing: editing)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    private func delete() {
        guard let editing else { return }
        busy = true
        Task {
            do {
                try await model.deleteRecurring(editing)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
