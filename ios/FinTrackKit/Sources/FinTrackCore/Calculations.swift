import Foundation

/* ── Hesaplar — web src/lib/utils/calculations.ts karşılığı ────────────────
   Bakiye, akış (gelir/gider) ve bütçe web ile BİREBİR aynı çıkmalı; kurallar
   ve yorumlar oradan taşındı. Değişiklik gerekirse önce web tarafı ve
   calculations.test.ts, sonra burası ve CalculationsTests.swift.
─────────────────────────────────────────────────────────────────────────── */

public enum Calc {
    // MARK: Onay kapısı / işlenmiş satır

    /// Satır onay kapısında mı? Taksit satırları beklemez (installGroupId ile tanınır).
    public static func awaitsApproval(_ t: Transaction) -> Bool {
        t.approvalStatus == .pending && !t.isInstallment && t.installGroupId == nil
    }

    /// Tarihi gelmiş VE onay beklemeyen satır bakiyeye girer (tek doğruluk kaynağı).
    public static func isPosted(_ t: Transaction, asOf: String = DateUtil.today()) -> Bool {
        String(t.date.prefix(10)) <= asOf && !awaitsApproval(t)
    }

    public static func excludeFuture(_ txs: [Transaction], asOf: String = DateUtil.today()) -> [Transaction] {
        txs.filter { isPosted($0, asOf: asOf) }
    }

    // MARK: Bakiye

    /// İşlemlerin hesaba etkisi, HESABIN KENDİ para biriminde. Kur farklı
    /// transferde gelen bacak TRY değerinden hedef para birimine çevrilir.
    public static func transactionEffect(accountId: String, currency: CurrencyCode,
                                         _ txs: [Transaction], fx: FX) -> Double {
        var minor = 0
        for t in txs {
            if t.type == .transfer {
                if t.accountId == accountId { minor -= Money.toMinor(t.amount) }
                if t.toAccountId == accountId {
                    let incoming = t.currency == currency ? t.amount : fx.fromBaseTry(fx.baseAmount(t), currency)
                    minor += Money.toMinor(incoming)
                }
            } else if t.accountId == accountId {
                minor += t.type == .income ? Money.toMinor(t.amount) : -Money.toMinor(t.amount)
            }
        }
        return Money.toMajor(minor)
    }

    /// Güncel bakiye = initialBalance + işlenmiş işlemlerin etkisi.
    public static func balance(of a: Account, posted: [Transaction], fx: FX) -> Double {
        Money.add(a.initialBalance, transactionEffect(accountId: a.id, currency: a.currency, posted, fx: fx))
    }

    public static func touchesAccount(_ t: Transaction, _ accountId: String) -> Bool {
        t.accountId == accountId || t.toAccountId == accountId
    }

    /// Kredi kartı kullanılabilir limit: gelecek tarihli taksitler satın alma
    /// gününden itibaren limitten düşer.
    public static func availableCredit(_ a: Account, balance: Double, _ txs: [Transaction],
                                       asOf: String = DateUtil.today()) -> Double {
        guard a.type == .credit_card, let limit = a.creditLimit, limit != 0 else { return 0 }
        var blocked = 0
        for t in txs where (t.isInstallment || t.installGroupId != nil)
            && t.type == .expense && t.accountId == a.id && !isPosted(t, asOf: asOf) {
            blocked += Money.toMinor(t.amount)
        }
        return limit + balance - Money.toMajor(blocked)
    }

    /// Net değer (TRY): arşivlenmemiş hesapların bakiyesi, kurla çevrilmiş.
    /// balances: hesap id → kendi para birimindeki bakiye.
    public static func netWorth(_ accounts: [Account], balances: [String: Double], fx: FX,
                                onlyPositive: Bool = false) -> Double {
        var minor = 0
        for a in accounts where !a.isArchived {
            var b = balances[a.id] ?? a.initialBalance
            if a.currency != .TRY, let r = fx.rate(a.currency), fx.rates != nil { b *= r }
            if onlyPositive && b <= 0 { continue }
            minor += Money.toMinor(b)
        }
        return Money.toMajor(minor)
    }

