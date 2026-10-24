import SwiftUI
import FinTrackCore
import FinTrackData

/// Borç / alacak ekle ve düzenle (web debts/page.tsx formu).
struct DebtFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: Debt?
    var onDeleted: (() -> Void)? = nil

    @State private var draft = DebtDraft()
    @State private var newId = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var hasDue = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Yön", selection: $draft.direction) {
                        Text("Borçluyum").tag("owe")
                        Text("Alacaklıyım").tag("owed")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                Section {
                    TextField(draft.direction == "owe" ? "Ad (örn. Araba Kredisi)" : "Ad (örn. Ahmet'e verilen)", text: $draft.name)
                    Picker("Tür", selection: $draft.type) {
                        ForEach(DebtDraft.types, id: \.value) { Text($0.label).tag($0.value) }
                    }
                    TextField(draft.direction == "owe" ? "Alacaklı (banka / kişi)" : "Borçlu kişi", text: $draft.counterparty)
                }
                Section("Tutarlar") {
                    amountRow("Toplam", $draft.totalText)
                    amountRow("Ödenen", $draft.paidText)
                    amountRow("Aylık ödeme", $draft.monthlyText, placeholder: "isteğe bağlı")
                    HStack {
                        Text("Taksit sayısı")
                        Spacer()
                        TextField("isteğe bağlı", text: $draft.installmentsText).keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing).frame(width: 110)
                    }
                    amountRow("Yıllık faiz %", $draft.interestText, placeholder: "isteğe bağlı")
                }
                Section {
                    DatePicker(draft.direction == "owe" ? "Borcu aldığım gün" : "Borcu verdiğim gün",
                               selection: day(\.borrowDate), displayedComponents: .date)
                    DatePicker("İlk taksit / başlangıç", selection: day(\.startDate), displayedComponents: .date)
                    Toggle("Vade tarihi", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Vade", selection: day(\.dueDate), displayedComponents: .date)
                    }
                } footer: {
                    Text("Vade tarihi gecikme hatırlatmasıdır; ödeme planını kaydırmaz.")
                }
                .environment(\.locale, Locale(identifier: "tr_TR"))

                Section {
                    Picker("Ödeme hesabı", selection: $draft.accountId) {
                        Text("Yok").tag(String?.none)
                        ForEach(model.activeAccounts) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                    }
                    if editing == nil {
                        Picker(draft.direction == "owe" ? "Para hangi hesaba girdi" : "Para hangi hesaptan çıktı",
                               selection: $draft.depositAccountId) {
                            Text("Hiçbiri").tag(String?.none)
                            ForEach(model.activeAccounts) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                        }
                    }
                } footer: {
                    if editing == nil {
                        Text(draft.depositAccountId == nil
                             ? "Hesap seçmezseniz yalnız borç kaydı oluşur, bakiye değişmez."
                             : "Toplam tutar seçilen hesaba \(draft.direction == "owe" ? "girer" : "düşülür"); gelir/gider sayılmaz.")
                    }
                }
                Section {
                    TextField("Not", text: $draft.notes, axis: .vertical).lineLimit(1...4)
                }
                if editing != nil {
                    Section {
                        Button("Borcu sil", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni borç / alacak" : "Düzenle")
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
            .confirmationDialog("Borç silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                let n = editing.map { model.debtLinkedTransactions($0).count } ?? 0
                Button("Yalnız borcu sil", role: .destructive) { delete(withTransactions: false) }
                if n > 0 {
                    Button("Borcu ve \(n) bağlı işlemi sil", role: .destructive) { delete(withTransactions: true) }
                }
            } message: {
                Text("Yalnız borç silinirse ödemeler (gerçekten yapıldıkları için) hesaplarda kalır. Yanlış girilmiş bir borçsa bağlı işlemleri de silin.")
            }
        }
        .onAppear {
            if let editing {
                draft = DebtDraft(editing: editing, principal: model.debtPrincipal(editing))
            }
            hasDue = !draft.dueDate.isEmpty
        }
        .onChange(of: hasDue) { _, on in
            if !on { draft.dueDate = "" } else if draft.dueDate.isEmpty { draft.dueDate = DateUtil.today() }
        }
    }

    private func amountRow(_ title: String, _ text: Binding<String>, placeholder: String = "0") -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField(placeholder, text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .onChange(of: text.wrappedValue) { _, v in
                    let fixed = Fmt.normalizeTypedAmount(v)
                    if fixed != v { text.wrappedValue = fixed }
                }
        }
    }

    private func day(_ kp: WritableKeyPath<DebtDraft, String>) -> Binding<Date> {
        Binding(get: { DateUtil.parseDay(draft[keyPath: kp]) ?? Date() },
                set: { draft[keyPath: kp] = DateUtil.day($0) })
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.saveDebt(draft, editing: editing, newId: newId)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func delete(withTransactions: Bool) {
        guard let editing else { return }
        busy = true
        Task {
            do {
                try await model.deleteDebt(editing, withTransactions: withTransactions)
                Haptics.success()
                dismiss()
                onDeleted?()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
