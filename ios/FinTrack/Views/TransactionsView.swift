import SwiftUI
import FinTrackCore
import FinTrackData

struct TransactionsView: View {
    @Environment(AppModel.self) private var model
    @Binding var quickAdd: Bool
    @State private var query = ""
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            TransactionList(transactions: filtered, editing: $editing, pendingDelete: $pendingDelete)
                .overlay {
                    if filtered.isEmpty {
                        if query.isEmpty {
                            ContentUnavailableView("Henüz işlem yok", systemImage: "list.bullet.rectangle",
                                                   description: Text("Sağ üstteki + ile ilk işlemi ekleyin."))
                        } else {
                            ContentUnavailableView.search(text: query)
                        }
                    }
                }
                .searchable(text: $query, prompt: "Açıklama, kategori, hesap, tutar")
                .refreshable { await model.refresh() }
                .navigationTitle("İşlemler")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { AddButton(isPresented: $quickAdd) } }
                .sheet(item: $editing) { TransactionFormView(editing: $0) }
                .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
        }
    }

    private var filtered: [Transaction] {
        let match = TxSearch.matcher(query, categories: model.categories, accounts: model.accounts)
        return model.transactions.filter(match)
    }
}

/// Günlere bölünmüş işlem listesi; satırı kaydırarak düzenle / sil.
struct TransactionList: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router
    let transactions: [Transaction]
    var perspectiveAccountId: String?
    @Binding var editing: Transaction?
    @Binding var pendingDelete: Transaction?

    /// Gelecek/onay bekleyen satırlar en üstte ayrı bölümde.
    private var sections: [(title: String, items: [Transaction])] {
        let today = DateUtil.today()
        let upcoming = transactions.filter { !Calc.isPosted($0, asOf: today) }
        var out: [(String, [Transaction])] = []
        if !upcoming.isEmpty { out.append(("Planlı ve onay bekleyen", upcoming.reversed())) }
        var current: String?
        var bucket: [Transaction] = []
        for t in transactions where Calc.isPosted(t, asOf: today) {
            let d = String(t.date.prefix(10))
            if d != current {
                if let c = current { out.append((DateUtil.sectionTitle(c, today: today), bucket)) }
                current = d
                bucket = []
            }
            bucket.append(t)
        }
        if let c = current { out.append((DateUtil.sectionTitle(c, today: today), bucket)) }
        return out
    }

    var body: some View {
        List {
            ForEach(sections, id: \.title) { section in
                Section(section.title) {
                    ForEach(section.items) { t in
                        Button { editing = t } label: {
                            TransactionRow(t: t, perspectiveAccountId: perspectiveAccountId)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !t.isLinked {
                                Button(role: .destructive) { pendingDelete = t } label: {
                                    Label("Sil", systemImage: "trash")
                                }
                            }
                            Button { editing = t } label: {
                                Label(t.isLinked ? "Görüntüle" : "Düzenle", systemImage: t.isLinked ? "eye" : "pencil")
                            }
                            .tint(Theme.planned)
                        }
                        .swipeActions(edge: .leading) {
                            if !t.isLinked {
                                Button { router.duplicate(t) } label: {
                                    Label("Kopyala", systemImage: "plus.square.on.square")
                                }
                                .tint(Theme.income)
                            }
                        }
                        .contextMenu {
                            Button { editing = t } label: {
                                Label(t.isLinked ? "Görüntüle" : "Düzenle", systemImage: t.isLinked ? "eye" : "pencil")
                            }
                            if !t.isLinked {
                                Button { router.duplicate(t) } label: {
                                    Label("Kopyasını ekle", systemImage: "plus.square.on.square")
                                }
                                Button(role: .destructive) { pendingDelete = t } label: {
                                    Label("Sil", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

extension View {
    /// Silme onayı + hata uyarısı (işlem tombstone'lanır; web'de geri alınabilir değil).
    func deleteConfirmation(_ item: Binding<Transaction?>, errorMessage: Binding<String?>) -> some View {
        modifier(DeleteConfirmation(item: item, errorMessage: errorMessage))
    }
}

private struct DeleteConfirmation: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var item: Transaction?
    @Binding var errorMessage: String?

    func body(content: Content) -> some View {
        content
            .confirmationDialog("İşlem silinsin mi?", isPresented: Binding(
                get: { item != nil }, set: { if !$0 { item = nil } }
            ), titleVisibility: .visible, presenting: item) { t in
                Button("Sil", role: .destructive) {
                    Task {
                        do {
                            try await model.delete(t)
                            Haptics.success()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
            } message: { t in
                Text("\(t.description.isEmpty ? t.type.label : t.description) · \(Fmt.currency(t.amount, t.currency))")
            }
            .alert("Silinemedi", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
            )) {
                Button("Tamam", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
    }
}
