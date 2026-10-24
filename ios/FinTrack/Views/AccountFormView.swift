import SwiftUI
import FinTrackCore
import FinTrackData

/// Hesap ekle / düzenle (web AccountFormModal). Silme web gibi "Onaylıyorum"
/// yazılarak yapılır: bağlı işlemler de silinir.
struct AccountFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: Account?
    var onDeleted: (() -> Void)? = nil

    @State private var draft = AccountDraft()
    @State private var newId = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var confirmText = ""
    @State private var depositOn = false

    private static let confirmWord = "Onaylıyorum"

    private var currentBalancePreview: Double? {
        guard let editing else { return nil }
        let effect = Calc.transactionEffect(accountId: editing.id, currency: draft.currency,
                                            Calc.excludeFuture(model.transactions), fx: model.fx)
        return Money.add(draft.initialBalance, effect)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Hesap adı", text: $draft.name)
                    Picker("Tür", selection: $draft.type) {
                        ForEach(AccountType.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    Picker("Para birimi", selection: $draft.currency) {
                        ForEach(CurrencyCode.allCases, id: \.self) { Text("\($0.rawValue) \($0.symbol)").tag($0) }
                    }
                }

                Section {
                    HStack {
                        Text(draft.isCreditCard ? "Açılış borcu" : "Açılış bakiyesi")
                        Spacer()
                        TextField("0", text: $draft.initialBalanceText)
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                            .onChange(of: draft.initialBalanceText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { draft.initialBalanceText = fixed }
                            }
                    }
                    if let b = currentBalancePreview {
                        LabeledContent("Güncel bakiye", value: Fmt.currency(b, draft.currency))
                    }
                } footer: {
                    Text(draft.isCreditCard
                         ? "Kartın ilk kayıttaki borcunu pozitif girin; borç olarak tutulur."
                         : "Hesabı eklediğiniz andaki bakiye. Güncel bakiye işlemlerle hesaplanır.")
                }

                if draft.isCreditCard {
                    cardSection
                }
                if draft.isSavings {
                    depositSection
                }

                Section("Görünüm") {
                    HStack(spacing: 10) {
                        ForEach(AccountDraft.colors, id: \.self) { c in
                            Circle().fill(Color(hex: c)).frame(width: 28, height: 28)
                                .overlay { if draft.color == c { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                                .onTapGesture { draft.color = c }
                                .accessibilityLabel("Renk \(c)")
                                .accessibilityAddTraits(draft.color == c ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                    TextField("Simge (emoji, isteğe bağlı)", text: Binding(
                        get: { draft.icon.hasPrefix("http") || draft.icon.hasPrefix("data:") ? "" : draft.icon },
                        set: { draft.icon = String($0.prefix(4)) }
                    ))
                }

                if let editing {
                    Section {
                        Button(editing.isArchived ? "Arşivden çıkar" : "Arşive al") { archive(!editing.isArchived) }
                        Button("Hesabı sil", role: .destructive) { confirmText = ""; confirmDelete = true }
                    } footer: {
                        let n = model.linkedTransactionCount(editing)
                        Text(n > 0 ? "Silinirse bu hesaba bağlı \(n) işlem de silinir. Arşivlenen hesap listelerde gizlenir, işlemleri kalır."
                                   : "Arşivlenen hesap listelerde gizlenir.")
                    }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni hesap" : "Hesabı düzenle")
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
            .alert("Hesap silinsin mi?", isPresented: $confirmDelete) {
                TextField(Self.confirmWord, text: $confirmText)
                Button("Sil", role: .destructive, action: delete).disabled(confirmText != Self.confirmWord)
                Button("Vazgeç", role: .cancel) {}
            } message: {
                Text("Hesap ve bağlı tüm işlemleri silinir; borç ödemeleri geri alınır. Onaylamak için \"\(Self.confirmWord)\" yazın.")
            }
        }
        .onAppear {
            if let editing {
                draft = AccountDraft(editing: editing, cardPlan: model.cardPlan(editing))
            }
            depositOn = draft.depositUsed
        }
        .onChange(of: depositOn) { _, on in
            if !on { draft.depositRateText = ""; draft.depositStart = ""; draft.depositEnd = "" }
            else if draft.depositStart.isEmpty { setTerm(32) }
        }
    }

    // MARK: Kredi kartı

    @ViewBuilder private var cardSection: some View {
        let gap = draft.cardGap(editing)
        let suggested = BankRules.nominalDueDay(draft.statementDay, gap)
        Section {
            HStack {
                Text("Limit")
                Spacer()
                TextField("0", text: $draft.limitText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
            }
            Picker("Hesap kesim günü", selection: $draft.statementDay) {
                ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
            }
            HStack {
                Text("Son ödeme günü")
                Spacer()
                TextField("\(suggested)", text: $draft.dueDayText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    .frame(width: 60)
            }
            if draft.dueDayText != String(suggested) {
                Button("Önerilen: ayın \(suggested)'i (kesimden \(gap) gün sonra)") { draft.dueDayText = String(suggested) }
                    .font(.footnote)
            }
            HStack {
                Text("Asgari ödeme %")
                Spacer()
                TextField("örn. 20", text: $draft.minPctText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    .frame(width: 80)
            }
        } header: {
            Text("Kredi kartı")
        } footer: {
            Text("\(BankRules.bankRuleFor(draft.name).label): \(BankRules.bankRuleFor(draft.name).note) Son ödeme günü önerilenle aynıysa her ay kesimden hesaplanır.")
        }
    }

    // MARK: Vadeli mevduat

    @ViewBuilder private var depositSection: some View {
        Section {
            Toggle("Vadeli mevduat", isOn: $depositOn)
            if depositOn {
                HStack {
                    Text("Yıllık brüt faiz %")
                    Spacer()
                    TextField("örn. 45", text: $draft.depositRateText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                        .frame(width: 80)
                }
                HStack {
                    Text("Stopaj %")
                    Spacer()
                    TextField("17,5", text: $draft.depositTaxText).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                        .frame(width: 80)
                }
                DatePicker("Vade başlangıcı", selection: dayBinding(\.depositStart), displayedComponents: .date)
                DatePicker("Vade sonu", selection: dayBinding(\.depositEnd), displayedComponents: .date)
                HStack(spacing: 8) {
                    ForEach([32, 46, 92, 181, 365], id: \.self) { d in
                        Button("\(d) gün") { setTerm(d) }
                            .font(.caption)
                            .buttonStyle(.bordered)
                    }
                }
                if let b = currentBalancePreview, draft.depositOk {
                    let terms = Deposit.Terms(rate: draft.depositRate, start: draft.depositStart,
                                              end: draft.depositEnd, taxPct: draft.depositTax)
                    LabeledContent("Vade sonu net faiz",
                                   value: Fmt.currency(Deposit.project(b, terms, asOf: draft.depositEnd).net, draft.currency))
                }
            }
        } footer: {
            if depositOn { Text("Vade dolunca hesap ekranından net faizi işleyip vadeyi yenileyebilirsiniz.") }
        }
        .environment(\.locale, Locale(identifier: "tr_TR"))
    }

    private func dayBinding(_ kp: WritableKeyPath<AccountDraft, String>) -> Binding<Date> {
        Binding(
            get: { DateUtil.parseDay(draft[keyPath: kp]) ?? Date() },
            set: { draft[keyPath: kp] = DateUtil.day($0) }
        )
    }

    private func setTerm(_ days: Int) {
        let start = draft.depositStart.isEmpty ? DateUtil.today() : draft.depositStart
        draft.depositStart = start
        if let s = DateUtil.parseDay(start), let e = DateUtil.calendar.date(byAdding: .day, value: days, to: s) {
            draft.depositEnd = DateUtil.day(e)
        }
    }

    // MARK: Eylemler

    private func save() {
        busy = true
        Task {
            do {
                try await model.saveAccount(draft, editing: editing, newId: newId)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func archive(_ on: Bool) {
        guard let editing else { return }
        busy = true
        Task {
            do {
                try await model.setAccountArchived(editing, on)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func delete() {
        guard let editing, confirmText == Self.confirmWord else { return }
        busy = true
        Task {
            do {
                try await model.deleteAccount(editing)
                Haptics.success()
                dismiss()
                onDeleted?()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
