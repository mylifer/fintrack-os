import SwiftUI
import FinTrackCore
import FinTrackData

/// Görünen (süzülen) işlemleri toplu düzenle / sil (web BatchEditDrawer).
struct BulkEditSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let transactions: [Transaction]

    @State private var setCategory = false
    @State private var categoryId: String?
    @State private var categoryScope: TransactionType = .expense
    @State private var setFamily = false
    @State private var familyId: String?
    @State private var setRecipient = false
    @State private var recipientId: String?
    @State private var setDate = false
    @State private var date = Date()
    @State private var tagsText = ""
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    private var editable: [Transaction] { transactions.filter(BulkEdit.canEdit) }
    private var deletable: [Transaction] { transactions.filter { $0.plannedRecurringId == nil && $0.canDeleteOnIOS } }

    private var patch: BulkEdit.Patch {
        BulkEdit.Patch(categoryId: setCategory ? .some(categoryId) : nil,
                       familyMemberId: setFamily ? .some(familyId) : nil,
                       recipientId: setRecipient ? .some(recipientId) : nil,
                       date: setDate ? DateUtil.day(date) : nil,
                       addTags: tagsText.split(separator: ",").map { String($0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(transactions.count) işlem seçili (\(editable.count) düzenlenebilir).")
                        .font(.subheadline)
                } footer: {
                    Text("Önce İşlemler'de arama ya da süzgeçle listeyi daraltın; burada yalnız görünenler değişir. Yatırım, transfer bacağı ve sistem satırları atlanır.")
                }
                Section {
                    Toggle("Kategori ata", isOn: $setCategory)
                    if setCategory {
                        Picker("Tür", selection: $categoryScope) {
                            Text("Gider").tag(TransactionType.expense)
                            Text("Gelir").tag(TransactionType.income)
                        }
                        .pickerStyle(.segmented)
                        NavigationLink {
                            CategoryPicker(type: categoryScope, selection: $categoryId)
                        } label: {
                            LabeledContent("Kategori", value: model.category(categoryId)?.name ?? "Seçin")
                        }
                        Text("Bölünmüş işlemler tek kategoriye iner.").font(.caption).foregroundStyle(.secondary)
                    }
                    Toggle("Aile üyesi ata", isOn: $setFamily)
                    if setFamily { PersonPicker(title: "Aile üyesi", role: .familyMember, selection: $familyId) }
                    Toggle("Alıcı ata", isOn: $setRecipient)
                    if setRecipient { PersonPicker(title: "Alıcı", role: .recipient, selection: $recipientId) }
                    Toggle("Tarihi değiştir", isOn: $setDate)
                    if setDate {
                        DatePicker("Tarih", selection: $date, displayedComponents: .date)
                            .environment(\.locale, Locale(identifier: "tr_TR"))
                    }
                    TextField("Etiket ekle (virgülle)", text: $tagsText)
                        .textInputAutocapitalization(.never)
                }
                Section {
                    Button("\(deletable.count) işlemi sil", role: .destructive) { confirmDelete = true }
                        .disabled(deletable.isEmpty)
                } footer: {
                    Text("Taksitlerde tüm grup, borç ödemelerinde borç da geri alınır.")
                }
            }
            .disabled(busy)
            .navigationTitle("Toplu düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Uygula", action: apply).bold()
                            .disabled(patch.isEmpty || editable.isEmpty || (setCategory && categoryId == nil))
                    }
                }
            }
            .confirmationDialog("\(deletable.count) işlem silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: deleteAll)
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
        }
    }

    private func apply() {
        busy = true
        Task {
            do { try await model.bulkUpdate(editable, patch); Haptics.success(); dismiss() }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func deleteAll() {
        busy = true
        Task {
            do { try await model.bulkDelete(deletable); Haptics.success(); dismiss() }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
