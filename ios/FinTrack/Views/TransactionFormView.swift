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
    /// Boş form bu türle açılsın (ana ekran kısayolu)
    var initialType: TransactionType? = nil

    @State private var draft = TransactionDraft()
    @State private var categoryTouched = false
    /// Son öneriden gelen kişiler: yeni öneri yalnız bunları (ya da boşları) değiştirir
    @State private var suggestedPeople: (family: String?, recipient: String?) = (nil, nil)
    @State private var savedCount = 0
    /// Yeni kaydın kimliği — tekrar denemede aynı satır (mükerrer olmasın)
    @State private var newId = UUID().uuidString.lowercased()
    @State private var installments = false
    @State private var installmentCount = 6
    /// Pay tutarı alanlarının yazılan metni (sıra → metin): biçimlenmiş sayıdan
    /// geri okunursa "12," yazarken virgül silinir, küsuratlı pay girilemezdi
    @State private var splitAmountTexts: [Int: String] = [:]
    @FocusState private var descriptionFocused: Bool
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var refunding = false
    @FocusState private var amountFocused: Bool

    private static let lastAccountKey = "fintrack.lastAccountId"
    /// Borç ödemesi / alacak tahsilatı düzenlenebilir (borç mutabakatıyla); diğer bağlılar salt okunur
    private var readOnly: Bool { editing.map { $0.isLinked && !$0.isPlainDebtLink && !$0.isPlainInstallment } ?? false }
    /// Taksitli grubun satırı düzenleniyor (tutar = grubun toplamı)
    private var editingGroup: Bool { editing?.isPlainInstallment == true }
    /// Taksit seçeneği: yeni gider, taksitli grup ya da sonradan taksitlendirilebilir tekil gider
    private var installmentAllowed: Bool {
        guard draft.type == .expense, draft.splits == nil || editing != nil else { return false }
        guard let editing else { return true }
        return editing.isPlainInstallment || Installments.isConvertible(editing)
    }
    private var account: Account? { model.account(draft.accountId) }

    var body: some View {
        NavigationStack {
            Form {
                if readOnly {
                    Section {
                        Label(editing?.isWorkspaceTransferLeg == true
                              ? "Çalışma alanları arası transfer: düzenlenemez. Silerseniz diğer alandaki bacak (ve varsa borç ödemesi) da silinir."
                              : editing?.isPlainRefund == true
                              ? "İade satırı: düzenlenemez; silinebilir (silinince iade geri alınır)."
                              : editing?.isPlainReconciliation == true
                              ? "Bakiye eşitleme satırı: gelir/gidere girmez, yalnız bakiyeyi düzeltir. Düzenleme web'de; silinebilir."
                              : "Bu işlem başka kayıtlara bağlı (taksit, borç, yatırım ya da bölünmüş kategori). Düzenlemek ve silmek için web'i kullanın.",
                              systemImage: "link")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Group {
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
                                    let fixed = Fmt.normalizeTypedAmount(v)
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

                    if draft.type == .income && (!model.receivables.isEmpty || draft.isCollection) {
                        Section {
                            Picker("Gelir türü", selection: $draft.isCollection) {
                                Text("Gelir").tag(false)
                                Text("Alacak tahsilatı").tag(true)
                            }
                            .pickerStyle(.segmented)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                        } footer: {
                            if draft.isCollection {
                                Text("Verdiğiniz borcun geri ödemesi: para hesaba girer, alacaktan düşer; gelir sayılmaz.")
                            }
                        }
                    }

                    if model.interestApplies(draft, editing: editing) {
                        interestSection
                    }

                    Section {
                        Picker(draft.type == .transfer ? "Kaynak hesap" : "Hesap", selection: $draft.accountId) {
                            Text("Seçin").tag(String?.none)
                            ForEach(model.activeAccounts) { a in
                                Text("\(a.name) · \(a.currency.rawValue)").tag(Optional(a.id))
                            }
                        }
                        if draft.type == .transfer {
                            transferTargetRows
                        } else if draft.isDebtCollection {
                            receivableRows
                        } else if draft.splits != nil {
                            splitRows
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
                            if !readOnly && !installments {
                                Button { startSplit() } label: {
                                    Label("Kategorilere böl", systemImage: "square.split.2x1")
                                }
                                .font(.subheadline)
                            }
                        }
                        if draft.type != .transfer && !draft.isDebtCollection {
                            PersonPicker(title: "Aile üyesi", role: .familyMember, selection: $draft.familyMemberId)
                            PersonPicker(title: "Alıcı", role: .recipient, selection: $draft.recipientId)
                        }
                        DatePicker("Tarih", selection: $draft.date, displayedComponents: .date)
                            .environment(\.locale, Locale(identifier: "tr_TR"))
                        if draft.type == .expense {
                            Toggle(isOn: $draft.isSubscription) {
                                Label("Abonelik", systemImage: "repeat.circle")
                            }
                            if installmentAllowed {
                                Toggle(isOn: $installments.animation()) {
                                    Label(editingGroup ? "Taksitli (tutar = toplam)" : "Taksitli", systemImage: "square.stack.3d.up")
                                }
                                .disabled(editingGroup)
                                if installments {
                                    Stepper(value: $installmentCount, in: Installments.countRange) {
                                        LabeledContent("Taksit sayısı", value: "\(installmentCount)")
                                    }
                                    HStack(spacing: 8) {
                                        ForEach([3, 6, 9, 12, 18, 24], id: \.self) { n in
                                            Button("\(n)") { installmentCount = n }
                                                .font(.subheadline.monospacedDigit().weight(installmentCount == n ? .bold : .regular))
                                                .frame(maxWidth: .infinity, minHeight: 30)
                                                .background(installmentCount == n ? Theme.accent.opacity(0.25) : Color(.tertiarySystemFill),
                                                            in: Capsule())
                                                .buttonStyle(.plain)
                                                .accessibilityLabel("\(n) taksit")
                                        }
                                    }
                                    Text(installmentSummary)
                                        .font(.footnote).foregroundStyle(.secondary)
                                    if editingGroup {
                                        Text("Değişiklik tüm taksitlere uygulanır; sayı azalırsa fazla taksitler silinir.")
                                            .font(.footnote).foregroundStyle(.secondary)
                                    } else if editing != nil {
                                        Text("Bu işlem 1. taksit olur, kalanlar sonraki aylara eklenir.")
                                            .font(.footnote).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }

                    Section {
                        TagEditor(tags: $draft.tags, known: model.knownTags,
                                  onSubscriptionTag: draft.type == .expense ? { draft.isSubscription = true } : nil)
                    } header: {
                        Text("Etiketler")
                    }

                    Section {
                        TextField("Not", text: $draft.notes, axis: .vertical)
                            .lineLimit(1...4)
                    }

                    if editing == nil && !draft.isCrossWorkspace {
                        Section {
                            Button {
                                save(another: true)
                            } label: {
                                Label("Kaydet ve yenisini ekle", systemImage: "plus.circle")
                            }
                            .disabled(draft.validationError() != nil)
                        } footer: {
                            if savedCount > 0 {
                                Text("Bu oturumda \(savedCount) işlem kaydedildi.")
                            }
                        }
                    }

                    if DateUtil.day(draft.date) > DateUtil.today() && editing == nil {
                        Section {
                            Label("Gelecek tarihli işlem onay bekleyerek kaydedilir; tarihi gelince Özet'teki \"Onay bekliyor\" kartından onaylayın.",
                                  systemImage: "clock")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                }
                .disabled(readOnly || saving)

                if let editing, Calc.awaitsApproval(editing) {
                    Section {
                        Button {
                            approve(editing)
                        } label: {
                            Label(DateUtil.day(draft.date) > DateUtil.today() ? "Şimdi onayla" : "Onayla",
                                  systemImage: "checkmark.circle.fill")
                        }
                        .disabled(saving)
                    } footer: {
                        Text("Onaylanan işlem tarihi gelince bakiyeye girer.")
                    }
                }

                if let editing, editing.plannedRecurringId == nil, editing.isLive {
                    ReceiptSection(transaction: editing)
                }

                if let editing, Refund.canRefund(editing) {
                    Section {
                        Button { refunding = true } label: { Label("İade işle", systemImage: "arrow.uturn.backward.circle") }
                    } footer: {
                        let r = model.refundRemaining(editing)
                        if r < editing.amount { Text("Daha önce \(Fmt.currency(Money.sub(editing.amount, r), editing.currency)) iade edildi.") }
                    }
                }

                if let editing, editing.canDeleteOnIOS {
                    Section {
                        Button("İşlemi sil", role: .destructive) { confirmDelete = true }
                            .disabled(saving)
                    } footer: {
                        Text("Eklenme: \(DateUtil.display(editing.createdAt))")
                    }
                }
            }
            .navigationTitle(editing == nil ? "Yeni işlem" : (readOnly ? "İşlem" : "İşlemi düzenle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(readOnly ? "Kapat" : "Vazgeç") { dismiss() }
                }
                if !readOnly {
                    ToolbarItem(placement: .confirmationAction) {
                        if saving { ProgressView() } else {
                            Button("Kaydet") { save() }.bold()
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
            } message: {
                if let editing {
                    if model.linkedInterestTax(editing) != nil {
                        Text("Bağlı stopaj gideri de silinir.")
                    } else if editing.isWorkspaceTransferLeg {
                        Text("Diğer çalışma alanındaki bacak (ve varsa borç ödemesi) da silinir.")
                    } else if editing.isPlainDebtLink {
                        Text(editing.isPlainDebtCollection ? "Tutar alacağa geri eklenir." : "Tutar borcun ödenen kısmından düşülür.")
                    }
                }
            }
        }
        .presentationDetents([.large])
        .sheet(isPresented: $refunding) { if let editing { RefundSheet(original: editing) } }
        .onAppear(perform: setUp)
        .onChange(of: draft.description) { _, d in
            // Daha önce aynı açıklamayla girilmiş işlemin kategorisi (kullanıcı
            // kategoriyi kendisi seçmediyse)
            guard editing == nil, !categoryTouched, draft.type != .transfer, !draft.isCollection,
                  let c = model.derived?.suggestionIndex.exactCategory(d, type: draft.type)
                      ?? Suggestions.exactCategory(d, type: draft.type, in: model.transactions),
                  model.category(c).map({ !$0.isArchived }) ?? false
            else { return }
            draft.categoryId = c
        }
        // Web'de "Ödeme tipi" tek seçim: abonelik ve taksit birlikte olmaz
        // Var olan taksit grubu açılırken setUp de bu bayrağı açar: grubun payları
        // ve etiketi o zaman silinmemeli (kaydedince tüm taksitlerden düşerdi)
        .onChange(of: installments) { _, on in
            if on && !editingGroup { draft.isSubscription = false; draft.splits = nil }
        }
        .onChange(of: draft.isSubscription) { _, on in if on && !editingGroup { installments = false } }
        .onChange(of: draft.type) { _, newType in
            // Tür değişince uymayan kategori düşer
            if let c = model.category(draft.categoryId),
               c.scope != (newType == .income ? .income : .expense) {
                draft.categoryId = nil
            }
            if newType != .income { draft.isCollection = false }
            if newType != .transfer { draft.transferTarget = .account }
            draft.splits = nil   // paylar kapsama bağlı (gider/gelir kategorileri)
        }
        .onChange(of: draft.transferTarget) { old, new in
            // Hedef türü değişince başka türün seçimi kalmasın
            if old == .workspace || new == .workspace { draft.toAccountId = nil }
            if new != .debt && !draft.isCollection { draft.debtId = nil }
        }
        .onChange(of: draft.isCollection) { _, on in
            if on { draft.categoryId = nil } else if draft.transferTarget != .debt { draft.debtId = nil }
        }
        .onChange(of: draft.targetWorkspaceId) { _, _ in
            draft.toAccountId = nil
            draft.targetDebtId = nil
        }
    }

    // MARK: Transfer hedefi (web "Hesap | Borç | Diğer Alan")

    private var transferTargets: [TransactionDraft.TransferTarget] {
        var out: [TransactionDraft.TransferTarget] = [.account]
        if !model.payableDebts.isEmpty || draft.transferTarget == .debt { out.append(.debt) }
        if editing == nil && !model.otherWorkspaces.isEmpty { out.append(.workspace) }
        return out
    }

    private func targetLabel(_ t: TransactionDraft.TransferTarget) -> String {
        switch t {
        case .account: "Hesaba"
        case .debt: "Borca"
        case .workspace: "Diğer alana"
        }
    }

    @ViewBuilder private var transferTargetRows: some View {
        if transferTargets.count > 1 {
            Picker("Hedef", selection: $draft.transferTarget) {
                ForEach(transferTargets, id: \.self) { Text(targetLabel($0)).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        switch draft.transferTarget {
        case .account:
            Picker("Hedef hesap", selection: $draft.toAccountId) {
                Text("Seçin").tag(String?.none)
                ForEach(model.activeAccounts.filter { $0.id != draft.accountId }) { a in
                    Text("\(a.name) · \(a.currency.rawValue)").tag(Optional(a.id))
                }
            }
        case .debt:
            Picker("Borç", selection: Binding(get: { draft.debtId }, set: { id in
                draft.debtId = id
                if let d = model.debts.first(where: { $0.id == id }),
                   draft.description.trimmingCharacters(in: .whitespaces).isEmpty {
                    draft.description = d.name
                }
            })) {
                Text("Seçin").tag(String?.none)
                ForEach(debtChoices(model.payableDebts)) { d in
                    Text("\(d.name) · kalan \(Fmt.currency(d.remaining))").tag(Optional(d.id))
                }
            }
        case .workspace:
            Picker("Çalışma alanı", selection: $draft.targetWorkspaceId) {
                Text("Seçin").tag(String?.none)
                ForEach(model.otherWorkspaces) { Text($0.name).tag(Optional($0.id)) }
            }
            if let ws = draft.targetWorkspaceId {
                Picker("Para ne olacak", selection: $draft.crossPayDebt) {
                    Text("Hesaba yatır").tag(false)
                    Text("Borç öde").tag(true)
                }
                .pickerStyle(.segmented)
                if draft.crossPayDebt {
                    let debts = model.payableDebts(inWorkspace: ws)
                    if debts.isEmpty {
                        Text("Bu alanda aktif borç yok").foregroundStyle(.secondary)
                    } else {
                        Picker("Borç", selection: Binding(get: { draft.targetDebtId }, set: { id in
                            draft.targetDebtId = id
                            guard let d = debts.first(where: { $0.id == id }) else { return }
                            // Borcun kendi ödeme hesabı bu alandaysa ara hesap olarak öner
                            if let a = d.accountId, model.accounts(inWorkspace: ws).contains(where: { $0.id == a }) {
                                draft.toAccountId = a
                            }
                            if draft.description.trimmingCharacters(in: .whitespaces).isEmpty {
                                draft.description = "\(d.name) ödemesi"
                            }
                        })) {
                            Text("Seçin").tag(String?.none)
                            ForEach(debts) { Text("\($0.name) · kalan \(Fmt.currency($0.remaining))").tag(Optional($0.id)) }
                        }
                    }
                }
                let targets = model.accounts(inWorkspace: ws)
                if targets.isEmpty {
                    Text("Bu alanda hesap bulunamadı").foregroundStyle(.secondary)
                } else {
                    Picker(draft.crossPayDebt ? "Ödemenin geçeceği hesap" : "Hedef hesap", selection: $draft.toAccountId) {
                        Text("Seçin").tag(String?.none)
                        ForEach(targets) { Text("\($0.name) · \($0.currency.rawValue)").tag(Optional($0.id)) }
                    }
                }
                Text(draft.crossPayDebt
                     ? "Para seçilen hesaba girer ve borca ödenir — o hesabın bakiyesi değişmez. Hiçbir alanda gelir/gider sayılmaz."
                     : "İki alanda da gelir/gider sayılmaz; yalnız bakiyeler değişir.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    /// Seçilebilir borçlar + düzenlenen satırın borcu (kapanmış olsa da)
    private func debtChoices(_ list: [Debt]) -> [Debt] {
        guard let id = draft.debtId, !list.contains(where: { $0.id == id }),
              let current = model.debts.first(where: { $0.id == id }) else { return list }
        return [current] + list
    }

    // MARK: Kategori bölme (web categorySplits)

    private func startSplit() {
        let total = abs(draft.amount)
        let first = draft.categoryId ?? ""
        let parts = Money.split(total, 2)
        draft.splits = [CategorySplit(categoryId: first, amount: parts.first ?? 0),
                        CategorySplit(categoryId: "", amount: parts.last ?? 0)]
        installments = false
    }

    @ViewBuilder private var splitRows: some View {
        let splits = draft.splits ?? []
        ForEach(Array(splits.enumerated()), id: \.offset) { i, sp in
            HStack(spacing: 8) {
                NavigationLink {
                    CategoryPicker(type: draft.type, selection: Binding(
                        get: { (draft.splits?[safe: i]?.categoryId).flatMap { $0.isEmpty ? nil : $0 } },
                        set: { if draft.splits?.indices.contains(i) == true { draft.splits?[i].categoryId = $0 ?? "" } }
                    ))
                } label: {
                    if let c = model.category(sp.categoryId) {
                        let ic = Icons.category(c.icon)
                        HStack(spacing: 6) {
                            IconBadge(symbol: ic.symbol, emoji: ic.emoji, color: Color(hex: c.color), size: 22)
                            Text(c.name).lineLimit(1)
                        }
                    } else {
                        Text("Kategori seçin").foregroundStyle(Theme.expense)
                    }
                }
                TextField("0", text: Binding(
                    get: {
                        guard let amount = draft.splits?[safe: i]?.amount else { return "" }
                        // Yazılan metin hâlâ aynı tutarı veriyorsa olduğu gibi göster
                        if let t = splitAmountTexts[i], Fmt.parseAmount(t) == amount { return t }
                        return amount == 0 ? "" : Fmt.amountInput(amount)
                    },
                    set: {
                        guard draft.splits?.indices.contains(i) == true else { return }
                        let text = Fmt.normalizeTypedAmount($0)
                        splitAmountTexts[i] = text
                        draft.splits?[i].amount = Fmt.parseAmount(text)
                    }
                ))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 96)
            }
            .swipeActions {
                if splits.count > 2 {
                    Button(role: .destructive) { draft.splits?.remove(at: i) } label: { Label("Sil", systemImage: "trash") }
                }
            }
        }
        let rem = draft.splitRemainder
        HStack {
            Button { draft.splits?.append(CategorySplit(categoryId: "", amount: max(0, rem))) } label: {
                Label("Pay ekle", systemImage: "plus")
            }
            Spacer()
            Button("Eşit dağıt") {
                let n = draft.splits?.count ?? 0
                let parts = Money.split(abs(draft.amount), max(n, 1))
                for j in 0..<n { draft.splits?[j].amount = parts[j] }
            }
        }
        .buttonStyle(.borderless)
        .font(.subheadline)
        HStack {
            Text(rem == 0 ? "Paylar tutarla eşit" : "Kalan \(Fmt.currency(rem, account?.currency ?? .TRY))")
                .font(.footnote).foregroundStyle(rem == 0 ? Theme.income : Theme.warning)
            Spacer()
            Button("Bölmeyi kaldır", role: .destructive) {
                draft.categoryId = draft.splits.flatMap(TransactionDraft.primaryCategory) ?? draft.categoryId
                draft.splits = nil
            }
            .font(.footnote)
            .buttonStyle(.borderless)
        }
    }

    // MARK: Alacak tahsilatı

    private var selectedReceivable: Debt? { model.debts.first { $0.id == draft.debtId } }

    /// Kalan alacak (düzenlenen tahsilatın eski payı geri eklenir — web)
    private var receivableRemaining: Double? {
        guard let d = selectedReceivable else { return nil }
        let own = editing.flatMap { $0.isPlainDebtCollection && $0.debtId == d.id ? model.fx.baseAmount($0) : nil } ?? 0
        return Money.add(d.remaining, own)
    }

    @ViewBuilder private var receivableRows: some View {
        Picker("Alacak", selection: Binding(get: { draft.debtId }, set: { id in
            draft.debtId = id
            if let d = model.debts.first(where: { $0.id == id }),
               draft.description.trimmingCharacters(in: .whitespaces).isEmpty {
                draft.description = "\(d.name) tahsilatı"
            }
        })) {
            Text("Seçin").tag(String?.none)
            ForEach(debtChoices(model.receivables)) { d in
                Text("\(d.name) · kalan \(Fmt.currency(d.remaining))").tag(Optional(d.id))
            }
        }
        if let remaining = receivableRemaining {
            let tryValue = model.fx.toBaseTry(draft.amount, account?.currency ?? .TRY)
            let over = tryValue > remaining + 0.005
            LabeledContent("Kalan alacak", value: Fmt.currency(remaining))
            if draft.amount > 0 {
                LabeledContent("Kayıttan sonra", value: over ? "Tutar kalandan fazla" : Fmt.currency(max(0, Money.sub(remaining, tryValue))))
                    .foregroundStyle(over ? Theme.expense : .secondary)
            }
        }
    }

    // MARK: Faiz stopajı (web Brüt · Stopaj · Hesaba geçen)

    @ViewBuilder private var interestSection: some View {
        let split = draft.interestSplit(account: account)
        let cur = account?.currency ?? .TRY
        Section {
            Picker("Girdiğim tutar", selection: $draft.interestMode) {
                Text("Net (hesaba geçen)").tag(InterestTax.Mode.net)
                Text("Brüt faiz").tag(InterestTax.Mode.gross)
            }
            .pickerStyle(.segmented)
            HStack {
                Text("Stopaj oranı")
                Spacer()
                Text("%").foregroundStyle(.secondary)
                TextField(Fmt.amountInput(draft.interestRate(account: account)), text: Binding(
                    get: { draft.interestRateText ?? Fmt.amountInput(draft.interestRate(account: account)) },
                    set: { draft.interestRateText = Fmt.normalizeTypedAmount($0) }
                ))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
            }
            HStack(spacing: 0) {
                interestCell("Brüt faiz", Fmt.currency(split.gross, cur), Theme.income, "Gelir · Faiz")
                Divider()
                interestCell("Stopaj", "−" + Fmt.currency(split.tax, cur), Theme.expense, "Gider · Vergi")
                Divider()
                interestCell("Hesaba geçen", Fmt.currency(split.net, cur), .primary, "Net")
            }
        } header: {
            Text("Stopaj")
        } footer: {
            Text("Faiz geliri brüt yazılır; stopaj Vergi kategorisine, alıcısı İTC olan ayrı gider olarak eklenir. Hesaba etkisi net tutardır.")
        }
    }

    private func interestCell(_ title: String, _ value: String, _ color: Color, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased(with: Locale(identifier: "tr_TR"))).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }

    private func setUp() {
        if let editing {
            draft = TransactionDraft(editing: editing)
            if editing.isPlainInstallment, let g = editing.installGroupId {
                // Grup düzenlemesi: tutar = taksitlerin toplamı, tarih = ilk taksit
                let rows = model.transactions.filter { $0.installGroupId == g }
                    .sorted { ($0.installIndex ?? 0) < ($1.installIndex ?? 0) }
                let total = Money.sum(rows.map(\.amount))
                draft.amountText = Fmt.amountInput(total)
                // Paylar ilk taksitin tutarında; form toplamı gösterdiği için toplama ölçeklenir
                // (regroup her taksite yeniden oranlar)
                if let sp = draft.splits { draft.splits = Refund.rescaleSplits(sp, to: abs(total)) }
                if let first = rows.first { draft.date = DateUtil.parseDay(first.date) ?? draft.date }
                installments = true
                installmentCount = max(rows.count, 2)
            }
            if let tax = model.linkedInterestTax(editing) {
                draft.interestRateText = Fmt.amountInput(InterestTax.impliedRate(gross: editing.amount, tax: tax.amount))
            }
        } else if let template {
            draft = template
            if model.account(draft.accountId).map({ $0.isArchived }) ?? true { draft.accountId = defaultAccountId }
            categoryTouched = true
            amountFocused = true
        } else {
            // Son kullanılan hesap; yoksa ilk TL nakit/vadesiz hesap
            if let initialType { draft.type = initialType }
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

    /// "6 × ₺1.666,67" — artan kuruşlar ilk taksitlerde (web splitMoney)
    private var installmentSummary: String {
        let cur = account?.currency ?? .TRY
        guard draft.amount > 0 else { return "Toplam tutarı girin; aylık taksitler eşit bölünür." }
        let parts = Money.split(draft.amount, installmentCount)
        let first = parts.first ?? 0, rest = parts.last ?? 0
        let head = first == rest ? "\(installmentCount) × \(Fmt.currency(rest, cur))"
                                 : "İlk taksit \(Fmt.currency(first, cur)), sonra \(installmentCount - 1) × \(Fmt.currency(rest, cur))"
        let end = DateUtil.calendar.date(byAdding: .month, value: installmentCount - 1, to: draft.date).map { DateUtil.display(DateUtil.day($0), "MMMM yyyy") } ?? ""
        let limitNote = account?.type == .credit_card ? " Tüm tutar kart limitinden bugün düşer." : ""
        return "\(head) · son taksit \(end). Açıklama ve kategori zorunlu.\(limitNote)"
    }

    private var suggestions: [Suggestions.Item] {
        guard editing == nil, descriptionFocused else { return [] }
        if let idx = model.derived?.suggestionIndex { return idx.matching(draft.description) }
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
        // Kişiler (web onSelect gibi öneriden gelir, boşsa temizlenir) — yalnız
        // etkin alanın seçilebilir kişileri; kullanıcının elle seçtiği korunur
        func valid(_ id: String?, _ role: Person.Role) -> String? {
            model.pickerPeople(role).contains { $0.id == id } ? id : nil
        }
        let fam = valid(item.familyMemberId, .familyMember), rec = valid(item.recipientId, .recipient)
        if draft.familyMemberId == nil || draft.familyMemberId == suggestedPeople.family { draft.familyMemberId = fam }
        if draft.recipientId == nil || draft.recipientId == suggestedPeople.recipient { draft.recipientId = rec }
        suggestedPeople = (fam, rec)
        categoryTouched = true
        descriptionFocused = false
        if draft.amountText.isEmpty { amountFocused = true }
    }

    /// `another`: kaydettikten sonra formu kapatma; tür, hesap, tarih ve etiketler kalsın.
    private func save(another: Bool = false) {
        saving = true
        Task {
            do {
                if let editing, installments && draft.type == .expense
                    && (editing.isPlainInstallment || Installments.isConvertible(editing)) {
                    try await model.saveInstallmentGroup(draft, editing: editing, count: installmentCount, seed: newId)
                } else if editing == nil && installments && draft.type == .expense {
                    try await model.saveInstallments(draft, count: installmentCount, seed: newId)
                } else {
                    try await model.save(draft, editing: editing, newId: newId)
                }
                if editing == nil { UserDefaults.standard.set(draft.accountId, forKey: Self.lastAccountKey) }
                Haptics.success()
                if another {
                    savedCount += 1
                    newId = UUID().uuidString.lowercased()
                    var next = TransactionDraft()
                    next.type = draft.type
                    next.accountId = draft.accountId
                    next.toAccountId = draft.toAccountId
                    next.date = draft.date
                    next.tags = draft.tags   // art arda girişte (ör. #Tatil) etiket kalsın
                    draft = next
                    installments = false
                    categoryTouched = false
                    suggestedPeople = (nil, nil)
                    amountFocused = true
                    saving = false
                    return
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            saving = false
        }
    }

    private func approve(_ t: Transaction) {
        saving = true
        Task {
            do {
                // Formda kaydedilmemiş düzenleme varsa önce onu yaz (onay kaybettirmesin)
                var target = t
                if !readOnly, draft != TransactionDraft(editing: t) {
                    try await model.save(draft, editing: t)
                    target = model.transactions.first { $0.id == t.id } ?? t
                }
                try await model.approve(target)
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

extension Array {
    /// Sınır dışında nil (bağlamalarda silinen paya erişim çökmesin)
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
