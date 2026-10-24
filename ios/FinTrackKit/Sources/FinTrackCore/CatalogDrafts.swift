import Foundation

/* ── Kategori, kişi ve çalışma alanı yazımı — web categories.store,
   CategoryEditModal, people.store, workspace.store ───────────────────────── */

// MARK: - Kategori

public struct CategoryDraft: Equatable, Sendable {
    public var name = ""
    public var icon = "package"
    public var color = "#6366F1"
    public var scope: CategoryScope = .expense
    public var parentId: String?
    /// Otomatik kategori kelimeleri, virgülle (web matchKeywords)
    public var keywordsText = ""
    private var initialKeywords = ""

    public init(scope: CategoryScope = .expense, parentId: String? = nil) {
        self.scope = scope
        self.parentId = parentId
    }

    public init(editing c: Category) {
        name = c.name
        icon = c.icon.isEmpty ? "package" : c.icon
        color = c.color
        scope = c.scope
        parentId = c.parentId
        keywordsText = Self.keywords(c).joined(separator: ", ")
        initialKeywords = keywordsText
    }

    public static func keywords(_ c: Category) -> [String] {
        c.raw["matchKeywords"]?.array?.compactMap(\.string) ?? []
    }

    /// Web normalizeKeyword + parseKeywords: tr küçük harf, boşluk sadeleştirme, tekil
    public static func parseKeywords(_ raw: String) -> [String] {
        var out: [String] = []
        for part in raw.split(separator: ",") {
            let k = part.lowercased(with: Locale(identifier: "tr_TR"))
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            if !k.isEmpty && !out.contains(k) { out.append(k) }
        }
        return out
    }

    /// Seviye: kök 0, alt 1, alt-alt 2 (arşivliler dahil)
    public static func level(_ id: String, _ cats: [Category]) -> Int {
        guard let c = cats.first(where: { $0.id == id }), let p = c.parentId else { return 0 }
        return cats.first(where: { $0.id == p })?.parentId != nil ? 2 : 1
    }

    /// Kategori ve tüm altları
    public static func descendants(_ id: String, _ cats: [Category]) -> Set<String> {
        Calc.expandCategoryIds([id], cats)
    }

    /// Alt ağaç yüksekliği: yaprak 0, çocuğu var 1, torunu var 2
    public static func subtreeHeight(_ id: String, _ cats: [Category]) -> Int {
        let kids = cats.filter { $0.parentId == id }
        return kids.isEmpty ? 0 : 1 + (kids.map { subtreeHeight($0.id, cats) }.max() ?? 0)
    }

    /// Üst kategori olarak seçilebilecekler: aynı kapsam, arşivsiz, seviye 0–1, kendi alt ağacı hariç
    public static func parentChoices(for editing: Category?, scope: CategoryScope, _ cats: [Category]) -> [Category] {
        let excluded = editing.map { descendants($0.id, cats) } ?? []
        return cats.filter { $0.scope == scope && !$0.isArchived && level($0.id, cats) < 2 && !excluded.contains($0.id) }
            .sorted { $0.name.compare($1.name, locale: Locale(identifier: "tr_TR")) == .orderedAscending }
    }

    public func validationError(editing: Category?, _ cats: [Category]) -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Ad girin." }
        let newLevel = parentId.map { Self.level($0, cats) + 1 } ?? 0
        if let e = editing, newLevel + Self.subtreeHeight(e.id, cats) > 2 {
            return "Bu kategorinin alt kategorileri var; daha derine taşınırsa 3. seviye oluşur. Daha üst bir kategori seçin."
        }
        if editing == nil && newLevel > 2 { return "En fazla 3 seviye desteklenir." }
        return nil
    }

    public func build(editing: Category?, categories: [Category], workspaceId: String?,
                      id: String = UUID().uuidString.lowercased()) -> Category {
        var raw = editing?.raw ?? [
            "id": .string(id), "scope": .string(scope.rawValue), "isSystem": .bool(false), "isArchived": .bool(false),
            "sortOrder": .number((categories.map(\.sortOrder).max() ?? 0) + 1),
            "deleted_at": .null, "workspaceId": JSONValue(workspaceId),
        ]
        raw["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        raw["icon"] = .string(icon.isEmpty ? "package" : icon)
        raw["color"] = .string(color.isEmpty ? "#6366F1" : color)
        raw["parentId"] = JSONValue(parentId)
        // Kurallar yalnız DEĞİŞTİYSE yazılır (0014 öncesi projelerde sütun yok)
        let parsed = Self.parseKeywords(keywordsText)
        if parsed.joined(separator: ", ") != initialKeywords {
            raw["matchKeywords"] = parsed.isEmpty ? .null : .array(parsed.map { .string($0) })
        }
        return Category(raw: raw)
    }
}

extension Category {
    public var isSystem: Bool { raw.flag("isSystem") ?? false }

    /// Arşive al / geri getir (kategoriler silinmez — bağlı işlemler adı göstermeye devam eder)
    public func archived(_ on: Bool) -> Category {
        var r = raw
        r["isArchived"] = .bool(on)
        return Category(raw: r)
    }
}

// MARK: - Kişi

extension Person {
    public static func make(name: String, role: Role, workspaceId: String?, now: String,
                            id: String = UUID().uuidString.lowercased()) -> Person {
        Person(raw: ["id": .string(id), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
                     "role": .string(role.rawValue), "createdAt": .string(now), "isArchived": .bool(false),
                     "deleted_at": .null, "workspaceId": JSONValue(workspaceId)])
    }

    public func renamed(_ name: String) -> Person {
        var r = raw
        r["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        return Person(raw: r)
    }

    /// Arşiv (web remove): kişi kalır, seçicilerde gizlenir; bağlı işlemlere dokunulmaz
    public func archived(_ on: Bool) -> Person {
        var r = raw
        r["isArchived"] = .bool(on)
        return Person(raw: r)
    }
}

// MARK: - Çalışma alanı

extension Workspace {
    public static func make(name: String, now: String, id: String = UUID().uuidString.lowercased()) -> Workspace {
        Workspace(raw: ["id": .string(id), "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
                        "isDefault": .bool(false), "createdAt": .string(now), "deleted_at": .null])
    }

    public func renamed(_ name: String) -> Workspace {
        var r = raw
        r["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        return Workspace(raw: r)
    }
}
