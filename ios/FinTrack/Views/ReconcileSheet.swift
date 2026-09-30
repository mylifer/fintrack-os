import SwiftUI
import FinTrackCore
import FinTrackData

/// Bakiyeyi eşitle: bankadaki / cüzdandaki gerçek bakiyeyi gir, fark tek düzeltme
/// satırı olarak yazılsın (gelir/gidere ve bütçelere girmez).
struct ReconcileSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let account: Account

    @State private var text = ""
    @State private var negative = false
    @State private var rowId = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private var isCard: Bool { account.type == .credit_card }
    private var balance: Double { model.balances[account.id] ?? account.initialBalance }
    private var input: Double {
        let v = abs(Fmt.parseAmount(text))
        return negative && !isCard ? -v : v
    }
    private var delta: Double? {
        text.isEmpty ? nil : Reconcile.delta(actual: Reconcile.actualSigned(input, account: account), balance: balance)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Uygulamadaki bakiye", value: Fmt.currency(balance, account.currency))
                } footer: {
                    Text("Tarihi gelmiş ve onaylanmış işlemlere göre.")
                }
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(account.currency.symbol).font(.system(size: 26, weight: .semibold)).foregroundStyle(.secondary)
                        TextField("0", text: $text)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 34, weight: .bold).monospacedDigit())
                            .focused($focused)
                            .onChange(of: text) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { text = fixed }
                            }
                    }
                    if !isCard {
                        Toggle("Eksi bakiye", isOn: $negative)
                    }
                } header: {
                    Text(isCard ? "Kartın gerçek borcu" : "Gerçek bakiye")
                } footer: {
                    Text(isCard ? "Ekstre/bankadaki güncel borcu artı olarak girin." : "Bankada ya da cüzdanda şu an görünen tutar.")
                }
                if let d = delta {
                    Section {
                        if d == 0 {
                            Label("Bakiye zaten güncel — düzeltme gerekmiyor.", systemImage: "checkmark.circle")
                                .foregroundStyle(Theme.income)
                        } else {
                            Label("\(Fmt.signed(d, account.currency)) \(d > 0 ? "gelir" : "gider") olarak \"Sistem: Bakiye Eşitleme\" satırı eklenecek.",
                                  systemImage: "arrow.left.arrow.right")
                                .font(.subheadline)
                        }
                    } footer: {
                        Text("Düzeltme satırı gelir/gider toplamlarına, bütçelere ve raporlara girmez; yalnız bakiyeyi düzeltir.")
                    }
                }
            }
            .disabled(busy)
            .navigationTitle("Bakiyeyi eşitle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Eşitle", action: save).bold().disabled(delta == nil || delta == 0)
                    }
                }
            }
            .alert("Eşitleme kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.medium, .large])
        .onAppear { focused = true }
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.reconcile(account, actual: input, id: rowId)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
