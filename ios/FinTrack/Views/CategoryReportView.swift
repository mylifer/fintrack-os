import SwiftUI
import FinTrackCore
import FinTrackData

struct CategoryReportRoute: Hashable {}

struct CategoryTxRoute: Hashable {
    var title: String
    var categoryIds: Set<String>
    /// Kategorisiz satırlar (categoryId boş)
    var uncategorized: Bool
    var month: MonthYear
    var type: TransactionType
}

/// Aylık kategori raporu: üst kategoriler (alt kategorileriyle), tutar, pay ve
/// geçen aya göre değişim. Web raporlarıyla aynı kural: taksitli alım satın alma
/// ayına tam tutarla, mutabakat ve anapara hareketleri hariç.
struct CategoryReportView: View {
    @Environment(AppModel.self) private var model
    @State private var month = MonthYear.current()
    @State private var type: TransactionType = .expense
    @State private var expanded: Set<String> = []

    struct Node: Identifiable {
        var id: String
        var category: FinTrackCore.Category?
        var amount: Double
        var previous: Double
        var children: [Node]
        /// Bu düğümün kapsadığı kategori kimlikleri (kendisi + alt ağaç)
        var ids: Set<String>
    }

    var body: some View {
        let (nodes, total, prevTotal) = report()
        List {
            Section {
                Picker("Tür", selection: $type) {
                    Text("Gider").tag(TransactionType.expense)
                    Text("Gelir").tag(TransactionType.income)
                }
                .pickerStyle(.segmented)
                HStack {
                    Button { month = month.previous } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Önceki ay")
                    Spacer()
                    Text(DateUtil.monthTitle(month)).font(.headline)
                    Spacer()
                    Button { month = month.next } label: { Image(systemName: "chevron.right") }
                        .accessibilityLabel("Sonraki ay")
                        .disabled(month == .current())
                }
                .buttonStyle(.borderless)
                VStack(alignment: .leading, spacing: 4) {
                    Text(Fmt.currency(total))
                        .font(.system(size: 30, weight: .bold).monospacedDigit())
                        .contentTransition(.numericText())
                    if prevTotal > 0 {
                        change(total, prevTotal, suffix: isCurrentMonth ? "geçen ayın aynı dönemine göre" : "geçen aya göre")
                    }
                }
                .padding(.vertical, 2)
            }
            if nodes.isEmpty {
                Section { Text("Bu ay \(type == .expense ? "gider" : "gelir") yok.").foregroundStyle(.secondary) }
            } else {
                Section {
                    ForEach(nodes) { node in
                        if node.children.count > 1 {
                            DisclosureGroup(isExpanded: binding(node.id)) {
                                ForEach(node.children) { child in
                                    link(child, total: total, parent: node)
                                }
                            } label: {
                                row(node, total: total)
                            }
                        } else {
                            link(node, total: total, parent: nil)
                        }
                    }
                } footer: {
                    Text("Taksitli alımlar satın alma ayına tam tutarla yazılır; mutabakat ve yatırım anaparası hariç.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Kategori raporu")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func link(_ node: Node, total: Double, parent: Node?) -> some View {
        NavigationLink(value: CategoryTxRoute(
            title: node.category?.name ?? (parent?.category.map { "\($0.name) (genel)" } ?? "Kategorisiz"),
            categoryIds: node.ids, uncategorized: node.category == nil && parent == nil,
            month: month, type: type)) {
            row(node, total: total, indent: parent != nil)
        }
    }

    private func row(_ node: Node, total: Double, indent: Bool = false) -> some View {
        let share = total > 0 ? node.amount / total : 0
        let color = node.category.map { Color(hex: $0.color) } ?? .gray
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                if let c = node.category {
                    let i = Icons.category(c.icon)
                    IconBadge(symbol: i.symbol, emoji: i.emoji, color: color, size: indent ? 26 : 32)
                } else {
                    IconBadge(symbol: "questionmark", color: .gray, size: indent ? 26 : 32)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(node.category?.name ?? (indent ? "Genel" : "Kategorisiz")).lineLimit(1)
                    if node.previous > 0 || node.amount > 0 {
                        change(node.amount, node.previous, suffix: nil).font(.caption2)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(Fmt.currency(node.amount)).font(.subheadline.monospacedDigit().weight(.semibold))
                    Text("%\((share * 100).rounded().safeInt)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            ProgressView(value: share).tint(color)
        }
        .padding(.leading, indent ? 12 : 0)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    /// Geçen aya göre değişim; giderde artış kırmızı, gelirde yeşil.
    @ViewBuilder private func change(_ now: Double, _ before: Double, suffix: String?) -> some View {
        if before <= 0 {
            Text("yeni").font(.caption2).foregroundStyle(.secondary)
        } else {
            let pct = (now - before) / before * 100
            let up = pct >= 0
            if abs(pct) < 0.5 {
                Text("değişmedi").font(.caption2).foregroundStyle(.secondary)
            } else {
                let good = type == .expense ? !up : up
                HStack(spacing: 3) {
                    Image(systemName: up ? "arrow.up.right" : "arrow.down.right")
                    Text("%\(abs(pct).rounded().safeInt)")
                    if let suffix { Text(suffix).foregroundStyle(.secondary) }
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(good ? Theme.income : Theme.expense)
            }
        }
    }

    private func binding(_ id: String) -> Binding<Bool> {
        Binding(get: { expanded.contains(id) }, set: { v in
            if v { expanded.insert(id) } else { expanded.remove(id) }
        })
    }

    // MARK: Hesap

    /// `capDay`: yalnız ayın 1…capDay günleri (içinde bulunulan ayla adil kıyas)
    private func amounts(_ my: MonthYear, capDay: Int? = nil) -> [String: Double] {
        let r = DateUtil.monthRange(my)
        var to = r.to
        if let capDay, let last = Int(r.to.suffix(2)) {
            to = String(r.from.prefix(8)) + String(format: "%02d", min(capDay, last))
        }
        let inMonth = model.reportTransactions.filter { Calc.isFlow($0) && DateUtil.isInRange($0.date, r.from, to) }
        return Calc.amountByCategory(inMonth, type: type, fx: model.fx)
    }

    /// İçinde bulunulan ayda geçen ayın AYNI dönemiyle kıyaslanır
    private var isCurrentMonth: Bool { month == .current() }

    /// Üst kategoriler → doğrudan alt kategoriler (alt ağaçlarıyla); tutara göre ↓.
    private func report() -> ([Node], Double, Double) {
        let today = DateUtil.calendar.component(.day, from: Date())
        let now = amounts(month), prev = amounts(month.previous, capDay: isCurrentMonth ? today : nil)
        let cats = model.categories
        let byId = Dictionary(cats.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var children: [String: [String]] = [:]
        for c in cats { if let p = c.parentId, byId[p] != nil { children[p, default: []].append(c.id) } }
        func subtree(_ id: String) -> Set<String> {
            var out: Set<String> = [id]
            for ch in children[id] ?? [] { out.formUnion(subtree(ch)) }
            return out
        }
        func sum(_ ids: Set<String>, _ m: [String: Double]) -> Double { Money.sum(ids.compactMap { m[$0] }) }

        var nodes: [Node] = []
        let roots = cats.filter { $0.parentId.map { byId[$0] == nil } ?? true }
        for root in roots {
            let ids = subtree(root.id)
            let amount = sum(ids, now), previous = sum(ids, prev)
            guard amount > 0 || previous > 0 else { continue }
            var kids: [Node] = []
            let own = now[root.id] ?? 0, ownPrev = prev[root.id] ?? 0
            if own > 0 || ownPrev > 0 {
                kids.append(Node(id: root.id + ":own", category: nil, amount: own, previous: ownPrev, children: [], ids: [root.id]))
            }
            for ch in children[root.id] ?? [] {
                let cids = subtree(ch)
                let a = sum(cids, now), p = sum(cids, prev)
                if a > 0 || p > 0 { kids.append(Node(id: ch, category: byId[ch], amount: a, previous: p, children: [], ids: cids)) }
            }
            kids.sort { $0.amount > $1.amount }
            nodes.append(Node(id: root.id, category: root, amount: amount, previous: previous, children: kids, ids: ids))
        }
        // Kategorisiz ya da silinmiş kategoriye ait tutarlar
        let known = Set(cats.map(\.id))
        let orphanNow = Money.sum(now.filter { !known.contains($0.key) }.map(\.value))
        let orphanPrev = Money.sum(prev.filter { !known.contains($0.key) }.map(\.value))
        if orphanNow > 0 || orphanPrev > 0 {
            nodes.append(Node(id: "__none", category: nil, amount: orphanNow, previous: orphanPrev, children: [],
                              ids: Set(now.keys.filter { !known.contains($0) })))
        }
        nodes = nodes.filter { $0.amount > 0 }.sorted { $0.amount > $1.amount }
        return (nodes, Money.sum(now.map(\.value)), Money.sum(prev.map(\.value)))
    }
}

/// Bir kategorinin (alt ağacıyla) o aydaki işlemleri.
struct CategoryTransactionsView: View {
    @Environment(AppModel.self) private var model
    let route: CategoryTxRoute
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    private var txs: [Transaction] {
        let r = DateUtil.monthRange(route.month)
        return model.reportTransactions.filter { t in
            // Tutar kuralıyla aynı (amountByCategory): yatırım bağlı satırlar hariç
            t.type == route.type && t.icon == nil && Calc.isFlow(t) && DateUtil.isInRange(t.date, r.from, r.to)
                && Calc.categorySlices(t).contains { s in
                    if let c = s.categoryId, !c.isEmpty { return route.categoryIds.contains(c) }
                    return route.uncategorized
                }
        }
    }

    var body: some View {
        let list = txs
        TransactionList(transactions: list, editing: $editing, pendingDelete: $pendingDelete)
            .overlay { if list.isEmpty { ContentUnavailableView("İşlem yok", systemImage: "tray") } }
            .navigationTitle(route.title)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $editing) { TransactionFormView(editing: $0) }
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }
}
