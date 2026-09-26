import SwiftUI
import FinTrackCore
import FinTrackData

/// Borç satırı: kalan tutar ve ilerleme. Ödeme kaydı web'de (bağlı işlem + taksit sayacı).
struct DebtRow: View {
    let debt: Debt

    private var overdue: Bool {
        guard !debt.isSettled, let due = debt.dueDate else { return false }
        return String(due.prefix(10)) < DateUtil.today()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                IconBadge(symbol: debt.owe ? "arrow.up.right" : "arrow.down.left",
                          color: debt.owe ? Theme.expense : Theme.income, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(debt.name).lineLimit(1)
                    Text(subtitle).font(.caption).foregroundStyle(overdue ? Theme.expense : .secondary).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Fmt.currency(debt.remaining))
                        .font(.body.monospacedDigit().weight(.semibold))
                    Text("kalan").font(.caption2).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: debt.progress, total: 100)
                .tint(debt.owe ? Theme.accent : Theme.income)
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        var parts: [String] = []
        if let c = debt.counterparty, !c.isEmpty { parts.append(c) }
        if let m = debt.monthlyPayment, m > 0 { parts.append("aylık \(Fmt.currency(m))") }
        if let due = debt.dueDate {
            parts.append(overdue ? "gecikti · \(DateUtil.display(due, "d MMM"))" : "vade \(DateUtil.display(due, "d MMM"))")
        }
        return parts.isEmpty ? debt.typeLabel : parts.joined(separator: " · ")
    }
}

struct DebtDetailView: View {
    @Environment(AppModel.self) private var model
    let debt: Debt

    /// Bu borca bağlı ödemeler (debtId)
    private var payments: [Transaction] {
        model.transactions.filter { $0.debtId == debt.id }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(debt.owe ? "Kalan borç" : "Kalan alacak").font(.subheadline).foregroundStyle(.secondary)
                    Text(Fmt.currency(debt.remaining)).font(.system(size: 30, weight: .bold).monospacedDigit())
                    ProgressView(value: debt.progress, total: 100).tint(debt.owe ? Theme.accent : Theme.income)
                    Text("\(Fmt.currency(debt.paidAmount)) / \(Fmt.currency(debt.totalAmount)) ödendi · %\(Int(debt.progress.rounded()))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            Section {
                LabeledContent("Tür", value: debt.typeLabel)
                if let c = debt.counterparty, !c.isEmpty { LabeledContent("Karşı taraf", value: c) }
                if let m = debt.monthlyPayment, m > 0 { LabeledContent("Aylık ödeme", value: Fmt.currency(m)) }
                if let t = debt.totalInstallments, t > 0 {
                    LabeledContent("Taksit", value: "\(debt.paidInstallments ?? 0) / \(t)")
                }
                if let r = debt.interestRate, r > 0 {
                    LabeledContent("Yıllık faiz", value: "%\(String(format: "%.2f", r).replacingOccurrences(of: ".", with: ","))")
                }
                if !debt.startDate.isEmpty { LabeledContent("Başlangıç", value: DateUtil.display(debt.startDate)) }
                if let d = debt.dueDate { LabeledContent("Vade", value: DateUtil.display(d)) }
                if let a = model.account(debt.accountId) { LabeledContent("Ödeme hesabı", value: a.name) }
                if debt.isSettled { LabeledContent("Durum", value: "Kapandı") }
            }
            if let n = debt.notes, !n.isEmpty {
                Section("Not") { Text(n) }
            }
            if !payments.isEmpty {
                Section("Ödemeler") {
                    ForEach(payments) { TransactionRow(t: $0) }
                }
            }
            Section {
                Text("Ödeme kaydetme ve düzenleme şimdilik web'de.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(debt.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
