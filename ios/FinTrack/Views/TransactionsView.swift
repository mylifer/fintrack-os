import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import FinTrackCore
import FinTrackData

/// İşlem listesi süzgeci: tür, hesap, dönem.
struct TxFilter: Equatable {
    enum Period: String, CaseIterable {
        case all, thisMonth, lastMonth, last3
        var label: String {
            switch self {
            case .all: "Tüm zamanlar"
            case .thisMonth: "Bu ay"
            case .lastMonth: "Geçen ay"
            case .last3: "Son 3 ay"
            }
        }
    }

    var type: TransactionType?
    var accountId: String?
    var period: Period = .all
    var pendingOnly = false

    var isActive: Bool { type != nil || accountId != nil || period != .all || pendingOnly }

    /// Dönemin [başlangıç, bitiş] günleri; tüm zamanlar için nil.
    var range: (from: String, to: String)? {
        let now = MonthYear.current()
        switch period {
        case .all: return nil
        case .thisMonth: return DateUtil.monthRange(now)
        case .lastMonth: return DateUtil.monthRange(now.previous)
        case .last3: return (DateUtil.monthRange(now.previous.previous).from, DateUtil.monthRange(now).to)
        }
    }

    func matches(_ t: Transaction) -> Bool {
        if let type, t.type != type { return false }
        if let a = accountId, !Calc.touchesAccount(t, a) { return false }
        if pendingOnly && !Calc.awaitsApproval(t) { return false }
        if let r = range, !DateUtil.isInRange(t.date, r.from, r.to) { return false }
        return true
    }
}

