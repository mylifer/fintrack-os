import SwiftUI
import FinTrackCore
import FinTrackData

/// Bütçe ekle / düzenle (web bütçe formu): bir ya da birden çok gider kategorisi,
/// aylık tutar, uyarı eşiği, devir. Başka bütçede kullanılan kategori seçilemez.
struct BudgetFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let editing: Budget?

    @State private var draft = BudgetDraft()
    @State private var query = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    private static let thresholds = [50, 60, 70, 75, 80, 85, 90, 95, 100]

    private var rows: [(cat: FinTrackCore.Category, depth: Int)] {
        let used = model.categoriesUsedByOtherBudgets(except: editing?.id)
        let cats = model.pickerCategories(for: .expense).filter { !used.contains($0.id) }
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
        NavigationStack {
            Form {
                Section {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("₺").font(.system(size: 26, weight: .semibold)).foregroundStyle(.secondary)
                        TextField("Aylık tutar", text: $draft.amountText)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 32, weight: .bold).monospacedDigit())
                            .onChange(of: draft.amountText) { _, v in
                                let fixed = Fmt.normalizeTypedAmount(v)
                                if fixed != v { draft.amountText = fixed }
                            }
                    }
                    Picker("Uyarı eşiği", selection: $draft.alertThreshold) {
                        ForEach(Self.thresholds, id: \.self) { Text("%\($0)").tag($0) }
                    }
                    Toggle("Artanı sonraki aya devret", isOn: $draft.rollover)
                } footer: {
                    Text("Devir yalnız bir önceki ayda harcanmayan tutarı ekler; aşım devretmez.")
                }
                Section {
                    ForEach(rows, id: \.cat.id) { row in
                        let selected = draft.categoryIds.contains(row.cat.id)
                        Button {
                            if selected { draft.categoryIds.removeAll { $0 == row.cat.id } }
                            else { draft.categoryIds.append(row.cat.id) }
                        } label: {
                            HStack(spacing: 10) {
                                let i = Icons.category(row.cat.icon)
                                IconBadge(symbol: i.symbol, emoji: i.emoji, color: Color(hex: row.cat.color), size: 28)
                                Text(row.cat.name).foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected ? Theme.tint : Color.secondary)
                            }
                            .padding(.leading, CGFloat(row.depth) * 20)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                } header: {
                    Text(draft.categoryIds.isEmpty ? "Kategori" : "Kategori (\(draft.categoryIds.count) seçili)")
                } footer: {
                    Text("Üst kategori seçilirse alt kategorilerin harcaması da sayılır.")
                }
                if editing != nil {
                    Section { Button("Bütçeyi sil", role: .destructive) { confirmDelete = true } }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Kategori ara")
            .disabled(busy)
            .navigationTitle(editing == nil ? "Yeni bütçe" : "Bütçeyi düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Kaydet", action: save).bold().disabled(draft.validationError() != nil)
                    }
                }
            }
            .alert("Kaydedilemedi", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("Tamam", role: .cancel) {}
            } message: { Text(errorMessage ?? "") }
            .confirmationDialog("Bütçe silinsin mi?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Sil", role: .destructive, action: delete)
            }
        }
        .onAppear { if let editing { draft = BudgetDraft(editing: editing) } }
    }

    private func save() {
        busy = true
        Task {
            do {
                try await model.saveBudget(draft, editing: editing)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }

    private func delete() {
        guard let editing else { return }
        busy = true
        Task {
            do {
                try await model.deleteBudget(editing)
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            busy = false
        }
    }
}
