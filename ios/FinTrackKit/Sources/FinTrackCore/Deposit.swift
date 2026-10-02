import Foundation

/// Vadeli mevduat — web src/lib/utils/deposit.ts + deposit-actions.ts birebir.
/// "Birikim" (savings) hesabına girilen koşullar: yıllık brüt faiz, vade
/// başlangıcı/sonu, stopaj oranı. Basit faiz (bankaların TL mevduatı):
///   brüt = anapara × oran × gün / 365, stopaj = brüt × oran, net = brüt − stopaj.
/// Anapara hesabın GÜNCEL bakiyesidir (vade içinde para eklenmediği varsayılır).
public enum Deposit {
    public static let defaultTax = 17.5

    public struct Terms: Equatable, Sendable {
        public var rate: Double    // yıllık brüt %
        public var start: String   // yyyy-MM-dd
        public var end: String
        public var taxPct: Double
        public init(rate: Double, start: String, end: String, taxPct: Double) {
            self.rate = rate; self.start = start; self.end = end; self.taxPct = taxPct
        }
    }

    /// Geçerli vade koşulları; eksik ya da tutarsızsa nil.
    public static func terms(_ a: Account) -> Terms? {
        guard a.type == .savings, let rate = a.raw.num("depositRate"), rate > 0,
              let start = a.raw.str("depositStart"), let end = a.raw.str("depositEnd"),
              !start.isEmpty, end > start else { return nil }
        return Terms(rate: rate, start: start, end: end, taxPct: a.raw.num("depositTaxPct") ?? defaultTax)
    }

    public struct Projection: Equatable, Sendable {
        public var days: Int
        public var gross: Double
        public var tax: Double
        public var net: Double
        public var maturityValue: Double
        /// asOf gününe kadar işlemiş net faiz (bilgi amaçlı)
        public var accruedNet: Double
        public var daysLeft: Int
        public var matured: Bool
    }

    static func daysBetween(_ a: String, _ b: String) -> Int {
        guard let x = DateUtil.parseDay(a), let y = DateUtil.parseDay(b) else { return 0 }
        return DateUtil.calendar.dateComponents([.day], from: x, to: y).day ?? 0
    }

    public static func project(_ principal: Double, _ t: Terms, asOf: String) -> Projection {
        let days = daysBetween(t.start, t.end)
        let base = max(0, principal)
        let gross = Money.toMajor((Double(Money.toMinor(base)) * (t.rate / 100) * Double(days) / 365).rounded().safeInt)
        let tax = Money.toMajor((Double(Money.toMinor(gross)) * (t.taxPct / 100)).rounded().safeInt)
        let net = Money.toMajor(Money.toMinor(gross) - Money.toMinor(tax))
        let elapsed = min(days, max(0, daysBetween(t.start, asOf)))
        return Projection(
            days: days, gross: gross, tax: tax, net: net,
            maturityValue: Money.toMajor(Money.toMinor(base) + Money.toMinor(net)),
            accruedNet: days > 0 ? Money.toMajor((Double(Money.toMinor(net)) * Double(elapsed) / Double(days)).rounded().safeInt) : 0,
            daysLeft: max(0, daysBetween(asOf, t.end)),
            matured: String(asOf.prefix(10)) >= t.end)
    }

    /// Aynı süre ve koşullarla yenilenmiş vade: yeni başlangıç = eski vade sonu.
    public static func rolled(_ t: Terms) -> Terms {
        let days = daysBetween(t.start, t.end)
        let end = DateUtil.parseDay(t.end).flatMap { DateUtil.calendar.date(byAdding: .day, value: days, to: $0) }
        return Terms(rate: t.rate, start: t.end, end: end.map(DateUtil.day) ?? t.end, taxPct: t.taxPct)
    }

    /// "45" · "42,5" (web toLocaleString('tr-TR'))
    public static func rateText(_ r: Double) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "tr_TR")
        f.maximumFractionDigits = 3
        f.usesGroupingSeparator = true
        return f.string(from: NSNumber(value: r)) ?? "\(r)"
    }

    /// "Faiz", "Faiz Geliri", "Mevduat Faizi" … — adında faiz geçen ilk gelir kategorisi.
    static func interestCategoryId(_ categories: [Category]) -> String? {
        categories.first {
            $0.scope == .income && !$0.isArchived
                && $0.name.lowercased(with: Locale(identifier: "tr_TR"))
                    .folding(options: .diacriticInsensitive, locale: Locale(identifier: "tr_TR"))
                    .replacingOccurrences(of: "ı", with: "i").contains("faiz")
        }?.id
    }

    /// Vade sonu faiz satırı zaten var mı (web ya da önceki deneme): hesabın
    /// vade sonu tarihli, "Vadeli mevduat faizi" açıklamalı canlı geliri.
    /// Web rastgele kimlik kullandığından kimlikle değil içerikle aranır.
    public static func interestBooked(_ txs: [Transaction], accountId: String, end: String) -> Bool {
        txs.contains {
            $0.isLive && $0.accountId == accountId && $0.type == .income
                && $0.date.prefix(10) == end && $0.description.hasPrefix("Vadeli mevduat faizi")
        }
    }

    /// Hesap satırında değişecek tek alanlar (yenile: aynı süre ileri; bitir: boş).
    public static func nextColumns(_ t: Terms, renew: Bool) -> JSONObject {
        let next = renew ? rolled(t) : nil
        return [
            "depositRate": next.map { .number($0.rate) } ?? .null,
            "depositStart": next.map { .string($0.start) } ?? .null,
            "depositEnd": next.map { .string($0.end) } ?? .null,
            "depositTaxPct": next.map { .number($0.taxPct) } ?? .null,
        ]
    }

    /// Vade sonu faizini işle (web processDepositInterest): NET faiz vade sonu
    /// tarihli gelir olarak yazılır, koşullar ya aynı süreyle ileri kayar (yenile)
    /// ya da silinir (bitir) — aynı vade ikinci kez "dolmuş" görünmez.
    /// Faiz satırının kimliği hesap + vade sonundan türetilir: tekrar denemede
    /// ikinci faiz satırı oluşmaz (web rastgele kimlik kullanır).
    public static func process(account: Account, balance: Double, categories: [Category], renew: Bool,
                               fx: FX, workspaceId: String?, now: String) -> (interest: Transaction?, account: Account)? {
        guard let t = terms(account) else { return nil }
        let p = project(balance, t, asOf: t.end)
        var interest: Transaction?
        if p.net >= 0.01 {
            var raw: JSONObject = [
                "id": .string(DeterministicID.uuid("deposit:\(account.id):\(t.end)")),
                "type": "income",
                "amount": .number(p.net),
                "currency": .string(account.currency.rawValue),
                "date": .string(t.end),
                "accountId": .string(account.id),
                "categoryId": JSONValue(interestCategoryId(categories)),
                "description": .string("Vadeli mevduat faizi (net, %\(rateText(t.rate)))"),
                "isInstallment": .bool(false),
                "createdAt": .string(now),
                "updatedAt": .string(now),
                "deleted_at": .null,
                "workspaceId": JSONValue(workspaceId),
            ]
            if let snap = fx.baseSnapshot(p.net, account.currency) { raw["amountTry"] = .number(snap) }
            if t.end > DateUtil.today() { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
            interest = Transaction(raw: raw)
        }
        // Yerel kopya; bulutta yalnız nextColumns kısmi güncellenir (web accounts.update)
        var raw = account.raw
        for (k, v) in nextColumns(t, renew: renew) { raw[k] = v }
        return (interest, Account(raw: raw))
    }
}