struct TransactionsView: View {
    @Environment(AppModel.self) private var model
    @Binding var quickAdd: Bool
    @State private var query = ""
    @State private var filter = TxFilter()
    @AppStorage("fintrack.showPlanned") private var showPlanned = true
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            let list = filtered
            TransactionList(transactions: list, editing: $editing, pendingDelete: $pendingDelete,
                            header: (filter.isActive || !query.isEmpty) && !list.isEmpty ? AnyView(totals(list)) : nil)
                .overlay {
                    if list.isEmpty {
                        if !query.isEmpty {
                            ContentUnavailableView.search(text: query)
                        } else if filter.isActive {
                            ContentUnavailableView {
                                Label("Eşleşen işlem yok", systemImage: "line.3.horizontal.decrease.circle")
                            } actions: {
                                Button("Süzgeci temizle") { filter = TxFilter() }
                            }
                        } else {
                            ContentUnavailableView("Henüz işlem yok", systemImage: "list.bullet.rectangle",
                                                   description: Text("Sağ üstteki + ile ilk işlemi ekleyin."))
                        }
                    }
                }
                .searchable(text: $query, prompt: "Açıklama, kategori, hesap, tutar")
                .refreshable { await model.refresh() }
                .navigationTitle("İşlemler")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { filterMenu }
                    ToolbarItem(placement: .topBarTrailing) { AddButton(isPresented: $quickAdd) }
                }
                .sheet(item: $editing) { t in
                    if let rid = t.plannedRecurringId, let r = model.recurring.first(where: { $0.id == rid }) {
                        NavigationStack { RecurringDetailView(template: r) }
                    } else {
                        TransactionFormView(editing: t)
                    }
                }
                .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
                .onAppear {
                    #if DEBUG
                    // `-search <metin>` (simülatör ekran doğrulaması)
                    let args = ProcessInfo.processInfo.arguments
                    if query.isEmpty, let i = args.firstIndex(of: "-search"), i + 1 < args.count { query = args[i + 1] }
                    #endif
                }
        }
    }

    private var filtered: [Transaction] {
        let match = TxSearch.matcher(query, categories: model.categories, accounts: model.accounts)
        let base = model.transactions.filter { filter.matches($0) && match($0) }
        let extra = planned.filter { filter.matches($0) && match($0) }
        guard !extra.isEmpty else { return base }
        // Listeyle aynı sıra: tarih ↓, sonra eklenme ↓
        return (extra + base).sorted {
            let a = $0.date.prefix(10), b = $1.date.prefix(10)
            return a != b ? a > b : $0.createdAt > $1.createdAt
        }
    }

    /// Tekrarlayanların önümüzdeki 60 gündeki dönemleri (yazılmaz; web "Gelecek
    /// işlemler"). Bugünkiler Özet'teki onay kartında.
    private var planned: [Transaction] {
        guard showPlanned, !model.recurring.isEmpty,
              let t = DateUtil.parseDay(DateUtil.today()),
              let tomorrow = DateUtil.calendar.date(byAdding: .day, value: 1, to: t),
              let h = DateUtil.calendar.date(byAdding: .day, value: 60, to: t) else { return [] }
        let existing = Set(model.transactions.map(\.id))
        return Recurrence.plannedTransactions(model.recurring, today: DateUtil.day(tomorrow), horizon: DateUtil.day(h),
                                              existingIds: existing, fx: model.fx)
    }

    private var filterMenu: some View {
        Menu {
            Picker("Tür", selection: $filter.type) {
                Text("Tüm türler").tag(TransactionType?.none)
                ForEach(TransactionType.allCases, id: \.self) { Text($0.label).tag(Optional($0)) }
            }
            Picker("Dönem", selection: $filter.period) {
                ForEach(TxFilter.Period.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Menu {
                Picker("Hesap", selection: $filter.accountId) {
                    Text("Tüm hesaplar").tag(String?.none)
                    ForEach(model.activeAccounts) { Text($0.name).tag(Optional($0.id)) }
                }
            } label: {
                Label(model.account(filter.accountId)?.name ?? "Hesap", systemImage: "building.columns")
            }
            Toggle("Yalnız onay bekleyenler", isOn: $filter.pendingOnly)
            Toggle("Tekrarlayanların gelecek dönemleri", isOn: $showPlanned)
            if filter.isActive {
                Divider()
                Button("Süzgeci temizle", role: .destructive) { filter = TxFilter() }
            }
            Divider()
            ShareLink(item: CSVFile(transactions: filtered, categories: model.categories,
                                    accounts: model.accounts, name: csvName),
                      preview: SharePreview("FinTrack işlemleri (\(filtered.count))")) {
                Label("CSV olarak paylaş (\(filtered.count))", systemImage: "square.and.arrow.up")
            }
        } label: {
            Image(systemName: filter.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .accessibilityLabel(filter.isActive ? "Süzgeç açık" : "Süz")
    }

    private var csvName: String {
        "fintrack-islemler-\(DateUtil.today())"
    }

    /// Görünen işlemlerin toplamı (gelir/gider akışı: mutabakat ve anapara hariç, web ile aynı).
    private func totals(_ list: [Transaction]) -> some View {
        let flow = Calc.periodFlow(list, from: "0000-01-01", to: "9999-12-31", fx: model.fx)
        return HStack(spacing: 14) {
            Text("\(list.count) işlem").font(.subheadline.bold())
            Spacer()
            if flow.expense > 0 {
                Label(Fmt.currency(flow.expense), systemImage: "arrow.up.right")
                    .foregroundStyle(Theme.expense)
            }
            if flow.income > 0 {
                Label(Fmt.currency(flow.income), systemImage: "arrow.down.left")
                    .foregroundStyle(Theme.income)
            }
        }
        .font(.subheadline.monospacedDigit())
        .labelStyle(.titleAndIcon)
        .accessibilityElement(children: .combine)
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
    /// Listenin üstünde ayrı bölüm (ör. arama/süzgeç toplamı)
    var header: AnyView? = nil

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
            if let header { Section { header } }
            ForEach(sections, id: \.title) { section in
                Section(section.title) {
                    ForEach(section.items) { t in
                        Button { editing = t } label: {
                            TransactionRow(t: t, perspectiveAccountId: perspectiveAccountId)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if t.canDeleteOnIOS {
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
                            if Calc.awaitsApproval(t) {
                                Button { approve(t) } label: { Label("Onayla", systemImage: "checkmark") }
                                    .tint(Theme.accent)
                            }
                            if !t.isLinked {
                                Button { router.duplicate(t) } label: {
                                    Label("Kopyala", systemImage: "plus.square.on.square")
                                }
                                .tint(Theme.income)
                            }
                        }
                        .contextMenu {
                            if Calc.awaitsApproval(t) {
                                Button { approve(t) } label: { Label("Onayla", systemImage: "checkmark") }
                            }
                            Button { editing = t } label: {
                                Label(t.isLinked ? "Görüntüle" : "Düzenle", systemImage: t.isLinked ? "eye" : "pencil")
                            }
                            if !t.isLinked {
                                Button { router.duplicate(t) } label: {
                                    Label("Kopyasını ekle", systemImage: "plus.square.on.square")
                                }
                            }
                            if t.canDeleteOnIOS {
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

    private func approve(_ t: Transaction) {
        Task {
            do {
                try await model.approve(t)
                Haptics.success()
            } catch {
                Haptics.warning()
            }
        }
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
                Text("\(t.description.isEmpty ? t.type.label : t.description) · \(Fmt.currency(t.amount, t.currency))"
                     + (t.isPlainDebtPayment ? "\nBorcun ödenen tutarından da düşülür." : "")
                     + (t.isPlainInstallment ? "\nTüm taksitler (\(t.installTotal ?? 0)) silinir." : ""))
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

/// Paylaşılacak CSV dosyası (UTF-8 BOM: Excel Türkçe karakterleri doğru açar).
/// Metin yalnız paylaşım anında üretilir (menü her çizildiğinde değil).
struct CSVFile: Transferable {
    let transactions: [Transaction]
    let categories: [FinTrackCore.Category]
    let accounts: [Account]
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { file in
            let text = CSVExport.transactions(file.transactions, categories: file.categories, accounts: file.accounts)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(file.name).csv")
            try (Data([0xEF, 0xBB, 0xBF]) + Data(text.utf8)).write(to: url, options: [.atomic, .completeFileProtection])
            return SentTransferredFile(url)
        }
    }
}
