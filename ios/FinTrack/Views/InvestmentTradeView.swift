import SwiftUI
import FinTrackCore
import FinTrackData

/// Yatırım alım / satımı (web BuySellModal). Hesap seçilirse tutar hesaptan
/// düşer (alım) ya da hesaba girer (satış); satışta gerçekleşen K/Z ve TEFAS
/// stopajı ayrı satırlar olur.
struct InvestmentTradeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var editing: InvestmentTransaction? = nil
    var initialType = "buy"
    var initialAsset: String? = nil

    static let staticAssets = ["GOLD_GRAM", "GOLD_QUARTER", "GOLD_HALF", "GOLD_FULL", "GOLD_OZ", "GOLD_BRACELET",
                               "USD", "EUR", "GBP"]
    static let newKinds: [(key: String, label: String, prefix: String, hint: String)] = [
        ("TEFAS_NEW", "TEFAS / BES fonu (kodla)", "TEFAS:", "Fon kodu, örn. AFA"),
        ("BIST_NEW", "BIST hissesi (kodla)", "BIST:", "Hisse kodu, örn. THYAO"),
        ("CRYPTO_NEW", "Kripto (sembolle)", "CRYPTO:", "Sembol, örn. BTC"),
    ]

    @State private var type = "buy"
    @State private var choice = "GOLD_GRAM"
    @State private var newCode = ""
    @State private var lookup: (code: String, quote: PriceBook.Quote?)? = nil
    @State private var looking = false
    @State private var qtyText = ""
    @State private var priceText = ""
    @State private var totalText = ""
    @State private var date = Date()
    @State private var accountId: String?
    @State private var note = ""
    @State private var seed = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    private var newKind: (key: String, label: String, prefix: String, hint: String)? {
        Self.newKinds.first { $0.key == choice }
    }

    /// Kaydedilecek varlık; yeni kod doğrulanmadıysa nil
    private var asset: String? {
        guard let k = newKind else { return choice }
        let code = newCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard let l = lookup, l.code == code, l.quote != nil else { return nil }
        return k.prefix + code
    }

    // Miktar ve birim fiyat kuruşa yuvarlanmaz (fon payı / kripto / 6 haneli fon fiyatı — web parseFloat)
    private var qty: Double { Fmt.parseNumber(qtyText) }
    private var price: Double { Fmt.parseNumber(priceText) }
    private var total: Double { qty * price }

    private var heldAssets: [String] {
        model.holdings.filter { $0.quantity > 0.000001 }.map(\.asset)
    }

    private var choices: [String] {
        var out: [String] = type == "sell" && editing == nil
            ? Self.staticAssets.filter(heldAssets.contains)
            : Self.staticAssets
        for a in heldAssets where !out.contains(a) { out.append(a) }
        if let e = editing, !out.contains(e.asset) { out.append(e.asset) }
        return out
    }

    private func choiceLabel(_ a: String) -> String {
        switch Asset.kind(a) {
        case .fund: "\(Asset.code(a)) — TEFAS fonu"
        case .stock: "\(Asset.code(a)) — BIST"
        case .crypto: "\(Asset.code(a)) — Kripto"
        default: Asset.label(a)
        }
    }

    private var maxSell: Double {
        guard type == "sell", let a = asset else { return .infinity }
        return InvestmentTrade.held(model.investments, asset: a, excluding: editing?.id)
    }

    private var account: Account? { model.account(accountId) }

    private var canSave: Bool {
        qty > 0 && price > 0 && asset != nil && !busy && !(type == "sell" && qty > maxSell + 0.0000001)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("İşlem", selection: $type) {
                        Text("Alım").tag("buy")
                        Text("Satış").tag("sell")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    Picker("Varlık", selection: $choice) {
                        ForEach(choices, id: \.self) { Text(choiceLabel($0)).tag($0) }
                        if type == "buy" {
                            ForEach(Self.newKinds, id: \.key) { Text($0.label).tag($0.key) }
                        }
                    }
                    if let k = newKind {
                        HStack {
                            TextField(k.hint, text: $newCode)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .onSubmit(lookUp)
                            if looking { ProgressView() } else {
                                Button("Doğrula", action: lookUp)
                                    .disabled(newCode.trimmingCharacters(in: .whitespaces).count < 2)
                            }
                        }
                        if let l = lookup, l.code == newCode.trimmingCharacters(in: .whitespaces).uppercased() {
                            if let q = l.quote {
                                Label("\(q.name) · \(Fmt.currency(q.price))", systemImage: "checkmark.circle.fill")
                                    .font(.footnote).foregroundStyle(Theme.income)
                            } else {
                                Label("Bu kod bulunamadı", systemImage: "xmark.circle").font(.footnote).foregroundStyle(Theme.expense)
                            }
                        }
                    }
                    if type == "sell", let a = asset {
                        LabeledContent("Elde", value: "\(Fmt.quantity(maxSell)) \(Asset.unit(a))")
                    }
                }

                Section {
                    numberRow(type == "buy" ? "Alınan miktar" : "Satılan miktar", $qtyText) { v in
                        let t = Fmt.parseAmount(totalText), q = Fmt.parseNumber(v)
                        if t > 0 && q > 0 { priceText = Self.priceInput(t / q, asset: asset) }
                    }
                    numberRow("Birim fiyat (₺)", $priceText) { _ in totalText = "" }
                    numberRow("Toplam (₺)", Binding(
                        get: { totalText.isEmpty ? (total > 0 ? Fmt.amountInput(Money.round(total)) : "") : totalText },
                        set: { totalText = $0 }
                    )) { v in
                        let t = Fmt.parseAmount(v)
                        if t > 0 && qty > 0 { priceText = Self.priceInput(t / qty, asset: asset) }
                    }
                    if let a = asset, livePrice(a) > 0 {
                        Button("Güncel fiyatı kullan (\(Fmt.currency(livePrice(a))))") {
                            priceText = Self.priceInput(livePrice(a), asset: a)
                            totalText = ""
                        }
                        .font(.footnote)
                    }
                    DatePicker("Tarih", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                } footer: {
                    if type == "sell" && qty > maxSell + 0.0000001 {
                        Text("Elde \(Fmt.quantity(maxSell)) var; daha fazlası satılamaz.").foregroundStyle(Theme.expense)
                    } else if DateUtil.day(date) < DateUtil.today() {
                        Text("Geçmiş tarihli işlemde o günkü birim fiyatı girin (ya da toplam tutar ile miktarı).")
                    }
                }

                Section {
                    Picker(type == "buy" ? "Ödenen hesap" : "Paranın yattığı hesap", selection: $accountId) {
                        Text("Hesap yok").tag(String?.none)
                        ForEach(model.activeAccounts) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                    }
                    if let a = account, a.currency != .TRY, total > 0 {
                        LabeledContent("Hesaba yazılacak",
                                       value: model.fx.rate(a.currency) == nil ? "\(a.currency.rawValue) kuru bekleniyor"
                                            : Fmt.currency(model.fx.fromBaseTry(total, a.currency), a.currency))
                    }
                    TextField("Not", text: $note)
                } footer: {
                    Text(accountId == nil
                         ? "Hesap seçmezseniz yalnız portföy kaydı oluşur, bakiye değişmez."
                         : type == "buy" ? "Tutar hesaptan düşer; gider sayılmaz." : "Tutar hesaba girer; kâr/zarar ayrı satır olur.")
                }

                if type == "sell", accountId != nil, let a = asset, qty > 0, price > 0, qty <= maxSell + 0.0000001 {
                    sellPreview(a)
                }

                if editing != nil {
                    Section { Button("İşlemi sil", role: .destructive) { confirmDelete = true } }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? (type == "buy" ? "Alım" : "Satış") : "İşlemi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Kaydet", action: save).bold().disabled(!canSave) }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("İşlem silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: delete)
            } message: {
                Text("Hesaba yazılan bağlı satırlar (alım/satış, kâr/zarar, stopaj) da silinir.")
            }
        }
        .onAppear(perform: setUp)
        .onChange(of: type) { _, t in
            if t == "sell", editing == nil, !choices.contains(choice) { choice = choices.first ?? "GOLD_GRAM" }
        }
        .onChange(of: choice) { _, _ in
            if editing == nil, DateUtil.day(date) >= DateUtil.today(), let a = asset, livePrice(a) > 0, totalText.isEmpty {
                priceText = Self.priceInput(livePrice(a), asset: a)
            }
        }
    }

    // MARK: Parçalar

    private func numberRow(_ title: String, _ text: Binding<String>, onEdit: @escaping (String) -> Void) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 160)
                .onChange(of: text.wrappedValue) { old, v in
                    let fixed = Fmt.normalizeTypedAmount(v)
                    if fixed != v { text.wrappedValue = fixed; return }
                    if old != v { onEdit(v) }
                }
        }
    }

    @ViewBuilder private func sellPreview(_ a: String) -> some View {
        let created = editing?.createdAt ?? AppModelClock.nowISO()
        let avg = InvestmentTrade.avgCostAt(model.investments, asset: a, date: DateUtil.day(date),
                                            createdAt: created, excluding: editing?.id)
        let cost = qty * avg
        let gain = cost > 0.001 ? total - cost : 0
        let tax = FundTaxConfig.taxOnGain(gain, rate: model.fundTax.rate(a))
        Section("Önizleme") {
            LabeledContent("Maliyet (ortalama)", value: Fmt.currency(cost))
            LabeledContent(gain >= 0 ? "Gerçekleşen kâr" : "Gerçekleşen zarar", value: Fmt.signed(gain))
                .foregroundStyle(gain >= 0 ? Theme.income : Theme.expense)
            if tax > 0 {
                LabeledContent("Stopaj (%\(Fmt.amountInput(model.fundTax.rate(a))))", value: "−" + Fmt.currency(tax))
                LabeledContent("Hesaba net", value: Fmt.currency(Money.sub(total, tax)))
            }
        }
    }

    private func livePrice(_ a: String) -> Double {
        if newKind != nil { return lookup?.quote?.price ?? 0 }
        return model.prices.price(a)
    }

    /// Fon payı ve kripto fiyatı 6 hane, diğerleri kuruş (web priceDecimals)
    static func priceInput(_ p: Double, asset: String?) -> String {
        let six = asset.map { [.fund, .crypto].contains(Asset.kind($0)) } ?? false
        return decimalInput(p, maxDigits: six ? 6 : 2)
    }

    /// Düzenleme alanı metni: ondalık virgül, gruplamasız, en çok `maxDigits` hane
    static func decimalInput(_ v: Double, maxDigits: Int) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "tr_TR")
        f.numberStyle = .decimal
        f.usesGroupingSeparator = false
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = maxDigits
        return f.string(from: NSNumber(value: v)) ?? ""
    }

    // MARK: Eylemler

    private func setUp() {
        if let e = editing {
            type = e.type
            choice = e.asset
            qtyText = Self.decimalInput(e.quantity, maxDigits: 10)   // kripto miktarı 8+ hane olabilir, gruplamasız
            priceText = Self.priceInput(e.pricePerUnit, asset: e.asset)
            date = DateUtil.parseDay(e.date) ?? Date()
            accountId = e.type == "buy" ? e.sourceAccountId : e.targetAccountId
            note = e.note ?? ""
        } else {
            type = initialType
            choice = initialAsset ?? (initialType == "sell" ? (heldAssets.first ?? "GOLD_GRAM") : "GOLD_GRAM")
            if let a = asset, model.prices.price(a) > 0 { priceText = Self.priceInput(model.prices.price(a), asset: a) }
        }
    }

    private func lookUp() {
        guard let k = newKind else { return }
        let code = newCode.trimmingCharacters(in: .whitespaces).uppercased()
        guard code.count >= 2 else { return }
        looking = true
        Task {
            let q = await PricesService.lookup(asset: k.prefix + code)
            lookup = (code, q)
            if let q, priceText.isEmpty || totalText.isEmpty { priceText = Self.priceInput(q.price, asset: k.prefix + code) }
            looking = false
        }
    }

    private func save() {
        guard let a = asset else { return }
        busy = true
        Task {
            do {
                try await model.saveInvestment(.init(type: type, asset: a, quantity: qty, pricePerUnit: price,
                                                     date: DateUtil.day(date), accountId: accountId, note: note),
                                               editing: editing, seed: seed)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func delete() {
        guard let editing else { return }
        busy = true
        Task {
            do {
                try await model.deleteInvestment(editing)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}

/// ISO zaman damgası (web new Date().toISOString())
enum AppModelClock {
    static func nowISO() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
