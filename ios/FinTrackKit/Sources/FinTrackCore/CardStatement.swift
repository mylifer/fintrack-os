import Foundation

/* ── Kredi kartı ekstresi ──────────────────────────────────────────────────
   Kaynak (birebir): web src/lib/utils/card-statement.ts. Testler
   card-statement.test.ts ile aynı girdiler (CardStatementTests.swift).

   Dönemleri kart döngülerinden (CardCycles — varsayılan kesim/son ödeme günü +
   Kart Takvimi'nde aya özel girilen tarihler) alır ve her kapanmış dönem için
   uygulamaya GİRİLMİŞ işlemlerden bir ekstre hesaplar. Bankanın ekstresi
   değildir — uygulamada olmayan bir harcama burada da yoktur.

   Dönem: önceki kesimin ertesi günü → bu kesim günü (ikisi dahil).
   Dönem borcu: kartta gider + karttan çıkan transfer − karta işlenen iade.
     Karta YAPILAN ödemeler (assignCardPayments'ın bulduğu, Ödeme Takibi ile
     aynı kural) ve sistem satırları (systemKind — mutabakat) borca girmez.
     Onay bekleyen ya da tarihi gelmemiş satırlar sayılmaz (isPosted).
   Son ödeme tarihi: döngünün son ödemesi. Varsayılan gün yalnız ödeme
     planından gelir (accounts.dueDay güvenilmez); yoksa nil — varsayım yok.
   Ödenen: bu karta atanmış ödemelerden kesimden sonra, son ödeme tarihi + 7
     gün (yoksa sonraki kesim) içinde olanlar.
   Asgari ödeme: dönem borcu × oran (oran girilmemişse nil).
─────────────────────────────────────────────────────────────────────────── */

public struct StatementPeriod: Hashable, Sendable {
    /// ISO tarih, dahil
    public var from: String
    /// Kesim günü, dahil
    public var to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }
}

public enum StatementStatus: String, Sendable, Hashable, CaseIterable {
    case clear, paid, partial, open, overdue

    /// Web CardStatementPanel etiketleri
    public var label: String {
        switch self {
        case .clear: "Borç yok"
        case .paid: "Ödendi"
        case .partial: "Kısmi"
        case .open: "Bekliyor"
        case .overdue: "Gecikti"
        }
    }
}

public struct CardStatement: Hashable, Sendable {
    public var period: StatementPeriod
    public var charges: [Transaction]
    public var total: Double
    public var dueDate: String?
    public var minPayment: Double?
    public var paid: Double
    public var status: StatementStatus
}

public struct OpenStatement: Hashable, Sendable {
    public var period: StatementPeriod
    public var charges: [Transaction]
    public var total: Double
}

public struct CardStatementResult: Hashable, Sendable {
    /// Bugünü içeren, henüz kesilmemiş dönem
    public var open: OpenStatement
    /// Kapanmış dönemler, yeniden eskiye
    public var statements: [CardStatement]
}

public enum CardStatements {
    static let payGraceDays = 7

    /// İşlem tutarı kartın para biriminde (web inCurrency).
    static func inCurrency(_ t: Transaction, _ currency: CurrencyCode, fx: FX) -> Double {
        t.currency == currency ? t.amount : fx.fromBaseTry(fx.baseAmount(t), currency)
    }

