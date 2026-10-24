import SwiftUI
import FinTrackCore
import FinTrackData

/// Öğeleri satıra dizer, sığmayanı alt satıra geçirir (etiket çipleri).
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
                                  proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
                x += min(size.width, bounds.width) + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            let w = min(size.width, width)
            if !rows[rows.count - 1].items.isEmpty, rows[rows.count - 1].width + spacing + w > width {
                rows.append(Row())
            }
            var r = rows[rows.count - 1]
            r.width += (r.items.isEmpty ? 0 : spacing) + w
            r.height = max(r.height, size.height)
            r.items.append(i)
            rows[rows.count - 1] = r
        }
        return rows.filter { !$0.items.isEmpty }
    }
}

/// "#etiket" çipi; web ile aynı renk (Tags.color).
struct TagChip: View {
    let tag: String
    var onRemove: (() -> Void)? = nil

    var body: some View {
        let color = Color(hex: Tags.color(Tags.key(tag)))
        HStack(spacing: 4) {
            Text("#").fontWeight(.bold)
            Text(tag).lineLimit(1)
            if let onRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark").font(.caption2.weight(.bold))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, -8).padding(.trailing, -8)
                .accessibilityLabel("\(tag) etiketini kaldır")
            }
        }
        .font(.subheadline)
        .foregroundStyle(color)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(color.opacity(0.12), in: Capsule())
    }
}

/// Formdaki etiket alanı: eklenenler çip olarak, yazarken var olan etiketlerden
/// öneri. Kayıtta web kuralıyla temizlenir (Tags.dedupe).
struct TagEditor: View {
    @Binding var tags: [String]
    /// Kullanımdaki etiketler (en çok kullanılan önce)
    let known: [Tags.Aggregate]
    /// "abonelik" yazılırsa (gider) ayrı anahtar açılır
    var onSubscriptionTag: (() -> Void)? = nil
    @State private var text = ""
    @FocusState private var focused: Bool

    private var suggestions: [String] {
        let have = Set(tags.map(Tags.key))
        let q = Tags.key(text)
        return known.lazy
            .filter { !have.contains($0.key) && !Subscriptions.isSubscriptionTag($0.tag) && (q.isEmpty || $0.key.contains(q)) }
            .prefix(q.isEmpty ? 6 : 8)
            .map(\.tag)
    }

    var body: some View {
        if !tags.isEmpty {
            FlowLayout {
                ForEach(Array(tags.enumerated()), id: \.offset) { i, t in
                    TagChip(tag: t) { if tags.indices.contains(i) { tags.remove(at: i) } }
                }
            }
            .padding(.vertical, 2)
        }
        HStack {
            Image(systemName: "number").foregroundStyle(.secondary)
            TextField("Etiket ekle", text: $text)
                .focused($focused)
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit { add(text) }
            if !Tags.normalize(text).isEmpty {
                Button("Ekle") { add(text) }.buttonStyle(.borderless)
            }
        }
        let s = suggestions
        if (focused || !text.isEmpty) && !s.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(s, id: \.self) { t in
                        Button { add(t) } label: { TagChip(tag: t) }.buttonStyle(.plain)
                            .accessibilityLabel("\(t) etiketini ekle")
                    }
                }
            }
        }
    }

    private func add(_ raw: String) {
        let n = Tags.normalize(raw.hasPrefix("#") ? String(raw.dropFirst()) : raw)
        defer { text = "" }
        guard !n.isEmpty, !tags.contains(where: { Tags.key($0) == Tags.key(n) }) else { return }
        // Abonelik ayrı anahtarla (yalnız gider); gelir/transferde eklenmez
        if Subscriptions.isSubscriptionTag(n) {
            if let onSubscriptionTag { onSubscriptionTag() } else { Haptics.warning() }
            return
        }
        tags.append(n)
        Haptics.tap()
    }
}

struct TagsRoute: Hashable {}
struct TagRoute: Hashable { var key: String; var tag: String }

/// Etiketler (web /tags): kullanılan her etiket, işlem sayısı ve TRY toplamları.
/// Yeniden adlandırma çok satırı birden yazar; web'de.
struct TagsView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        let all = model.knownTags
        let q = Tags.key(query)
        let list = q.isEmpty ? all : all.filter { $0.key.contains(q) }
        List {
            if !list.isEmpty {
                Section {
                    ForEach(list) { t in
                        NavigationLink(value: TagRoute(key: t.key, tag: t.tag)) { row(t) }
                    }
                } footer: {
                    Text("Etiket eklemek için işlemi açın. Yeniden adlandırma web'de.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if model.derived == nil {
                ProgressView()
            } else if list.isEmpty {
                if q.isEmpty {
                    ContentUnavailableView("Henüz etiket yok", systemImage: "number",
                                           description: Text("İşlem eklerken etiket atadığınızda burada görünür."))
                } else {
                    ContentUnavailableView.search(text: query)
                }
            }
        }
        .searchable(text: $query, prompt: "Etiket ara")
        .navigationTitle("Etiketler")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ t: Tags.Aggregate) -> some View {
        let color = Color(hex: Tags.color(t.key))
        return HStack(spacing: 12) {
            Text("#").font(.headline).foregroundStyle(color)
                .frame(width: 32, height: 32)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(t.tag).lineLimit(1)
                Text("\(t.count) işlem").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.currency(t.volume)).font(.subheadline.monospacedDigit().weight(.semibold)).lineLimit(1)
                HStack(spacing: 4) {
                    if t.expense > 0 { Text("−\(Fmt.whole(t.expense))").foregroundStyle(Theme.expense) }
                    if t.income > 0 { Text("+\(Fmt.whole(t.income))").foregroundStyle(Theme.income) }
                }
                .font(.caption2.monospacedDigit())
                .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Bir etiketin işlemleri (web /tags/[tag]); üstte gelir/gider toplamı.
struct TagTransactionsView: View {
    @Environment(AppModel.self) private var model
    let route: TagRoute
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    var body: some View {
        let list = model.transactions.filter { Tags.has($0, key: route.key) }
        // Web etiket detayı: taksitler toplu, yalnız akışa giren (işlenmiş,
        // mutabakat/anapara hariç) satırlar
        let flowTxs = model.reportTransactions.filter { Tags.has($0, key: route.key) && Calc.isFlow($0) }
        let flow = Calc.periodFlow(flowTxs, from: "0000-01-01", to: "9999-12-31", fx: model.fx)
        TransactionList(transactions: list, editing: $editing, pendingDelete: $pendingDelete,
                        header: list.isEmpty ? nil : AnyView(header(count: flowTxs.count, flow)))
            .overlay { if list.isEmpty { ContentUnavailableView("İşlem yok", systemImage: "tray") } }
            .navigationTitle("#\(route.tag)")
            .navigationBarTitleDisplayMode(.inline)
            .transactionEditor($editing)
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }

    private func header(count: Int, _ f: Calc.Flow) -> some View {
        HStack(spacing: 14) {
            Text("\(count) işlem").font(.subheadline.bold())
            Spacer()
            if f.expense > 0 {
                Label(Fmt.currency(f.expense), systemImage: "arrow.up.right").foregroundStyle(Theme.expense)
            }
            if f.income > 0 {
                Label(Fmt.currency(f.income), systemImage: "arrow.down.left").foregroundStyle(Theme.income)
            }
        }
        .font(.subheadline.monospacedDigit())
        .labelStyle(.titleAndIcon)
        .accessibilityElement(children: .combine)
    }
}
