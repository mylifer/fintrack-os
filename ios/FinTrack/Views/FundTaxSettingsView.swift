import SwiftUI
import FinTrackCore
import FinTrackData

/// TEFAS fon stopajı (web Ayarlar → Yatırım): açıkken kârlı fon satışında
/// kâr üzerinden stopaj ayrı gider olarak yazılır. Oran kullanıcı tarafından
/// girilir; uygulama varsayılan oran kabul etmez. Ayar bu cihazda saklanır.
struct FundTaxSettingsView: View {
    @Environment(AppModel.self) private var model

    private var funds: [String] {
        Set(model.investments.map(\.asset).filter { Asset.kind($0) == .fund }).map(Asset.code).sorted()
    }

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Toggle("Fon satışında stopaj", isOn: $model.fundTax.enabled)
                if model.fundTax.enabled {
                    rateRow("Varsayılan oran", Binding(
                        get: { model.fundTax.defaultRate },
                        set: { model.fundTax.defaultRate = FundTaxConfigClamp.clamp($0) }
                    ))
                }
            } footer: {
                Text("Yalnız TEFAS fonları; zararlı satışta stopaj yok. Yürürlükteki oran fon türüne göre değişir — kendiniz girin. Bu ayar bu iPhone'da saklanır (web'deki ayardan ayrıdır).")
            }
            if model.fundTax.enabled && !funds.isEmpty {
                Section("Fon bazında oran") {
                    ForEach(funds, id: \.self) { code in
                        rateRow(code, Binding(
                            get: { model.fundTax.rates[code] ?? model.fundTax.defaultRate },
                            set: { model.fundTax.rates[code] = FundTaxConfigClamp.clamp($0) }
                        ))
                    }
                }
            }
        }
        .navigationTitle("Fon stopajı")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func rateRow(_ title: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text("%").foregroundStyle(.secondary)
            TextField("0", text: Binding(get: { Fmt.amountInput(value.wrappedValue) },
                                         set: { value.wrappedValue = Fmt.parseAmount($0) }))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
        }
    }
}

enum FundTaxConfigClamp {
    static func clamp(_ r: Double) -> Double { r.isFinite ? min(100, max(0, r)) : 0 }
}
