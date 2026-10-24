import SwiftUI
import FinTrackCore
import FinTrackData

/// İade işle (web RefundModal): tam ya da kısmi; orijinal gider değişmez,
/// negatif tutarlı yeni gider yazılır.
struct RefundSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let original: Transaction

    @State private var partial = false
    @State private var amountText = ""
    @State private var date = Date()
    @State private var id = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        let remaining = model.refundRemaining(original)
        NavigationStack {
            Form {
                Section {
                    LabeledContent("İşlem", value: original.description.isEmpty ? "—" : original.description)
                    LabeledContent("Tutar", value: Fmt.currency(original.amount, original.currency))
                    LabeledContent("İade edilebilir", value: Fmt.currency(remaining, original.currency))
                }
                Section {
                    Picker("İade", selection: $partial) {
                        Text("Tam iade").tag(false)
                        Text("Kısmi iade").tag(true)
                    }
                    .pickerStyle(.segmented)
                    if partial {
                        HStack {
                            Text("İade tutarı")
                            Spacer()
                            TextField("0", text: $amountText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                .onChange(of: amountText) { _, v in
                                    let fixed = Fmt.normalizeTypedAmount(v)
                                    if fixed != v { amountText = fixed }
                                }
                            Text(original.currency.symbol).foregroundStyle(.secondary)
                        }
                    }
                    DatePicker("İade tarihi", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                } footer: {
                    Text("İade, harcamayı ait olduğu kategoriden düşer; gelir sayılmaz. Tarih iadenin hangi aya yazılacağını belirler.")
                }
            }
            .disabled(busy || remaining <= 0)
            .navigationTitle("İade işle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Onayla", action: save).bold()
                            .disabled(remaining <= 0 || (partial && Fmt.parseAmount(amountText) <= 0))
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.refund(original, amount: partial ? Fmt.parseAmount(amountText) : nil, date: date, id: id)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
