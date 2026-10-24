import Foundation

/* ── Geçmişten tekrarlayan tespiti — web src/lib/utils/recurring-detect.ts ──
   Elle girilmiş ama şablonu olmayan AYLIK düzenli gelir/giderleri bulur.
   Aday: aynı hesap + tür + (alıcı ya da sadeleştirilmiş açıklama); son 6 ayda
   en az 3 farklı ay, ay başına tek ödeme; benzer gün (medyan ±5, ay sonu
   28–31 aynı); benzer tutar (en büyük/en küçük ≤ 1,25); son ödeme ≤ 45 gün
   önce; aynı ad/açıklama ya da alıcıyla şablon yok.
─────────────────────────────────────────────────────────────────────────── */

public enum RecurringDetect {
    public struct Suggestion: Hashable, Sendable, Identifiable {
        public var key: String
        public var name: String
        public var type: TransactionType
        public var accountId: String
        public var categoryId: String?
        public var recipientId: String?
        public var currency: CurrencyCode
        public var amount: Double
        public var amountVaries: Bool
        public var count: Int
        public var lastDate: String
        public var nextDate: String
        public var dayOfMonth: Int
        public var txIds: [String]
        public var id: String { key }
    }

    static let windowMonths = 6, minMonths = 3, maxDayDrift = 5, maxSilenceDays = 45
    static let maxAmountRatio = 1.25
    static let monthWords: Set<String> = [
        "ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik",
        "oca", "sub", "mar", "nis", "haz", "tem", "agu", "eyl", "eki", "kas", "ara",
    ]

    /// Açıklamanın kalıcı kısmı: rakam, noktalama, ay adları atılır; ilk 3 kelime
    public static func keyText(_ s: String) -> String {
        let f = BankRules.foldText(s)
        let cleaned = String(f.map { c -> Character in
            if c.isNumber { return " " }
            return ("a"..."z").contains(String(c)) || c == " " ? c : " "
        })
        return cleaned.split(separator: " ").map(String.init)
            .filter { $0.count > 1 && !monthWords.contains($0) }
            .prefix(3).joined(separator: " ")
    }

    /// Şablon adı: özgün yazım korunur; ay adı ve rakamlı parçalar atılır
    public static func suggestionName(_ description: String) -> String {
        let kept = description.trimmingCharacters(in: .whitespaces).split(whereSeparator: \.isWhitespace).filter { tok in
            let word = String(BankRules.foldText(String(tok)).filter { ("a"..."z").contains(String($0)) })
            return !tok.contains(where: \.isNumber) && !monthWords.contains(word)
        }
        var t = kept.joined(separator: " ")
        while let last = t.last, " -–—/.,:;".contains(last) { t.removeLast() }
        t = t.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { t = description.trimmingCharacters(in: .whitespaces) }
        return t.count > 40 ? String(t.prefix(40)) + "…" : t
    }

    static func effectiveDay(_ iso: String) -> Int {
        let day = Int(iso.suffix(2)) ?? 1
        return day >= ISODay.daysIn(String(iso.prefix(7))) - 2 ? 31 : day
    }

    public static func detect(_ txs: [Transaction], recurring: [RecurringTransaction], asOf: String,
                              dismissed: Set<String> = []) -> [Suggestion] {
        guard let asOfDate = DateUtil.parseDay(asOf),
              let ws = DateUtil.calendar.date(byAdding: .month, value: -windowMonths, to: asOfDate) else { return [] }
        let windowStart = DateUtil.day(ws)
        var texts = Set<String>(), recipients = Set<String>()
        for r in recurring where r.isLive {
            texts.insert("\(r.type.rawValue)|\(keyText(r.name))")
            texts.insert("\(r.type.rawValue)|\(keyText(r.description))")
            if let rec = r.recipientId { recipients.insert("\(r.type.rawValue)|\(r.accountId)|\(rec)") }
        }
        var groups: [String: [Transaction]] = [:]
        var order: [String] = []
        for t in txs where t.isLive && (t.type == .income || t.type == .expense) {
            let d = String(t.date.prefix(10))
            if d < windowStart || d > asOf { continue }
            if t.isInstallment || t.installGroupId != nil || t.debtId != nil || t.debtPrincipalId != nil || t.icon != nil { continue }
            if Calc.isReconciliation(t) || !(t.amount > 0) { continue }
            let text = keyText(t.description)
            if t.recipientId == nil && text.isEmpty { continue }
            let key = "\(t.type.rawValue)|\(t.accountId)|\(t.recipientId.map { "r:\($0)" } ?? "d:\(text)")"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(t)
        }
        var out: [Suggestion] = []
        for key in order where !dismissed.contains(key) {
            let sorted = groups[key]!.sorted { $0.date < $1.date }
            let months = Set(sorted.map { String($0.date.prefix(7)) })
            if months.count < minMonths || sorted.count > months.count { continue }
            guard let last = sorted.last else { continue }
            let lastDay = String(last.date.prefix(10))
            if Deposit.daysBetween(lastDay, asOf) > maxSilenceDays { continue }
            let days = sorted.map { effectiveDay(String($0.date.prefix(10))) }
            let mid = days.sorted()[days.count / 2]
            if days.contains(where: { abs($0 - mid) > maxDayDrift }) { continue }
            if Set(sorted.map(\.currency)).count > 1 { continue }
            let amounts = sorted.map(\.amount)
            guard let lo = amounts.min(), let hi = amounts.max(), hi / lo <= maxAmountRatio else { continue }
            if texts.contains("\(last.type.rawValue)|\(keyText(last.description))") { continue }
            if let rec = last.recipientId, recipients.contains("\(last.type.rawValue)|\(last.accountId)|\(rec)") { continue }
            let next = DateUtil.parseDay(lastDay).flatMap { DateUtil.calendar.date(byAdding: .month, value: 1, to: $0) }.map(DateUtil.day) ?? lastDay
            let name = suggestionName(last.description)
            out.append(Suggestion(key: key, name: name.isEmpty ? "Düzenli işlem" : name, type: last.type,
                                  accountId: last.accountId, categoryId: last.categoryId, recipientId: last.recipientId,
                                  currency: last.currency, amount: last.amount, amountVaries: hi != lo,
                                  count: sorted.count, lastDate: lastDay, nextDate: next,
                                  dayOfMonth: Int(lastDay.suffix(2)) ?? 1, txIds: sorted.map(\.id)))
        }
        return out.sorted { $0.amount > $1.amount }
    }

    /// Öneriden şablon: bir sonraki ödemeden başlar (geçmiş aylar üretilmez)
    public static func template(_ s: Suggestion, id: String, now: String, workspaceId: String?) -> RecurringTransaction {
        RecurringTransaction(raw: [
            "id": .string(id), "name": .string(s.name), "type": .string(s.type.rawValue), "amount": .number(s.amount),
            "currency": .string(s.currency.rawValue), "accountId": .string(s.accountId),
            "categoryId": JSONValue(s.categoryId), "recipientId": JSONValue(s.recipientId),
            "description": .string(s.name), "frequency": "monthly", "dayOfMonth": .number(Double(s.dayOfMonth)),
            "startDate": .string(s.nextDate), "nextDueDate": .string(s.nextDate), "isActive": .bool(true),
            "createdAt": .string(now), "deleted_at": .null, "workspaceId": JSONValue(workspaceId),
        ])
    }
}
