import SwiftUI
import FinTrackCore
import FinTrackData

/// Alttan açılan hızlı ekleme / düzenleme sayfası. Başka kayıtlara bağlı
/// işlemler (taksit, borç, yatırım, bölünmüş…) salt okunur gösterilir.
struct TransactionFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: Transaction?
    /// Yeni işlem bir şablonla (kopya) açılıyorsa
    var template: TransactionDraft? = nil

    @State private var draft = TransactionDraft()
    @State private var categoryTouched = false
    @FocusState private var descriptionFocused: Bool
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @FocusState private var amountFocused: Bool

    private static let lastAccountKey = "fintrack.lastAccountId"
    private var readOnly: Bool { editing?.isLinked ?? false }
    private var account: Account? { model.account(draft.accountId) }

    var body: some View {
        NavigationStack {
            Form {
                if readOnly {
                    Section {
                        Label("Bu işlem başka kayıtlara bağlı (taksit, borç, yatırım ya da bölünmüş kategori). Düzenlemek ve silmek için web'i kullanın.",
                              systemImage: "link")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Picker("Tür", selection: $draft.type) {
                        ForEach(TransactionType.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(account?.currency.symbol ?? "₺")
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundStyle(.secondary)
                        TextField("0", text: $draft.amountText)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 40, weight: .bold).monospacedDigit())
                            .focused($amountFocused)
                            .onChange(of: draft.amountText) { _, v in
                                // Ondalık ayraç virgül (TR); nokta yazılırsa virgüle çevrilir
                                let fixed = v.replacingOccurrences(of: ".", with: ",")
                                if fixed != v { draft.amountText = fixed }
                            }
                    }
                    .padding(.vertical, 4)
                    TextField("Açıklama", text: $draft.description)
                        .focused($descriptionFocused)
                        .submitLabel(.done)
                    if !suggestions.isEmpty {
                        suggestionChips
                    }
                }

                Section {
                    Picker(draft.type == .transfer ? "Kaynak hesap" : "Hesap", selection: $draft.accountId) {
                        Text("Seçin").tag(String?.none)
                        ForEach(model.activeAccounts) { a in
                            Text("\(a.name) · \(a.currency.rawValue)").tag(Optional(a.id))
                        }
                    }
                    if draft.type == .transfer {
                        Picker("Hedef hesap", selection: $draft.toAccountId) {
                            Text("Seçin").tag(String?.none)
                            ForEach(model.activeAccounts.filter { $0.id != draft.accountId }) { a in
                                Text("\(a.name) · \(a.currency.rawValue)").tag(Optional(a.id))
                            }
                        }
                    } else {
                        NavigationLink {
                            CategoryPicker(type: draft.type, selection: Binding(
                                get: { draft.categoryId },
                                set: { draft.categoryId = $0; categoryTouched = true }
                            ))
                        } label: {
                            HStack {
                                Text("Kategori")
                                Spacer()
                                if let c = model.category(draft.categoryId) {
                                    let i = Icons.category(c.icon)
                                    IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color), size: 24)
                                    Text(c.name).foregroundStyle(.secondary)
                                } else {
                                    Text("Yok").foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    DatePicker("Tarih", selection: $draft.date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "tr_TR"))
                }

                Section {
                    TextField("Not", text: $draft.notes, axis: .vertical)
                        .lineLimit(1...4)
                }

                if DateUtil.day(draft.date) > DateUtil.today() && editing == nil {
                    Section {
                        Label("Gelecek tarihli işlem onay bekleyerek kaydedilir; tarihi gelince bildirim merkezinden (web) onaylanınca bakiyeye girer.",
                              systemImage: "clock")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if let editing, !readOnly {
                    Section {
                        Button("İşlemi sil", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Eklenme: \(DateUtil.display(editing.createdAt))")
                    }
                }
            }
            .disabled(readOnly || saving)
            .navigationTitle(editing == nil ? "Yeni işlem" : (readOnly ? "İşlem" : "İşlemi düzenle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(readOnly ? "Kapat" : "Vazgeç") { dismiss() }
                }
                if !readOnly {
                    ToolbarItem(placement: .confirmationAction) {
                        if saving { ProgressView() } else {
                            Button("Kaydet", action: save).bold()
                                .disabled(draft.validationError() != nil)
                        }
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(
                get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
            )) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("İşlem silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: delete)
            }
        }
        .presentationDetents([.large])
        .onAppear(perform: setUp)
        .onChange(of: draft.description) { _, d in
            // Daha önce aynı açıklamayla girilmiş işlemin kategorisi (kullanıcı
            // kategoriyi kendisi seçmediyse)
            guard editing == nil, !categoryTouched, draft.type != .transfer,
                  let c = Suggestions.exactCategory(d, type: draft.type, in: model.transactions),
                  model.category(c).map({ !$0.isArchived }) ?? false
            else { return }
            draft.categoryId = c
        }
        .onChange(of: draft.type) { _, newType in
            // Tür değişince uymayan kategori düşer
            if let c = model.category(draft.categoryId),
               c.scope != (newType == .income ? .income : .expense) {
                draft.categoryId = nil
            }
        }
    }

    private func setUp() {
        if let editing {
            draft = TransactionDraft(editing: editing)
        } else if let template {
            draft = template
            if model.account(draft.accountId).map({ $0.isArchived }) ?? true { draft.accountId = defaultAccountId }
            categoryTouched = true
            amountFocused = true
        } else {
            // Son kullanılan hesap; yoksa ilk TL nakit/vadesiz hesap
            draft.accountId = defaultAccountId
            amountFocused = true
        }
    }

    private var defaultAccountId: String? {
        let last = UserDefaults.standard.string(forKey: Self.lastAccountKey)
        let accounts = model.activeAccounts
        return accounts.first { $0.id == last }?.id
            ?? accounts.first { $0.currency == .TRY && ($0.type == .checking || $0.type == .cash) }?.id
            ?? accounts.first { $0.currency == .TRY }?.id
            ?? accounts.first?.id
    }

    private var suggestions: [Suggestions.Item] {
        guard editing == nil, descriptionFocused else { return [] }
        return Suggestions.matching(draft.description, in: model.transactions)
    }

    /// Geçmiş işlemlerden öneriler: dokununca açıklama, tür, kategori ve hesap dolar.
    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(suggestions, id: \.self) { item in
                    Button { apply(item) } label: {
                        HStack(spacing: 6) {
                            if let c = model.category(item.categoryId) {
                                let i = Icons.category(c.icon)
                                IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: c.color), size: 20)
                            }
                            Text(item.description).lineLimit(1)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Önerilen işlemi uygular")
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }

    private func apply(_ item: Suggestions.Item) {
        draft.description = item.description
        draft.type = item.type
        if model.category(item.categoryId).map({ !$0.isArchived }) ?? false {
            draft.categoryId = item.categoryId
        }
        if model.activeAccounts.contains(where: { $0.id == item.accountId }) {
            draft.accountId = item.accountId
        }
        categoryTouched = true
        descriptionFocused = false
        if draft.amountText.isEmpty { amountFocused = true }
    }

    private func save() {
        saving = true
        Task {
            do {
                try await model.save(draft, editing: editing)
                if editing == nil { UserDefaults.standard.set(draft.accountId, forKey: Self.lastAccountKey) }
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func delete() {
        guard let editing else { return }
        saving = true
        Task {
            do {
                try await model.delete(editing)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }
}

/// Üst kategoriler ve altları (girintili), aranabilir.
struct CategoryPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let type: TransactionType
    @Binding var selection: String?
    @State private var query = ""

    private var rows: [(cat: FinTrackCore.Category, depth: Int)] {
        let cats = model.pickerCategories(for: type)
        let q = query.lowercased(with: Locale(identifier: "tr_TR"))
        if !q.isEmpty {
            return cats.filter { $0.name.lowercased(with: Locale(identifier: "tr_TR")).contains(q) }.map { ($0, 0) }
        }
        let ids = Set(cats.map(\.id))
        var out: [(FinTrackCore.Category, Int)] = []
        func walk(_ parent: String?, _ depth: Int) {
            for c in cats where (c.parentId.flatMap { ids.contains($0) ? $0 : nil }) == parent {
                out.append((c, depth))
                walk(c.id, depth + 1)
            }
        }
        walk(nil, 0)
        return out
    }

    var body: some View {
        List {
            Button {
                selection = nil
                dismiss()
            } label: {
                HStack {
                    Text("Kategorisiz").foregroundStyle(.primary)
                    Spacer()
                    if selection == nil { Image(systemName: "checkmark").foregroundStyle(Theme.tint) }
                }
            }
            ForEach(rows, id: \.cat.id) { row in
                Button {
                    selection = row.cat.id
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        let i = Icons.category(row.cat.icon)
                        IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: row.cat.color), size: 28)
                        Text(row.cat.name).foregroundStyle(.primary)
                        Spacer()
                        if selection == row.cat.id {
                            Image(systemName: "checkmark").foregroundStyle(Theme.tint)
                        }
                    }
                    .padding(.leading, CGFloat(row.depth) * 20)
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Kategori ara")
        .navigationTitle("Kategori")
        .navigationBarTitleDisplayMode(.inline)
    }
}
