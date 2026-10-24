import SwiftUI
import FinTrackCore
import FinTrackData

// MARK: - Kategoriler (web /categories)

struct CategoriesManageView: View {
    @Environment(AppModel.self) private var model
    @State private var scope: CategoryScope = .expense
    @State private var showArchived = false
    @State private var editing: CategoryRoute?
    @State private var errorMessage: String?

    struct CategoryRoute: Identifiable {
        var category: Category?
        var parentId: String?
        var id: String { (category?.id ?? "new") + (parentId ?? "") }
    }

    private var rows: [(cat: Category, depth: Int)] {
        let cats = model.categories.filter { $0.scope == scope && (showArchived || !$0.isArchived) }
        let ids = Set(cats.map(\.id))
        var out: [(Category, Int)] = []
        func walk(_ parent: String?, _ depth: Int) {
            let kids = cats.filter { (($0.parentId).flatMap { ids.contains($0) ? $0 : nil }) == parent }
                .sorted { $0.name.compare($1.name, locale: Locale(identifier: "tr_TR")) == .orderedAscending }
            for c in kids {
                out.append((c, depth))
                walk(c.id, depth + 1)
            }
        }
        walk(nil, 0)
        return out
    }

    var body: some View {
        List {
            Section {
                Picker("Kapsam", selection: $scope) {
                    Text("Gider").tag(CategoryScope.expense)
                    Text("Gelir").tag(CategoryScope.income)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                ForEach(rows, id: \.cat.id) { row in
                    Button { editing = CategoryRoute(category: row.cat) } label: {
                        HStack(spacing: 10) {
                            let i = Icons.category(row.cat.icon)
                            IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: row.cat.color), size: 28)
                            Text(row.cat.name).foregroundStyle(row.cat.isArchived ? .secondary : .primary)
                            if row.cat.isArchived { Text("arşiv").font(.caption2).foregroundStyle(.secondary) }
                            Spacer()
                            let kw = CategoryDraft.keywords(row.cat)
                            if !kw.isEmpty { Image(systemName: "wand.and.stars").font(.caption).foregroundStyle(.secondary) }
                        }
                        .padding(.leading, CGFloat(row.depth) * 20)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if !row.cat.isSystem || row.cat.isArchived {
                            Button(row.cat.isArchived ? "Geri getir" : "Arşivle") { archive(row.cat, !row.cat.isArchived) }
                                .tint(row.cat.isArchived ? Theme.income : .orange)
                        }
                        if CategoryDraft.level(row.cat.id, model.categories) < 2 && !row.cat.isArchived {
                            Button("Alt ekle") { editing = CategoryRoute(parentId: row.cat.id) }.tint(Theme.tint)
                        }
                    }
                }
            } footer: {
                Text("Arşivlenen kategori seçicilerde gizlenir; geçmiş işlemler adını göstermeye devam eder. Sola kaydırın: arşivle / alt kategori ekle.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Kategoriler")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { editing = CategoryRoute() } label: { Image(systemName: "plus") }.accessibilityLabel("Kategori ekle")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Toggle(isOn: $showArchived) { Image(systemName: "archivebox") }.toggleStyle(.button)
                    .accessibilityLabel("Arşivlenmişleri göster")
            }
        }
        .sheet(item: $editing) { r in CategoryFormView(editing: r.category, scope: scope, parentId: r.parentId) }
        .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func archive(_ c: Category, _ on: Bool) {
        Task {
            do { try await model.setCategoryArchived(c, on); Haptics.success() }
            catch { errorMessage = error.localizedDescription }
        }
    }
}

