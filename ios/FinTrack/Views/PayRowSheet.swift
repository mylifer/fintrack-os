import SwiftUI
import FinTrackCore
import FinTrackData

/// Ödeme Takibi "Öde" (web PayModal): tutar hedefin para biriminde, ödeme
/// hesabı, tarih, "hesaptan işlem olarak kaydet". Ay "ödendi" işaretlenir,
/// tutar ve vade dondurulur.
struct PayRowSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let row: PaymentRow

    @State private var amountText = ""
    @State private var fromAccountId: String?
    @State private var date = Date()
    @State private var createTransaction = true
    @State private var note = ""
    @State private var busy = false
    @State private var errorMessage: String?

    /// Kaynak olabilecek hesaplar: arşivsiz, ödenen kartın kendisi değil
    private var payers: [Account] { model.activeAccounts.filter { $0.id != row.target.id } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(row.target.currency.symbol).font(.system(size: 26, weight: .semibold)).foregroundStyle(.secondary)
                        TextField("0", text: $amountText)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 34, weight: .bold).monospacedDigit())
                            .onChange(of: amountText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { amountText = fixed }
                            }
                    }
                } header: {
                    Text("\(row.target.name) · \(DateUtil.display(row.dueDate, "d MMMM")) vadeli")
                } footer: {
                    if row.state == .partial {
                        Text("Bu ay \(Fmt.currency(row.paidAmount, row.target.currency)) ödeme bulundu; kalan \(Fmt.currency(row.remaining, row.target.currency)).")
                    }
                }
                Section {
                    Toggle("Hesaptan işlem olarak kaydet", isOn: $createTransaction)
                    if createTransaction {
                        Picker("Ödeme hesabı", selection: $fromAccountId) {
                            Text("Seçin").tag(String?.none)
                            ForEach(payers) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                        }
                    }
                    DatePicker("Tarih", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                } footer: {
                    Text(createTransaction
                         ? "\"\(PaymentSchedule.paymentDescription(row.target))\" olarak hesaptan düşülür\(row.target.kind == .debt ? " ve borca işlenir" : ""); ay ödendi işaretlenir."
                         : "Yalnız bu ay ödendi işaretlenir; hiçbir bakiye değişmez (ödemeyi başka yerden girdiyseniz).")
                }
                Section { TextField("Not", text: $note, axis: .vertical).lineLimit(1...3) }
            }
            .disabled(busy)
            .navigationTitle("Ödeme")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Ödendi", action: pay).bold()
                            .disabled(Fmt.parseAmount(amountText) <= 0 || (createTransaction && fromAccountId == nil))
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .presentationDetents([.medium, .large])
        .onAppear(perform: setUp)
    }

    /// web PayModal: tutar kalan (yoksa ay tutarı), hesap satırınki ödeyebiliyorsa, yoksa ilk kart dışı hesap
    private func setUp() {
        let amount = row.remaining > 0 ? row.remaining : (row.amount ?? 0)
        amountText = amount > 0 ? Fmt.amountInput(amount) : ""
        fromAccountId = payers.first { $0.id == row.fromAccountId }?.id
            ?? payers.first { $0.type != .credit_card }?.id
    }

    private func pay() {
        busy = true
        let input = PaymentActions.PayInput(amount: Fmt.parseAmount(amountText), fromAccountId: createTransaction ? fromAccountId : nil,
                                            date: DateUtil.day(date), createTransaction: createTransaction,
                                            note: note.isEmpty ? nil : note)
        Task {
            do {
                try await model.payRow(row, input: input)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
