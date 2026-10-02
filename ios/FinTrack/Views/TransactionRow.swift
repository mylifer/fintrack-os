import SwiftUI
import FinTrackCore
import FinTrackData

struct TransactionRow: View {
    @Environment(AppModel.self) private var model
    let t: Transaction
    /// Hesap detayında gösterilen hesap: transferin yönü buna göre işaretlenir.
    var perspectiveAccountId: String?
    /// "Onay bekliyor" kartında rozet tekrar olur; orada gizlenir.
    var showsBadge = true

    var body: some View {
        AmountRow {
            icon
        } title: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body).lineLimit(1)
                HStack(spacing: 4) {
                    Text(subtitle).lineLimit(1)
                    if showsBadge, let badge {
                        Text("·")
                        Text(badge).foregroundStyle(Theme.planned).lineLimit(1).fixedSize()
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        } trailing: {
            Text(amountText)
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(amountColor)
                .lineLimit(1)
        }
        .padding(.vertical, 2)
        .opacity(Calc.isPosted(t) ? 1 : 0.7)
        .accessibilityElement(children: .combine)
    }

    private var category: FinTrackCore.Category? { model.category(t.categoryId) }

    @ViewBuilder private var icon: some View {
        if t.type == .transfer {
            IconBadge(symbol: "arrow.left.arrow.right", color: .secondary)
        } else if let c = category {
            let i = Icons.category(c.icon)
            IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color))
        } else {
            IconBadge(symbol: t.type == .income ? "arrow.down.left" : "tag", color: .gray)
        }
    }

    private var title: String {
        if !t.description.isEmpty { return t.description }
        if t.type == .transfer {
            return "\(model.account(t.accountId)?.name ?? "?") → \(model.account(t.toAccountId)?.name ?? "?")"
        }
        return category?.name ?? t.type.label
    }

    private var subtitle: String {
        var parts: [String] = []
        if t.type == .transfer {
            if !t.description.isEmpty {
                parts.append("\(model.account(t.accountId)?.name ?? "?") → \(model.account(t.toAccountId)?.name ?? "?")")
            }
        } else {
            if let c = category, !t.description.isEmpty,
               c.name.lowercased(with: Locale(identifier: "tr_TR")) != t.description.lowercased(with: Locale(identifier: "tr_TR")) {
                parts.append(c.name)
            }
            if let p = model.person(t.recipientId) ?? model.person(t.familyMemberId) { parts.append(p.name) }
            if perspectiveAccountId == nil, let a = model.account(t.accountId) { parts.append(a.name) }
        }
        if let i = t.installIndex, let n = t.installTotal { parts.append("\(i)/\(n) taksit") }
        // Planlı / onay bekleyen bölümünde gün başlığı yok: tarih satırda
        if !Calc.isPosted(t) || Calc.awaitsApproval(t) { parts.insert(DateUtil.display(t.date, "d MMM"), at: 0) }
        return parts.joined(separator: " · ")
    }

    private var badge: String? {
        if t.plannedRecurringId != nil { return "Tekrarlayan" }
        if Calc.awaitsApproval(t) { return "Onay bekliyor" }
        if !Calc.isPosted(t) { return "Planlı" }
        return nil
    }

    /// Transferde hesap bakış açısı yoksa işaretsiz; varsa gelen +, giden −.
    private var sign: Double {
        switch t.type {
        case .income: 1
        case .expense: -1
        case .transfer:
            if let p = perspectiveAccountId { p == t.toAccountId ? 1 : -1 } else { 0 }
        }
    }

    private var amountText: String {
        sign == 0 ? Fmt.currency(t.amount, t.currency) : Fmt.signed(sign * t.amount, t.currency)
    }

    private var amountColor: Color {
        if !Calc.isPosted(t) { return Theme.planned }
        if sign > 0 { return Theme.income }
        return .primary
    }
}