struct CategoryFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: Category?
    var scope: CategoryScope = .expense
    var parentId: String? = nil

    @State private var draft = CategoryDraft()
    @State private var newId = UUID().uuidString.lowercased()
    @State private var busy = false
    @State private var errorMessage: String?

    static let palette = ["#6366F1", "#EF4444", "#F97316", "#F59E0B", "#10B981", "#14B8A6", "#3B82F6",
                          "#8B5CF6", "#EC4899", "#6B7280", "#84CC16", "#0EA5E9"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Kategori adı", text: $draft.name)
                    Picker("Üst kategori", selection: $draft.parentId) {
                        Text("Yok (ana kategori)").tag(String?.none)
                        ForEach(CategoryDraft.parentChoices(for: editing, scope: draft.scope, model.categories)) { c in
                            Text(String(repeating: "   ", count: CategoryDraft.level(c.id, model.categories)) + c.name).tag(Optional(c.id))
                        }
                    }
                }
                Section("Simge ve renk") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Self.palette, id: \.self) { c in
                                Circle().fill(Color(hex: c)).frame(width: 28, height: 28)
                                    .overlay { if draft.color == c { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white) } }
                                    .onTapGesture { draft.color = c }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 7), spacing: 8) {
                        ForEach(Icons.tablerNames, id: \.self) { name in
                            let i = Icons.category(name)
                            IconBadge(symbol: i.symbol, emoji: i.emoji,
                                      color: draft.icon == name ? Color(hex: draft.color) : Color(.systemGray3), size: 34)
                                .onTapGesture { draft.icon = name }
                                .accessibilityLabel(name)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    TextField("örn. migros, a101, şok", text: $draft.keywordsText, axis: .vertical)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Otomatik kategori kelimeleri")
                } footer: {
                    Text("İşlem açıklaması bu kelimelerden birini içerirse kategori kendiliğinden seçilir (web'de).")
                }
                if let editing, !editing.isSystem || editing.isArchived {
                    Section {
                        Button(editing.isArchived ? "Arşivden çıkar" : "Arşivle", role: editing.isArchived ? nil : .destructive) {
                            archive(!editing.isArchived)
                        }
                    }
                }
            }
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni kategori" : "Kategoriyi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Kaydet", action: save).bold()
                            .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
        .onAppear {
            draft = editing.map(CategoryDraft.init(editing:)) ?? CategoryDraft(scope: scope, parentId: parentId)
            if let p = parentId, editing == nil, let parent = model.category(p) { draft.color = parent.color }
        }
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.saveCategory(draft, editing: editing, newId: newId)
                Haptics.success()
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func archive(_ on: Bool) {
        guard let editing else { return }
        busy = true
        Task {
            do { try await model.setCategoryArchived(editing, on); Haptics.success(); dismiss() }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}

// MARK: - Kişiler (web /aile-uyeleri, /alicilar)

struct PeopleManageView: View {
    @Environment(AppModel.self) private var model
    @State private var role: Person.Role = .familyMember
    @State private var showArchived = false
    @State private var adding = false
    @State private var renaming: Person?
    @State private var nameText = ""
    @State private var errorMessage: String?

    private var list: [Person] { model.people.filter { $0.role == role && (showArchived || !$0.isArchived) } }

    var body: some View {
        List {
            Section {
                Picker("Rol", selection: $role) {
                    Text("Aile üyeleri").tag(Person.Role.familyMember)
                    Text("Alıcılar").tag(Person.Role.recipient)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                ForEach(list) { p in
                    NavigationLink {
                        PersonDetailView(person: p)
                    } label: {
                        HStack {
                            Text(p.name).foregroundStyle(p.isArchived ? .secondary : .primary)
                            if p.isArchived { Text("arşiv").font(.caption2).foregroundStyle(.secondary) }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(p.isArchived ? "Geri getir" : "Arşivle") { setArchived(p, !p.isArchived) }
                            .tint(p.isArchived ? Theme.income : .orange)
                        Button("Yeniden adlandır") { nameText = p.name; renaming = p }.tint(Theme.tint)
                    }
                }
            } footer: {
                Text(role == .familyMember
                     ? "Harcamayı kimin yaptığı (eş, çocuk…). Arşivlenen kişi seçicilerde gizlenir; bağlı işlemler adını göstermeye devam eder."
                     : "Paranın gittiği yer (mağaza, kurum, kişi). Arşivlenen kişi seçicilerde gizlenir.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Kişiler")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { nameText = ""; adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Kişi ekle")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Toggle(isOn: $showArchived) { Image(systemName: "archivebox") }.toggleStyle(.button)
            }
        }
        .alert(role == .familyMember ? "Yeni aile üyesi" : "Yeni alıcı", isPresented: $adding) {
            TextField("Ad", text: $nameText)
            Button("Ekle") { add() }
            Button("Vazgeç", role: .cancel) {}
        }
        .alert("Yeniden adlandır", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Ad", text: $nameText)
            Button("Kaydet") { rename() }
            Button("Vazgeç", role: .cancel) {}
        }
        .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func add() {
        let n = nameText
        Task {
            do { try await model.addPerson(n, role: role); Haptics.success() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func rename() {
        guard let p = renaming else { return }
        let n = nameText
        renaming = nil
        Task {
            do { try await model.renamePerson(p, to: n); Haptics.success() }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func setArchived(_ p: Person, _ on: Bool) {
        Task {
            do { try await model.setPersonArchived(p, on); Haptics.success() }
            catch { errorMessage = error.localizedDescription }
        }
    }
}

// MARK: - Çalışma alanları

struct WorkspacesManageView: View {
    @Environment(AppModel.self) private var model
    @State private var joining = false
    @State private var inviteText = ""
    @State private var adding = false
    @State private var renaming: Workspace?
    @State private var nameText = ""
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                ForEach(model.workspaces) { w in
                    Button { model.setActiveWorkspace(w.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(w.name).foregroundStyle(.primary)
                                if w.isDefault { Text("Varsayılan").font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            if w.id == model.activeWorkspaceId { Image(systemName: "checkmark").foregroundStyle(Theme.tint) }
                        }
                    }
                    .swipeActions(edge: .trailing) {
                        if model.isOwner(w) {
                            Button("Yeniden adlandır") { nameText = w.name; renaming = w }.tint(Theme.tint)
                        }
                    }
                }
            } footer: {
                Text("Dokunun: alana geçin. Sola kaydırın: yeniden adlandırın.")
            }
            Section {
                ForEach(model.workspaces.filter { !$0.isDefault }) { w in
                    NavigationLink { WorkspaceSharingView(workspace: w) } label: {
                        HStack {
                            Text(w.name)
                            Spacer()
                            Text(model.isSharedWithMe(w) ? "benimle paylaşıldı" : "paylaş").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Button { inviteText = ""; joining = true } label: { Label("Davetle bir alana katıl", systemImage: "person.badge.plus") }
            } header: {
                Text("Paylaşım")
            } footer: {
                Text("Eşinizle ortak bütçe için ayrı bir alan açıp davet bağlantısı gönderin; o kendi hesabıyla katılır ve alanın tüm verisini görür, düzenler. Varsayılan alan paylaşılamaz.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Çalışma alanları")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { nameText = ""; adding = true } label: { Image(systemName: "plus") }.accessibilityLabel("Alan ekle")
            }
        }
        .alert("Davetle katıl", isPresented: $joining) {
            TextField("Davet bağlantısı ya da kodu", text: $inviteText)
            Button("Katıl") {
                let t = inviteText
                Task {
                    do { try await model.acceptInvite(t); Haptics.success() }
                    catch { errorMessage = error.localizedDescription }
                }
            }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Size gönderilen bağlantıyı yapıştırın.")
        }
        .alert("Yeni çalışma alanı", isPresented: $adding) {
            TextField("Ad (örn. Ev, İş)", text: $nameText)
            Button("Ekle") {
                let n = nameText
                Task {
                    do { try await model.addWorkspace(n); Haptics.success() }
                    catch { errorMessage = error.localizedDescription }
                }
            }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("Yeni alanda hesaplarınızı ve kategorilerinizi ayrı tutarsınız.")
        }
        .alert("Yeniden adlandır", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Ad", text: $nameText)
            Button("Kaydet") {
                guard let w = renaming else { return }
                let n = nameText
                renaming = nil
                Task {
                    do { try await model.renameWorkspace(w, to: n); Haptics.success() }
                    catch { errorMessage = error.localizedDescription }
                }
            }
            Button("Vazgeç", role: .cancel) {}
        }
        .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }
}

/// Kişinin işlemleri (web /aile-uyeleri/[id], /alicilar/[id]); üstte gelir/gider toplamı.
struct PersonDetailView: View {
    @Environment(AppModel.self) private var model
    let person: Person
    @State private var editing: Transaction?
    @State private var pendingDelete: Transaction?
    @State private var errorMessage: String?

    private func matches(_ t: Transaction) -> Bool {
        person.role == .familyMember ? t.familyMemberId == person.id : t.recipientId == person.id
    }

    var body: some View {
        let list = model.transactions.filter(matches)
        let flowTxs = model.reportTransactions.filter { matches($0) && Calc.isFlow($0) }
        let flow = Calc.periodFlow(flowTxs, from: "0000-01-01", to: "9999-12-31", fx: model.fx)
        TransactionList(transactions: list, editing: $editing, pendingDelete: $pendingDelete,
                        header: list.isEmpty ? nil : AnyView(
                            HStack(spacing: 14) {
                                Text("\(flowTxs.count) işlem").font(.subheadline.bold())
                                Spacer()
                                if flow.expense > 0 { Label(Fmt.currency(flow.expense), systemImage: "arrow.up.right").foregroundStyle(Theme.expense) }
                                if flow.income > 0 { Label(Fmt.currency(flow.income), systemImage: "arrow.down.left").foregroundStyle(Theme.income) }
                            }
                            .font(.subheadline.monospacedDigit())
                            .labelStyle(.titleAndIcon)
                        ))
            .overlay { if list.isEmpty { ContentUnavailableView("İşlem yok", systemImage: "tray") } }
            .navigationTitle(model.person(person.id)?.name ?? person.name)
            .navigationBarTitleDisplayMode(.inline)
            .transactionEditor($editing)
            .deleteConfirmation($pendingDelete, errorMessage: $errorMessage)
    }
}

/// Bir alanın paylaşımı (web SharingSettings): üyeler, davet bağlantısı, çıkar / ayrıl.
struct WorkspaceSharingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let workspace: Workspace
    @State private var members: [AppModel.Member] = []
    @State private var loading = true
    @State private var link: URL?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmLeave = false

    var body: some View {
        List {
            Section("Üyeler") {
                if loading { ProgressView() }
                ForEach(members) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.email ?? "—")
                            Text(m.role == "owner" ? "Sahip" : "Düzenleyebilir").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .swipeActions {
                        if model.isOwner(workspace) && m.role != "owner" {
                            Button("Çıkar", role: .destructive) { run { try await model.removeMember(m); await load() } }
                        }
                    }
                }
                if !loading && members.isEmpty { Text("Henüz kimseyle paylaşılmadı").foregroundStyle(.secondary) }
            }
            if model.isOwner(workspace) {
                Section {
                    if let link {
                        ShareLink(item: link, subject: Text("FinTrack davet"),
                                  message: Text("FinTrack'te \"\(workspace.name)\" alanına katıl")) {
                            Label("Bağlantıyı gönder", systemImage: "square.and.arrow.up")
                        }
                        Text(link.absoluteString).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                    } else {
                        Button { createLink() } label: { Label("Davet bağlantısı oluştur", systemImage: "link") }
                            .disabled(busy)
                    }
                } footer: {
                    Text("Bağlantı tek kullanımlık ve 7 gün geçerli. Karşı taraf web'de açabilir ya da iPhone'da Çalışma alanları → Davetle katıl'a yapıştırır.")
                }
            } else {
                Section {
                    Button("Bu alandan ayrıl", role: .destructive) { confirmLeave = true }
                } footer: {
                    Text("Ayrılınca alanın verisi bu hesapta görünmez; alan sahibinde kalır.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(workspace.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Alandan ayrılınsın mı?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Ayrıl", role: .destructive) { run { try await model.leaveWorkspace(workspace); dismiss() } }
        }
        .alert("İşlem yapılamadı", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        loading = true
        do { members = try await model.members(of: workspace) } catch { errorMessage = error.localizedDescription }
        loading = false
    }

    private func createLink() {
        busy = true
        Task {
            do { link = try await model.createInviteLink(workspace, base: WebLinks.base).url }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func run(_ op: @escaping () async throws -> Void) {
        Task {
            do { try await op(); Haptics.success() } catch { errorMessage = error.localizedDescription }
        }
    }
}