    // MARK: Akış

    static let reconcileKey = normalizeTagKey("#BakiyeEşitleme")

    static func normalizeTagKey(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            .lowercased(with: Locale(identifier: "tr_TR"))
    }

    public static func isReconciliation(_ t: Transaction) -> Bool {
        if t.systemKind == "reconciliation" { return true }
        return t.tags?.contains { normalizeTagKey($0) == reconcileKey } ?? false
    }

    public static func isInvestmentPrincipal(_ t: Transaction) -> Bool {
        t.icon != nil && (t.description.hasSuffix("Alımı") || t.description.hasSuffix("Satışı"))
    }

    public static func isDebtPrincipal(_ t: Transaction) -> Bool {
        t.icon != nil && (t.description.hasSuffix("borç girişi") || t.description.hasSuffix("verilen borç"))
    }

    public static func isPrincipalMove(_ t: Transaction) -> Bool {
        isInvestmentPrincipal(t) || isDebtPrincipal(t)
    }

    /// Gelir/gider/net toplamlarına giren satır: işlenmiş, mutabakat değil, anapara değil.
    public static func isFlow(_ t: Transaction, asOf: String = DateUtil.today()) -> Bool {
        isPosted(t, asOf: asOf) && !isReconciliation(t) && !isPrincipalMove(t)
    }

    public struct Flow: Equatable, Sendable {
        public var income: Double
        public var expense: Double
        public var net: Double
    }

    public static func periodFlow(_ txs: [Transaction], from: String, to: String, fx: FX,
                                  asOf: String = DateUtil.today()) -> Flow {
        let inRange = txs.filter {
            let d = String($0.date.prefix(10))
            return d >= from && d <= to && isFlow($0, asOf: asOf)
        }
        let income = Money.sum(inRange.filter { $0.type == .income }) { fx.baseAmount($0) }
        let expense = Money.sum(inRange.filter { $0.type == .expense }) { fx.baseAmount($0) }
        return Flow(income: income, expense: expense, net: Money.sub(income, expense))
    }

    public static func monthlyFlow(_ txs: [Transaction], _ my: MonthYear, fx: FX,
                                   asOf: String = DateUtil.today()) -> Flow {
        let r = DateUtil.monthRange(my)
        return periodFlow(txs, from: r.from, to: r.to, fx: fx, asOf: asOf)
    }

    /// `my` dahil geriye doğru `count` ayın akışı (eskiden yeniye).
    public static func monthlySeries(_ txs: [Transaction], endingAt my: MonthYear, count: Int, fx: FX,
                                     asOf: String = DateUtil.today()) -> [(month: MonthYear, flow: Flow)] {
        var months: [MonthYear] = [my]
        while months.count < count { months.insert(months[0].previous, at: 0) }
        return months.map { ($0, monthlyFlow(txs, $0, fx: fx, asOf: asOf)) }
    }

    /// Ay başından bugüne gider ile geçen ayın AYNI dönemi (1…aynı gün; geçen ay
    /// daha kısaysa son günü). Karşılaştırma yalnız bugünün ayı için anlamlı.
    public static func monthToDateExpense(_ txs: [Transaction], fx: FX,
                                          today: String = DateUtil.today()) -> (current: Double, previous: Double) {
        guard let d = DateUtil.parseDay(today) else { return (0, 0) }
        let my = MonthYear.current(d)
        let dayOfMonth = DateUtil.calendar.component(.day, from: d)
        let cur = DateUtil.monthRange(my)
        let prevRange = DateUtil.monthRange(my.previous)
        let prevLastDay = Int(prevRange.to.suffix(2)) ?? 28
        let prevTo = String(prevRange.from.prefix(8)) + String(format: "%02d", min(dayOfMonth, prevLastDay))
        let current = periodFlow(txs, from: cur.from, to: today, fx: fx, asOf: today).expense
        let previous = periodFlow(txs, from: prevRange.from, to: prevTo, fx: fx, asOf: today).expense
        return (current, previous)
    }

