import Foundation

/// Taksitli satın almaların RAPOR görünümü — web src/lib/utils/installments.ts
/// `collapseInstallments` karşılığı.
///
/// Aynı `installGroupId`'li satırlar tek türev satıra iner: tarih = ilk taksitin
/// (satın almanın) tarihi, tutar = grubun TAMAMI (gelecek taksitler dahil).
/// Yalnız ANALİTİK toplamlarda kullanılır (aylık gelir/gider, kategori dağılımı,
/// bütçeler); bakiye ve limit HAM satırları okur. Türev satırlar asla yazılmaz.
public enum Installments {
    public static func collapse(_ txs: [Transaction], fx: FX = FX()) -> [Transaction] {
        var groups: [String: [Transaction]] = [:]
        for t in txs { if let g = t.installGroupId { groups[g, default: []].append(t) } }
        if groups.isEmpty { return txs }

        var collapsed: [String: Transaction] = [:]
        for (gid, rows) in groups {
            var head = rows[0]
            for t in rows {
                let ti = t.installIndex ?? Int.max
                let hi = head.installIndex ?? Int.max
                if ti < hi || (ti == hi && t.date < head.date) { head = t }
            }
            var amountMinor = 0
            var baseMinor = 0
            for t in rows {
                amountMinor += Money.toMinor(t.amount)
                baseMinor += Money.toMinor(fx.baseAmount(t))
            }
            var raw = head.raw
            raw["amount"] = .number(Money.toMajor(amountMinor))
            raw["amountTry"] = .number(Money.toMajor(baseMinor))
            raw["installTotal"] = .number(Double(head.installTotal ?? rows.count))
            raw.removeValue(forKey: "installIndex")
            collapsed[gid] = Transaction(raw: raw)
        }

        var out: [Transaction] = []
        var emitted = Set<String>()
        for t in txs {
            guard let g = t.installGroupId else { out.append(t); continue }
            if emitted.insert(g).inserted { out.append(collapsed[g]!) }
        }
        return out
    }
}
