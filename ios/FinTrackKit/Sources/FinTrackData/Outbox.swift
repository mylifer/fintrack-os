import Foundation
import FinTrackCore

/// Çevrimdışı yazma kuyruğu — web src/lib/sync/engine.ts outbox'ının sade hali.
/// Ağ yokken yazılan satırlar (TAM satır, updatedAt damgalı) burada bekler;
/// bağlantı gelince sırayla upsert edilir. Sunucudaki keep_newer_row eski
/// damgalı yazmayı yok saydığı için geç giden bir sürüm yenisini ezemez.
///
/// Kullanıcıya özel dosya: başka hesapla girilince o hesaba gönderilmez (web
/// ownerId kuralı). Cihaz kilitliyken okunamaz, yedeğe girmez.
struct Outbox {
    struct Entry: Codable, Equatable {
        var table: String
        var row: JSONObject
        var seq: Int
    }

    private(set) var entries: [Entry] = []
    private let userId: String

    init(userId: String) {
        self.userId = userId
        entries = load()
    }

    var isEmpty: Bool { entries.isEmpty }
    var count: Int { entries.count }

    /// Aynı satırın bekleyen eski sürümü yenisiyle değişir (tek gönderim yeter).
    mutating func enqueue(table: String, row: JSONObject) {
        let id = row.str("id")
        let seq = (entries.map(\.seq).max() ?? 0) + 1
        entries.removeAll { $0.table == table && $0.row.str("id") == id }
        entries.append(Entry(table: table, row: row, seq: seq))
        save()
    }

    /// Gönderilen sürüm hâlâ kuyruktaysa (arada daha yenisi girmediyse) sil.
    mutating func remove(_ e: Entry) {
        entries.removeAll { $0.table == e.table && $0.seq == e.seq }
        save()
    }

    mutating func clear() {
        entries = []
        if let url = url() { try? FileManager.default.removeItem(at: url) }
    }

    // MARK: Dosya

    private func url() -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("outbox-\(userId).json")
    }

    private func load() -> [Entry] {
        guard let url = url(), let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
        return list
    }

    private func save() {
        guard let url = url() else { return }
        if entries.isEmpty { try? FileManager.default.removeItem(at: url); return }
        guard let data = try? JSONEncoder().encode(entries) else { return }
        #if os(iOS)
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try? data.write(to: url, options: .atomic)
        #endif
        var u = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? u.setResourceValues(values)
    }
}

extension Snapshot {
    /// Bekleyen yerel yazmayı buluttan gelen anlık görüntünün üstüne koy
    /// (gönderilene kadar ekranda eski hal görünmesin).
    mutating func overlay(table: String, row: JSONObject) {
        func put<T: SyncRecord>(_ kp: WritableKeyPath<Snapshot, [T]>) {
            let r = T(raw: row)
            if let i = self[keyPath: kp].firstIndex(where: { $0.id == r.id }) {
                self[keyPath: kp][i] = r
            } else {
                self[keyPath: kp].append(r)
            }
        }
        switch table {
        case Transaction.table: put(\.transactions)
        case RecurringTransaction.table: put(\.recurring)
        case SavingsGoal.table: put(\.goals)
        case Account.table: put(\.accounts)
        case Budget.table: put(\.budgets)
        case Debt.table: put(\.debts)
        case PaymentOccurrence.table: put(\.paymentOccurrences)
        case PaymentPlan.table: put(\.paymentPlans)
        default: break
        }
    }
}