    // MARK: Kategori payları

    /// Bölünmüş işlemi kategori başına sanal satırlara açar (yalnız TOPLAMA için).
    /// amountTry paylar oranında bölünür, kalan son paya.
    public static func categorySlices(_ t: Transaction) -> [(categoryId: String?, amount: Double, amountTry: Double?)] {
        guard let splits = t.categorySplits, splits.count >= 2 else {
            return [(t.categoryId, t.amount, t.amountTry)]
        }
        let totalMinor = Money.toMinor(t.amount)
        let tryMinor = t.amountTry.map(Money.toMinor)
        var acc = 0
        return splits.enumerated().map { i, s in
            var amountTry: Double?
            if let tm = tryMinor {
                if i == splits.count - 1 {
                    amountTry = Money.toMajor(tm - acc)
                } else {
                    let part = totalMinor == 0 ? 0
                        : Int(Money.jsRound(Double(tm) * Double(Money.toMinor(s.amount)) / Double(totalMinor)))
                    acc += part
                    amountTry = Money.toMajor(part)
                }
            }
            return (s.categoryId, s.amount, amountTry)
        }
    }

    // MARK: Bütçe

    /// categoryId düz kimlik ya da JSON dizisi olabilir.
    public static func budgetCategoryIds(_ b: Budget) -> [String] {
        let raw = b.categoryId
        if raw.drop(while: \.isWhitespace).hasPrefix("["),
           let data = raw.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [String] {
            return arr
        }
        return raw.isEmpty ? [] : [raw]
    }

    /// Verilen kategorileri tüm alt kategorileriyle (transitif) genişletir.
    public static func expandCategoryIds(_ ids: [String], _ categories: [Category]) -> Set<String> {
        var byParent: [String: [String]] = [:]
        for c in categories { if let p = c.parentId { byParent[p, default: []].append(c.id) } }
        var result = Set<String>()
        var stack = ids
        while let id = stack.popLast() {
            if result.contains(id) { continue }
            result.insert(id)
            stack.append(contentsOf: byParent[id] ?? [])
        }
        return result
    }

    public static func budgetSpent(_ b: Budget, _ txs: [Transaction], _ my: MonthYear?,
                                   categories: [Category], fx: FX,
                                   asOf: String = DateUtil.today()) -> Double {
        let range: (from: String, to: String)
        if let my { range = DateUtil.monthRange(my) }
        else if b.period == "monthly", let m = b.month, let y = b.year, m != 0, y != 0 {
            range = DateUtil.monthRange(MonthYear(month: m, year: y))
        } else {
            range = DateUtil.yearRange(b.year ?? MonthYear.current().year)
        }
        let ids = expandCategoryIds(budgetCategoryIds(b), categories)
        var minor = 0
        for t in txs where t.type == .expense && isFlow(t, asOf: asOf)
            && DateUtil.isInRange(t.date, range.from, range.to) {
            for s in categorySlices(t) {
                guard let c = s.categoryId, ids.contains(c) else { continue }
                minor += Money.toMinor(s.amountTry ?? fx.toBaseTry(s.amount, t.currency))
            }
        }
        return Money.toMajor(minor)
    }

    /// Devir: yalnız bir önceki ayda harcanmayan tutar (zincirleme yok, aşım devretmez).
    /// Defterde önceki ayın sonuna kadar hiç işlem yoksa devir 0.
    public static func budgetCarryover(_ b: Budget, _ txs: [Transaction], _ my: MonthYear?,
                                       categories: [Category], fx: FX,
                                       asOf: String = DateUtil.today()) -> Double {
        guard b.rollover, let my else { return 0 }
        let prev = my.previous
        let prevEnd = DateUtil.monthRange(prev).to
        guard txs.contains(where: { String($0.date.prefix(10)) <= prevEnd }) else { return 0 }
        let prevSpent = budgetSpent(b, txs, prev, categories: categories, fx: fx, asOf: asOf)
        return max(0, Money.sub(b.amount, prevSpent))
    }

