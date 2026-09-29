import Foundation

/* ── Tekrarlayan işlemler — web src/lib/utils/recurrence.ts +
   recurring-actions.ts + recurring.store.ts karşılığı ────────────────────
   Üretim web'de de OTOMATİK DEĞİL: kullanıcı "Onayla/Kaydet" deyince her
   kaçırılan dönem için bir işlem yazılır (kimlik deterministik:
   recur:<şablon>:<tarih>), sonra şablonun imleci (nextDueDate) ilerler.
   "Atla" yalnız imleci ilerletir. Tarihler "yyyy-MM-dd" metni, metin sırası.
─────────────────────────────────────────────────────────────────────────── */

public enum Recurrence {
    static let cap = 1000

    /// startDate'in günü (1–31) — ay sonu kırpmasından sonra geri dönülecek gün.
    public static func anchorDay(_ r: RecurringTransaction) -> Int? {
        guard r.startDate.count >= 10, let d = Int(r.startDate.dropFirst(8).prefix(2)), (1...31).contains(d)
        else { return nil }
        return d
    }

    private static func parts(_ s: String) -> (y: Int, m: Int, d: Int)? {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? (p[0], p[1], p[2]) : nil
    }

    private static func daysIn(_ y: Int, _ m: Int) -> Int {
        let first = DateUtil.calendar.date(from: DateComponents(year: y, month: m, day: 1))!
        return DateUtil.calendar.range(of: .day, in: .month, for: first)!.count
    }

    private static func fmt(_ y: Int, _ m: Int, _ d: Int) -> String { String(format: "%04d-%02d-%02d", y, m, d) }

    /// Bir sonraki dönem. Aylık/yıllık: ay sonuna kırpılır; bir önceki kırpmanın izi
    /// (gün ≥ 28 ve çapa gününden küçük) varsa çapa günü geri gelir — dar kural.
    public static func advance(_ current: String, _ frequency: RecurringFrequency, anchor: Int?) -> String {
        guard let (y, m, d) = parts(current) else { return current }
        switch frequency {
        case .daily, .weekly:
            let date = DateUtil.calendar.date(from: DateComponents(year: y, month: m, day: d))!
            let next = DateUtil.calendar.date(byAdding: .day, value: frequency == .daily ? 1 : 7, to: date)!
            return DateUtil.day(next)
        case .monthly, .yearly:
            var ny = y, nm = m
            if frequency == .monthly {
                nm += 1
                if nm == 13 { nm = 1; ny += 1 }
            } else {
                ny += 1
            }
            let day = (anchor != nil && anchor! > d && d >= 28) ? anchor! : d
            return fmt(ny, nm, min(day, daysIn(ny, nm)))
        }
    }

    /// nextDueDate'ten `asOf`'a kadar (dahil; bitiş tarihi de dahil) üretilecek tarihler.
    public static func occurrences(_ r: RecurringTransaction, asOf: String) -> [String] {
        let anchor = anchorDay(r)
        var d = r.nextDueDate
        var out: [String] = []
        while !d.isEmpty && d <= asOf && (r.endDate.map { d <= $0 } ?? true) && out.count < cap {
            out.append(d)
            d = advance(d, r.frequency, anchor: anchor)
        }
        return out
    }

    /// `asOf`'tan KESİN sonraki ilk dönem (web: bitiş tarihini yok sayar).
    public static func nextDueAfter(_ r: RecurringTransaction, asOf: String) -> String {
        let anchor = anchorDay(r)
        var d = r.nextDueDate
        var guardCount = 0
        while !d.isEmpty && d <= asOf && guardCount < cap {
            d = advance(d, r.frequency, anchor: anchor)
            guardCount += 1
        }
        return d
    }

    /// Onay bekleyen mi? (web getDue)
    public static func isDue(_ r: RecurringTransaction, asOf: String = DateUtil.today()) -> Bool {
        r.isActive && !(r.endDate.map { $0 < asOf } ?? false) && !r.nextDueDate.isEmpty && r.nextDueDate <= asOf
    }

    /// Önümüzdeki `days` gün içinde (bugün hariç) sırası gelecek mi? (web recurring-upcoming)
    public static func isUpcoming(_ r: RecurringTransaction, today: String = DateUtil.today(), days: Int = 7) -> Bool {
        guard r.isActive, !(r.endDate.map { $0 < today } ?? false),
              let t = DateUtil.parseDay(today),
              let h = DateUtil.calendar.date(byAdding: .day, value: days, to: t) else { return false }
        return r.nextDueDate > today && r.nextDueDate <= DateUtil.day(h)
    }

    public static func transactionId(templateId: String, date: String) -> String {
        DeterministicID.uuid("recur:\(templateId):\(date)")
    }

    /// Onay: kaçırılan her dönem için yazılacak işlemler (zaten VAR olan kimlikler
    /// atlanır) + imleci ilerlemiş şablon. Web approveRecurring ile aynı satırlar.
    public static func approve(_ r: RecurringTransaction, asOf: String, existingIds: Set<String>,
                               workspaceId: String?, fx: FX, now: String) -> (transactions: [Transaction], template: RecurringTransaction) {
        let occ = occurrences(r, asOf: asOf)
        var txs: [Transaction] = []
        for date in occ {
            let id = transactionId(templateId: r.id, date: date)
            if existingIds.contains(id) { continue }
            var raw: JSONObject = [
                "id": .string(id), "type": .string(r.type.rawValue), "amount": .number(r.amount),
                "currency": .string(r.currency.rawValue), "date": .string(date),
                "accountId": .string(r.accountId), "toAccountId": JSONValue(r.toAccountId),
                "categoryId": JSONValue(r.categoryId), "description": .string(r.description),
                "notes": JSONValue(r.notes), "isInstallment": .bool(false),
                "familyMemberId": JSONValue(r.familyMemberId), "recipientId": JSONValue(r.recipientId),
                "approvalStatus": .string(ApprovalStatus.approved.rawValue), "approvedAt": .string(now),
                "createdAt": .string(now), "updatedAt": .string(now), "deleted_at": .null,
                "workspaceId": JSONValue(workspaceId),
            ]
            if let snap = fx.baseSnapshot(r.amount, r.currency) { raw["amountTry"] = .number(snap) }
            txs.append(Transaction(raw: raw))
        }
        var t = r
        t.nextDueDate = nextDueAfter(r, asOf: asOf)
        if let last = occ.last { t.lastGeneratedDate = last }
        return (txs, t)
    }

    /// Atla: yalnız imleç ilerler, lastGeneratedDate değişmez.
    public static func skip(_ r: RecurringTransaction, asOf: String) -> RecurringTransaction {
        var t = r
        t.nextDueDate = nextDueAfter(r, asOf: asOf)
        return t
    }

    /// İleriye dönük planlanan (henüz yazılmamış) dönemler — salt görüntü (web planned.ts).
    public static func planned(_ templates: [RecurringTransaction], today: String, horizon: String,
                               existingIds: Set<String>) -> [(template: RecurringTransaction, date: String)] {
        var out: [(RecurringTransaction, String)] = []
        for r in templates where r.isActive && r.isLive {
            for d in occurrences(r, asOf: horizon) where d >= today {
                if existingIds.contains(transactionId(templateId: r.id, date: d)) { continue }
                out.append((r, d))
            }
        }
        return out.sorted { $0.1 != $1.1 ? $0.1 < $1.1 : $0.0.name < $1.0.name }
    }
}
