import SwiftUI
import FinTrackCore
import FinTrackData

/// Vadeli hesabın vade özeti (web DepositPanel); vade dolunca faizi işleme.
/// Koşul girilmemiş hesapta görünmez (koşullar web'de hesap formundan girilir).
struct DepositSummary: View {
    @Environment(AppModel.self) private var model
    let accountId: String
    @State private var confirming = false
    @State private var busy = false
    @State private var done: (net: Double, date: String, currency: CurrencyCode)?
    @State private var errorMessage: String?

    var body: some View {
        if let account = model.account(accountId), let t = Deposit.terms(account) {
            let balance = model.balances[account.id] ?? account.initialBalance
            let p = Deposit.project(balance, t, asOf: DateUtil.today())
            let money = { (v: Double) in Fmt.currency(v, account.currency) }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Vadeli mevduat").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(p.matured ? "Vade doldu" : "\(p.daysLeft) gün kaldı")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background((p.matured ? Theme.warning : Color.secondary).opacity(0.15), in: Capsule())
                        .foregroundStyle(p.matured ? Theme.warning : .secondary)
                }
                HStack(alignment: .top) {
                    cell("Net faiz (vade sonu)", money(p.net), Theme.income)
                    cell("Vade sonu tutarı", money(p.maturityValue), .primary)
                }
                Text("%\(Deposit.rateText(t.rate)) · \(DateUtil.display(t.start)) – \(DateUtil.display(t.end)) (\(p.days) gün) · stopaj %\(Deposit.rateText(t.taxPct)) · bugüne kadar \(money(p.accruedNet))")
                    .font(.caption2).foregroundStyle(.secondary)
                if let done {
                    doneLabel(done)
                } else if p.matured {
                    Button { confirming = true } label: {
                        Label(busy ? "İşleniyor…" : "Faizi işle · \(money(p.net))", systemImage: "banknote")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.tint)
                    .disabled(busy)
                }
            }
            .confirmationDialog("Vade \(DateUtil.display(t.end)) tarihinde doldu. \(money(p.net)) net faiz hesaba işlensin mi?",
                                isPresented: $confirming, titleVisibility: .visible) {
                Button("Faizi işle ve \(p.days) gün yenile") { process(account, t, renew: true) }
                Button("Faizi işle, vadeyi bitir") { process(account, t, renew: false) }
            }
            .alert("İşlenemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        } else if let done {
            doneLabel(done)
        }
    }

    private func doneLabel(_ d: (net: Double, date: String, currency: CurrencyCode)) -> some View {
        Label(d.net > 0 ? "\(Fmt.currency(d.net, d.currency)) net faiz \(DateUtil.display(d.date)) tarihiyle işlendi."
                        : "Bu vadenin faizi zaten işlenmişti; vade güncellendi.",
              systemImage: "checkmark.circle.fill")
            .font(.caption).foregroundStyle(Theme.income)
    }

    private func cell(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.subheadline.weight(.semibold).monospacedDigit()).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func process(_ account: Account, _ t: Deposit.Terms, renew: Bool) {
        guard !busy else { return }
        busy = true
        Task {
            do {
                let net = try await model.processDeposit(account, renew: renew)
                done = (net, t.end, account.currency)
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