    public struct BudgetState: Hashable, Sendable {
        public var budget: Budget
        public var spent: Double
        public var carryover: Double
        public var limit: Double
        public var remaining: Double
        public var percentUsed: Double
        public var status: BudgetStatus
    }

    public static func enrichBudget(_ b: Budget, _ txs: [Transaction], _ my: MonthYear?,
                                    categories: [Category], fx: FX,
                                    asOf: String = DateUtil.today()) -> BudgetState {
        let spent = budgetSpent(b, txs, my, categories: categories, fx: fx, asOf: asOf)
        let carry = budgetCarryover(b, txs, my, categories: categories, fx: fx, asOf: asOf)
        let limit = Money.toMajor(Money.toMinor(b.amount) + Money.toMinor(carry))
        let remaining = max(0, Money.sub(limit, spent))
        let pct = limit > 0 ? spent / limit * 100 : 0
        let status: BudgetStatus = pct >= 100 ? .exceeded : pct >= b.alertThreshold ? .warning : .ok
        return BudgetState(budget: b, spent: spent, carryover: carry, limit: limit,
                           remaining: remaining, percentUsed: pct, status: status)
    }

    /// Bütçenin görünen adı: canlı kategoriler, yoksa ad anlık görüntüsü "(arşiv)".
    public static func budgetLabel(_ b: Budget, _ categories: [Category]) -> (cats: [Category], label: String, archived: Bool) {
        let cats = budgetCategoryIds(b).compactMap { id in categories.first { $0.id == id } }
        if !cats.isEmpty { return (cats, cats.map(\.name).joined(separator: ", "), false) }
        if let n = b.categoryName { return ([], "\(n) (arşiv)", true) }
        return ([], "Bütçe (kategorisi silinmiş)", true)
    }

    // MARK: Kategori dağılımı

    /// Giderleri kategoriye göre TRY toplar (yatırım bağlı ve mutabakat hariç,
    /// kategori payları açılarak) — web sumExpenseByKey kuralı.
    public static func expenseByCategory(_ txs: [Transaction], fx: FX) -> [String: Double] {
        var minor: [String: Int] = [:]
        for t in txs where t.type == .expense && t.icon == nil && !isReconciliation(t) {
            for s in categorySlices(t) {
                minor[s.categoryId ?? "", default: 0] += Money.toMinor(s.amountTry ?? fx.toBaseTry(s.amount, t.currency))
            }
        }
        return minor.mapValues(Money.toMajor)
    }
}

extension Calc {
    /// Hesabın gün sonu bakiyeleri, `days` gün geriye (eskiden yeniye; son nokta
    /// bugün = güncel bakiye). Bugünkü bakiyeden geriye doğru her günün işlem
    /// etkisi düşülerek bulunur — yalnız işlenmiş (tarihi gelmiş, onaylı) satırlar.
    public static func balanceHistory(_ a: Account, current: Double, posted: [Transaction], fx: FX,
                                      days: Int, today: String = DateUtil.today()) -> [(date: String, balance: Double)] {
        guard days > 0, let t = DateUtil.parseDay(today) else { return [] }
        var byDay: [String: [Transaction]] = [:]
        for tx in posted where touchesAccount(tx, a.id) { byDay[String(tx.date.prefix(10)), default: []].append(tx) }
        var out: [(String, Double)] = []
        var balance = current
        for i in 0...days {
            let day = DateUtil.day(DateUtil.calendar.date(byAdding: .day, value: -i, to: t)!)
            out.append((day, balance))
            if let txs = byDay[day] {
                balance = Money.sub(balance, transactionEffect(accountId: a.id, currency: a.currency, txs, fx: fx))
            }
        }
        return out.reversed()
    }
}