    /// Web `buildCardStatements(account, transactions, opts)`.
    /// - payments: `assignCardPayments(...)[account.id]` — bu karta yapılan ödemeler
    /// - dueDay: plan.dayOfMonth (days verilmemişse kullanılır)
    /// - minPayPct: asgari ödeme %, nil/0 = girilmemiş
    /// - overrides: Kart Takvimi'nde aya özel kesim/son ödeme (ödeme ayı → tarih)
    /// - days: kartın çözümlenmiş günleri (resolveCardDays: fark + tatil kuralı).
    ///   Yoksa statementDay + dueDay sabit günleriyle, tatil kaydırması olmadan.
    public static func buildCardStatements(
        account: Account,
        transactions: [Transaction],
        payments: [Transaction],
        dueDay: Int?,
        minPayPct: Double?,
        today: String,
        count: Int = 6,
        overrides: [String: CycleOverride] = [:],
        days: CardDays? = nil,
        fx: FX
    ) -> CardStatementResult {
        let todayDay = String(today.prefix(10))
        let month = String(today.prefix(7))
        let cycles = CardCycles.cardCycles(
            days ?? CardDays(statementDay: account.statementDay, dueDay: dueDay),
            overrides: overrides,
            from: CardCycles.shiftMonthKey(month, -(count + 2)),
            to: CardCycles.shiftMonthKey(month, 3)
        )
        // Açık dönem: kesimi bugün ya da sonra olan ilk döngü. (Web'de bulunamazsa
        // hata fırlatır; aralık bugün + 3 ay olduğu için pratikte hep bulunur —
        // burada son döngüye düşülür.)
        let openIdx = cycles.firstIndex { $0.closing >= todayDay } ?? max(0, cycles.count - 1)
        let openCycle = cycles[openIdx]
        let closedCycles = Array(cycles[max(0, openIdx - count)..<openIdx].reversed())
        let open = StatementPeriod(from: openCycle.from, to: openCycle.closing)
        let closed = closedCycles.map { StatementPeriod(from: $0.from, to: $0.closing) }
        let paymentIds = Set(payments.map(\.id))

        let cardRows = transactions.filter { t in
            t.accountId == account.id
                && (t.systemKind ?? "").isEmpty
                && !paymentIds.contains(t.id)
                && Calc.isPosted(t, asOf: today)
        }

        func chargesIn(_ p: StatementPeriod) -> [Transaction] {
            cardRows.filter { t in
                let d = String(t.date.prefix(10))
                return d >= p.from && d <= p.to
            }
        }
        func totalOf(_ rows: [Transaction]) -> Double {
            max(0, Money.round(Money.sum(rows) { t in
                (t.type == .income ? -1 : 1) * inCurrency(t, account.currency, fx: fx)
            }))
        }

        let postedPayments = payments.filter { Calc.isPosted($0, asOf: today) }

        let statements: [CardStatement] = closed.enumerated().map { i, period in
            let charges = chargesIn(period)
            let total = totalOf(charges)
            let dueDate = closedCycles[i].dueDate
            // Ödeme penceresi: kesimin ertesi → son ödeme + 7 gün. Son ödeme günü
            // bilinmiyorsa sonraki kesim (bir sonraki dönemin sonu).
            let nextClosing = i == 0 ? open.to : closed[i - 1].to
            let windowEnd = dueDate.map { ISODay.add($0, payGraceDays) } ?? nextClosing
            let paid = Money.round(Money.sum(postedPayments.filter { t in
                let d = String(t.date.prefix(10))
                return d > period.to && d <= windowEnd
            }) { abs(inCurrency($0, account.currency, fx: fx)) })
            let minPayment: Double? = if let pct = minPayPct, pct != 0 {
                Money.round(total * pct / 100)
            } else { nil }

            let status: StatementStatus
            if total == 0 { status = .clear }
            else if paid >= total { status = .paid }
            else if let due = dueDate, !due.isEmpty, due < today, paid < (minPayment ?? total) { status = .overdue }
            else if paid > 0 { status = .partial }
            else { status = .open }

            return CardStatement(period: period, charges: charges, total: total, dueDate: dueDate,
                                 minPayment: minPayment, paid: paid, status: status)
        }

        let openCharges = chargesIn(open)
        return CardStatementResult(
            open: OpenStatement(period: open, charges: openCharges, total: totalOf(openCharges)),
            statements: statements
        )
    }

    /// Asgari ödeme oranı: 3 = eski varsayılan → "girilmemiş" (web).
    public static func effectiveMinPayPct(_ account: Account) -> Double? {
        guard let p = account.minPayPct, p != 0, p != 3 else { return nil }
        return p
    }

    /// Kartın ödeme planı: önce deterministik kimlik (web planIdFor), yoksa
    /// targetKind/targetId eşleşmesi; yalnız canlı satırlar.
    public static func plan(for account: Account, in plans: [PaymentPlan]) -> PaymentPlan? {
        let live = plans.filter { $0.isLive && $0.targetKind == "card" && $0.targetId == account.id }
        let pid = DeterministicID.uuid("payplan:card:\(account.id)")
        return live.first { $0.id == pid } ?? live.first
    }

    /// Kart Takvimi'nde aya özel girilen kesim / son ödeme tarihleri (ödeme ayı →
    /// tarih). Aynı ay için birden fazla satır varsa sonuncusu kazanır (web Map).
    public static func overrides(for account: Account, in occurrences: [PaymentOccurrence]) -> [String: CycleOverride] {
        var out: [String: CycleOverride] = [:]
        for o in occurrences where o.isLive && o.targetKind == "card" && o.targetId == account.id {
            out[o.month] = CycleOverride(statementDate: o.statementDate, dueDate: o.dueDate)
        }
        return out
    }

    /// Hesap sayfasının (web CardStatementPanel) bağlantısı: resolveCardDays
    /// (fark + tatil kuralı) + assignCardPayments (TÜM hesaplardan) + aya özel
    /// tarihler + asgari oran kuralı. Kart Takvimi `count: 12` ile çağırır.
    public static func forCard(
        _ account: Account,
        accounts: [Account],
        transactions: [Transaction],
        plans: [PaymentPlan],
        occurrences: [PaymentOccurrence],
        fx: FX,
        today: String = DateUtil.today(),
        count: Int = 6
    ) -> CardStatementResult {
        let plan = plan(for: account, in: plans)
        let resolved = BankRules.resolveCardDays(account: account, plan: plan)
        let liveTx = transactions.filter(\.isLive)
        let payments = CardPayments.assignCardPayments(accounts: accounts.filter(\.isLive), transactions: liveTx)[account.id] ?? []
        return buildCardStatements(
            account: account,
            transactions: liveTx,
            payments: payments,
            dueDay: plan?.dayOfMonth,
            minPayPct: effectiveMinPayPct(account),
            today: today,
            count: count,
            overrides: overrides(for: account, in: occurrences),
            days: resolved.days,
            fx: fx
        )
    }
}
