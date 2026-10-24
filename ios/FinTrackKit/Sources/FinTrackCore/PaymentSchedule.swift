import Foundation

/* ── Ödeme Takibi — kredi kartı ve borç ödemelerinin aylık çizelgesi ────────
   Kaynak (birebir): web src/lib/payments/schedule.ts (buildTargets,
   buildSchedule, summarizeRows, statementWindow, estimateStatement, ay
   yardımcıları) ve ids.ts. Testler schedule.test.ts, description.test.ts ve
   card-payments.test.ts'in takvim vakalarıyla aynı girdiler
   (PaymentScheduleTests.swift). Biri değişirse diğeri de değişmeli.

   SAF modül (store/DB yok). Bir "hedef" ya bir kredi kartı hesabıdır ya da bir
   borç (direction 'owe'). Her hedef için her ay tek bir ödeme satırı üretilir;
   satırın değerleri katmanlardan çözülür (üstteki kazanır):
     1. PaymentOccurrence — kullanıcının O AY için girdiği tutar/tarih/hesap
     2. PaymentPlan       — hedefin varsayılanları
     3. Borç alanları     — yalnız BORÇTA: monthlyPayment / accountId /
                            startDate günü

   KARTLARDA VARSAYIM YOK: kartın ödeme günü yalnızca plandan gelir
   (accounts.dueDay güvenilmez); plan günü yoksa kart "kurulum bekliyor"
   (needsSetup) olur ve HİÇ satır üretmez. Tutar yalnızca plan ya da ay
   kaydından gelir; yoksa nil ("tutar girilmedi"). estimateStatement yalnız
   düzenleme penceresinde etiketli bir KISAYOLDUR, satır tutarı olmaz.

   "Ödendi" iki kaynaktan gelir: elle işaret (occurrence.status) ya da OTOMATİK
   TESPİT — o ayın ödeme penceresine düşen işlenmiş ödeme işlemleri. Borçta:
   debtId'li işlemler. Kartta: CardPayments.assignCardPayments. Tespit hiçbir
   şey yazmaz. Takip başlangıcından önceki aylarda bulunan ödemeler geçmiş
   kaydı olarak görünür; takip dışı AÇIK ay satır üretmez (yığınla yanlış
   "gecikti" alarmı çıkmasın).

   Web'den farklar: kart bakiyesi web'de hesapta çalışma anında durur; burada
   `balances` (hesap id → kendi para biriminde bakiye) olarak verilir. Kurlar
   global değil, `fx` parametresiyle gelir. Silinmiş (deleted_at) satırlar web
   store'unda zaten yoktur; burada girdilerden süzülür.
─────────────────────────────────────────────────────────────────────────── */

// MARK: - Tipler

/// 'card' | 'debt' — payment_plans / payment_occurrences "targetKind" sütunu.
public enum PaymentTargetKind: String, Sendable, Hashable, CaseIterable {
    case card, debt
}

/// Satır tutarının kaynağı: ay kaydı, plan ya da borç alanlarından türetilmiş.
public enum PaymentAmountSource: String, Sendable, Hashable {
    case custom, plan, derived
}

public enum PaymentState: String, Sendable, Hashable, CaseIterable {
    /// ödenmedi
    case open
    /// bir kısmı ödendi (tespit)
    case partial
    case paid
    /// bu ay ödeme yok (kullanıcı atladı)
    case skipped
    /// ödenecek tutar yok (kullanıcı 0 girdi / borç tükendi)
    case clear
}

public enum PaymentTiming: String, Sendable, Hashable, CaseIterable {
    case overdue, today, soon, later, done
}

public enum PaymentPaidVia: String, Sendable, Hashable {
    case manual, detected
}

public struct PaymentTarget: Hashable, Sendable {
    /// "<kind>:<id>"
    public var key: String
    public var kind: PaymentTargetKind
    public var id: String
    public var name: String
    public var color: String
    public var icon: String?
    public var currency: CurrencyCode
    public var plan: PaymentPlan?
    public var isActive: Bool
    /// Plandaki ya da borçtan türetilen aylık tutar. Kartta plan tutarı yoksa
    /// nil — o zaman tutar her ay ayrıca girilir.
    public var defaultAmount: Double?
    public var defaultAmountSource: PaymentAmountSource?
    public var defaultFromAccountId: String?
    /// Kartta yalnız plandan gelir; nil = ödeme günü girilmedi.
    public var dayOfMonth: Int?
    /// Kart ödeme günü girilmedi → satır üretilmez, kurulum istenir.
    public var needsSetup: Bool
    public var startMonth: String
    public var endMonth: String?
    /// Kart: uygulamadaki bakiyeye göre borç (−bakiye, ≥ 0) — bankadaki gerçek
    /// borç DEĞİL. Borç: kalan tutar.
    public var outstanding: Double
    public var account: Account?
    public var debt: Debt?
}

public struct PaymentRowCustom: Hashable, Sendable {
    public var amount: Bool
    public var dueDate: Bool
    public var fromAccount: Bool

    public init(amount: Bool, dueDate: Bool, fromAccount: Bool) {
        self.amount = amount
        self.dueDate = dueDate
        self.fromAccount = fromAccount
    }
}

public struct PaymentRow: Hashable, Sendable, Identifiable {
    /// Ay kaydının kimliği; kayıt yoksa "<kind>:<targetId>:<ay>" (web ile aynı).
    public var id: String
    public var target: PaymentTarget
    public var month: String
    public var dueDate: String
    /// Bugünden vadeye takvim günü (negatif = geçti).
    public var daysLeft: Int
    /// Hedefin para biriminde. nil = tutar girilmedi.
    public var amount: Double?
    public var amountSource: PaymentAmountSource?
    public var fromAccountId: String?
    public var state: PaymentState
    public var timing: PaymentTiming
    public var paidAmount: Double
    public var paidDate: String?
    public var paidVia: PaymentPaidVia?
    /// Elle bağlanmış ya da otomatik tespit edilen ödeme işlemleri.
    public var transactionIds: [String]
    /// Kalan ödenecek (açık/kısmi satırlarda; diğerlerinde 0).
    public var remaining: Double
    public var custom: PaymentRowCustom
    /// Takip aralığı dışında (yalnız geçmiş kaydı olarak görünür).
    public var outOfRange: Bool
    public var note: String?
    public var occurrence: PaymentOccurrence?

    /// Açık ya da kısmi — ödenecek bir şey var.
    public var isActionable: Bool { PaymentSchedule.isActionable(state) }
}

public struct PaymentSummary: Hashable, Sendable {
    public var count: Int
    /// Ödenecek toplam (atlananlar hariç; ödenen tutar planı aştıysa ödenen).
    public var totalTry: Double
    public var paidTry: Double
    public var remainingTry: Double
    public var overdueCount: Int
    public var overdueTry: Double
    /// Tutarı girilmemiş açık satır sayısı — toplamlara girmez.
    public var unknownCount: Int
    /// Vadesi geçmemiş en yakın açık ödeme.
    public var next: PaymentRow?
}

// MARK: - Çizelge

public enum PaymentSchedule {
    /// Plan başlangıcı verilmemiş hedefler bu aydan önce gecikme üretmez (modülün
    /// yayına girdiği ay). Sabit olmalı: "bugünün ayı" olsaydı her ay başında
    /// önceki ay takip dışına düşerdi.
    public static let trackingEpoch = "2026-09"
    /// Bu kadar gün içinde vadesi gelen ödeme "yaklaşıyor" sayılır.
    public static let dueSoonDays = 7
    /// Ödeme penceresi vade gününden bu kadar gün sonrasına uzar (geç ödeme).
    public static let detectGraceDays = 7
    /// Borç hedeflerinin rengi — borçların kendi rengi yok.
    public static let debtColor = "#64748b"

    static let tr = Locale(identifier: "tr_TR")

    /// Web `a.localeCompare(b, 'tr') < 0`
    static func trLess(_ a: String, _ b: String) -> Bool {
        a.compare(b, locale: tr) == .orderedAscending
    }

    // MARK: Ay yardımcıları

    /// 'YYYY-MM'
    public static func monthOf(_ iso: String) -> String { String(iso.prefix(7)) }

    public static func shiftMonth(_ month: String, _ delta: Int) -> String {
        CardCycles.shiftMonthKey(month, delta)
    }

    static func yearMonth(_ month: String) -> (y: Int, m: Int) {
        let y = Int(month.prefix(4)) ?? 0
        let m = Int(month.dropFirst(5).prefix(2)) ?? 0
        return (y, m)
    }

    /// a'dan b'ye kaç ay (b − a).
    public static func monthDiff(_ a: String, _ b: String) -> Int {
        let (ay, am) = yearMonth(a), (by, bm) = yearMonth(b)
        return (by - ay) * 12 + bm - am
    }

    /// [from, to] aralığındaki aylar (ikisi dahil).
    public static func monthKeys(_ from: String, _ to: String) -> [String] {
        let n = monthDiff(from, to)
        return n < 0 ? [] : (0...n).map { shiftMonth(from, $0) }
    }

    public static func daysInMonth(_ month: String) -> Int { ISODay.daysIn(month) }

    public static func clampDay(_ day: Int) -> Int { min(31, max(1, day)) }

    /// Web `Math.min(31, Math.max(1, Math.round(day)))`
    public static func clampDay(_ day: Double) -> Int {
        clampDay(Int(Money.jsRound(day)))
    }

    /// Ayın `day`. günü; kısa aylarda ay sonuna sıkıştırılır (31 → 30 Eylül).
    public static func dueDateFor(_ month: String, _ day: Int) -> String {
        "\(month)-\(CardCycles.pad(min(clampDay(day), daysInMonth(month))))"
    }

    /// Web date-fns `differenceInCalendarDays(parseISO(a), parseISO(b))` = a − b.
    static func calendarDays(_ a: String, _ b: String) -> Int {
        guard let (ay, am, ad) = ISODay.parts(a), let (by, bm, bd) = ISODay.parts(b),
              let da = ISODay.date(ay, am, ad), let db = ISODay.date(by, bm, bd) else { return 0 }
        return DateUtil.calendar.dateComponents([.day], from: db, to: da).day ?? 0
    }

    // MARK: Kimlikler (ids.ts)

    /* Ödeme takibi kayıtlarının kimlikleri DETERMİNİSTİKTİR: aynı hedef için tek
       plan, aynı hedef + ay için tek kayıt olur. İki cihaz aynı ayı aynı anda
       düzenlese bile sync katmanı tek satıra upsert eder, kopya oluşmaz. */

    public static func planIdFor(_ kind: PaymentTargetKind, _ targetId: String) -> String {
        DeterministicID.uuid("payplan:\(kind.rawValue):\(targetId)")
    }

    public static func occurrenceIdFor(_ kind: PaymentTargetKind, _ targetId: String, _ month: String) -> String {
        DeterministicID.uuid("payocc:\(kind.rawValue):\(targetId):\(month)")
    }

    /// Bildirimden onaylanan ödeme işleminin kimliği — (hedef, ay) başına tek.
    /// Çift dokunuş ya da iki cihazdan onay ikinci transfer üretemez.
    public static func paymentTxIdFor(_ kind: PaymentTargetKind, _ targetId: String, _ month: String) -> String {
        DeterministicID.uuid("paytx:\(kind.rawValue):\(targetId):\(month)")
    }

    // MARK: Hedefler

    /// Arşivlenmemiş kredi kartları (ada göre) + ödenecek borçlar (ada göre).
    /// `balances`: hesap id → bakiye (hesabın kendi para biriminde); kart
    /// `outstanding` buradan gelir (yoksa 0).
    public static func buildTargets(accounts: [Account], debts: [Debt], plans: [PaymentPlan],
                                    balances: [String: Double] = [:]) -> [PaymentTarget] {
        var planBy: [String: PaymentPlan] = [:]
        for p in plans where p.isLive { planBy["\(p.targetKind):\(p.targetId)"] = p }   // web Map: son kazanır
        var cards: [PaymentTarget] = []
        var debtTargets: [PaymentTarget] = []

        for a in accounts where a.isLive {
            if a.type != .credit_card || a.isArchived { continue }
            let plan = planBy["card:\(a.id)"]
            let created = a.createdAt.isEmpty ? trackingEpoch : monthOf(a.createdAt)
            // account.dueDay KULLANILMAZ: formda alanı yok, her karta 10 yazılıyor.
            let day = plan?.dayOfMonth.map { clampDay($0) }
            cards.append(PaymentTarget(
                key: "card:\(a.id)", kind: .card, id: a.id, name: a.name, color: a.color, icon: a.icon,
                currency: a.currency, plan: plan, isActive: plan?.isActive ?? true,
                defaultAmount: plan?.amount,
                defaultAmountSource: plan?.amount != nil ? .plan : nil,
                defaultFromAccountId: plan?.fromAccountId,
                dayOfMonth: day, needsSetup: day == nil,
                startMonth: plan?.startMonth ?? max(trackingEpoch, created),
                endMonth: nil,
                outstanding: max(0, Money.round(-(balances[a.id] ?? 0))),
                account: a, debt: nil
            ))
        }

        for d in debts where d.isLive {
            if d.direction != "owe" { continue }
            let plan = planBy["debt:\(d.id)"]
            let first = monthOf(d.startDate)
            // Web `d.totalInstallments ? … : null` — 0 da "yok" sayılır
            let installments = d.totalInstallments.flatMap { $0 != 0 ? $0 : nil }
            let derived = d.monthlyPayment ?? installments.map { Money.round(d.totalAmount / Double($0)) }
            let startDay = Int(d.startDate.dropFirst(8).prefix(2)) ?? 0
            let amountSource: PaymentAmountSource? = plan?.amount != nil ? .plan : derived != nil ? .derived : nil
            debtTargets.append(PaymentTarget(
                key: "debt:\(d.id)", kind: .debt, id: d.id, name: d.name, color: debtColor, icon: nil,
                currency: .TRY,   // borçlar TRY bazlı (bkz. DebtPayments.pay)
                plan: plan, isActive: plan?.isActive ?? true,
                defaultAmount: plan?.amount ?? derived,
                defaultAmountSource: amountSource,
                defaultFromAccountId: plan?.fromAccountId ?? d.accountId,
                dayOfMonth: clampDay(plan?.dayOfMonth ?? (startDay > 0 ? startDay : 1)),
                needsSetup: false,
                startMonth: plan?.startMonth ?? max(trackingEpoch, first),
                endMonth: installments.map { shiftMonth(first, $0 - 1) },
                outstanding: max(0, Money.round(d.totalAmount - d.paidAmount)),
                account: nil, debt: d
            ))
        }

        return stableSorted(cards) { trLess($0.name, $1.name) }
            + stableSorted(debtTargets) { trLess($0.name, $1.name) }
    }

    /// JS Array.prototype.sort kararlıdır; Swift `sorted` değil — eşitlerde girdi sırası korunur.
    static func stableSorted<T>(_ items: [T], _ less: (T, T) -> Bool) -> [T] {
        items.enumerated()
            .sorted { less($0.element, $1.element) || (!less($1.element, $0.element) && $0.offset < $1.offset) }
            .map(\.element)
    }

    // MARK: Uygulamadaki kart harcamaları (yalnız kısayol önerisi)

    /// Vade gününden ÖNCEKİ son hesap kesiminde kapanan dönem. Kesim günü yoksa
    /// vadeden önceki takvim ayı. Kart Takvimi'nde bu aya / önceki aya özel kesim
    /// girildiyse (`closing` / `prevClosing`) o kullanılır — kural CardCycles ile aynı.
    public static func statementWindow(statementDay: Int?, dueDate: String,
                                       closing customClosing: String? = nil,
                                       prevClosing customPrev: String? = nil) -> StatementPeriod {
        let closing = customClosing ?? CardCycles.lastClosingBefore(dueDate, statementDay)
        let prevClosing = customPrev ?? CardCycles.lastClosingBefore(closing, statementDay)
        return StatementPeriod(from: ISODay.add(prevClosing, 1), to: closing)
    }

    /// Dönemde UYGULAMAYA GİRİLMİŞ net kart harcaması: gider + karttan çıkan
    /// transfer − karta işlenen gelir/iade. Karta YAPILAN ödemeler (toAccountId =
    /// kart) ve mutabakat satırları sayılmaz. Bankanın ekstre tutarı değildir —
    /// yalnız düzenleme penceresinde etiketli kısayol olarak gösterilir.
    public static func estimateStatement(account: Account, dueDate: String, transactions: [Transaction],
                                         closing: String? = nil, prevClosing: String? = nil, fx: FX) -> Double {
        let w = statementWindow(statementDay: account.statementDay, dueDate: dueDate,
                                closing: closing, prevClosing: prevClosing)
        let charges = transactions.filter { t in
            if t.accountId != account.id || !(t.systemKind ?? "").isEmpty { return false }
            let d = String(t.date.prefix(10))
            return d >= w.from && d <= w.to
        }
        let total = Money.sum(charges) { t in
            (t.type == .income ? -1 : 1) * CardStatements.inCurrency(t, account.currency, fx: fx)
        }
        return max(0, total)
    }

    // MARK: Ödeme satırları

    public static func isActionable(_ state: PaymentState) -> Bool { state == .open || state == .partial }
    public static func isActionable(_ row: PaymentRow) -> Bool { isActionable(row.state) }

    /// Ödeme işleminin açıklaması: kartta "Kredi Kartı Ödemesi", borçta "<borç
    /// adı> Ödemesi" — ör. "İhtiyaç Kredisi Ödemesi". Ad zaten "ödeme(si)" ile
    /// bitiyorsa tekrar eklenmez.
    public static func paymentDescription(kind: PaymentTargetKind, name: String) -> String {
        if kind == .card { return "Kredi Kartı Ödemesi" }
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let ends = n.range(of: "ödeme(si)?$", options: [.regularExpression, .caseInsensitive]) != nil
        return ends ? n : "\(n) Ödemesi"
    }

    public static func paymentDescription(_ target: PaymentTarget) -> String {
        paymentDescription(kind: target.kind, name: target.name)
    }

    static func occKey(_ kind: String, _ targetId: String, _ month: String) -> String {
        "\(kind):\(targetId):\(month)"
    }

    /// [from, to] aylarındaki ödeme satırları, vade tarihine göre sıralı.
    /// Pasif (takipten çıkarılmış) ve ödeme günü girilmemiş hedefler satır üretmez.
    /// - cardPayments: `CardPayments.assignCardPayments(TÜM hesaplar, işlemler)`.
    ///   Hedef listesi filtrelenmişse (kapsam, tek hedef) mutlaka verilmeli —
    ///   yoksa "tek kart" kuralı yalnız verilen hedeflere bakar ve belirsiz
    ///   ödemeyi yanlış karta yazabilir.
    public static func buildSchedule(
        targets: [PaymentTarget],
        occurrences: [PaymentOccurrence],
        transactions: [Transaction],
        from: String,
        to: String,
        today: String,
        cardPayments: [String: [Transaction]]? = nil,
        fx: FX
    ) -> [PaymentRow] {
        if monthDiff(from, to) < 0 { return [] }
        let liveTx = transactions.filter(\.isLive)

        let cardPayments = cardPayments
            ?? CardPayments.assignCardPayments(accounts: targets.compactMap(\.account), transactions: liveTx)

        var occBy: [String: PaymentOccurrence] = [:]
        var linked = Set<String>()
        for o in occurrences where o.isLive {
            occBy[occKey(o.targetKind, o.targetId, o.month)] = o
            if let tid = o.transactionId, !tid.isEmpty { linked.insert(tid) }
        }

        var rows: [PaymentRow] = []

        for target in targets {
            guard target.isActive, let day = target.dayOfMonth else { continue }
            let kind = target.kind.rawValue
            func occOf(_ m: String) -> PaymentOccurrence? { occBy[occKey(kind, target.id, m)] }
            // Kart: son ödeme her ay kesim + fark'tan, tatil kuralıyla (Kart Takvimi
            // ile aynı — CardCycles). Borç: plandaki sabit gün.
            let cardDays: CardDays? = target.kind == .card
                ? target.account.map { BankRules.resolveCardDays(account: $0, plan: target.plan).days }
                : nil
            var dueCache: [String: String] = [:]
            func dueOf(_ m: String) -> String {
                if let hit = dueCache[m] { return hit }
                let o = occOf(m)
                let due: String
                if let cardDays {
                    let prevO = occOf(shiftMonth(m, -1))
                    let ov = o.map { CycleOverride(statementDate: $0.statementDate, dueDate: $0.dueDate) }
                    let prevOv = prevO.map { CycleOverride(statementDate: $0.statementDate, dueDate: $0.dueDate) }
                    due = CardCycles.cardCycle(cardDays, m, override: ov, prevOverride: prevOv).dueDate
                        ?? o?.dueDate ?? dueDateFor(m, day)
                } else {
                    due = o?.dueDate ?? dueDateFor(m, day)
                }
                dueCache[m] = due
                return due
            }
            // Yalnız işlenmiş ödemeler "ödendi" sayılır — ileri tarihli planlı
            // transfer henüz ödeme değildir.
            let candidates = target.kind == .card
                ? (cardPayments[target.id] ?? [])
                : liveTx.filter { $0.debtId == target.id }
            let payments = candidates.filter { Calc.isPosted($0, asOf: today) }
            func paymentValue(_ t: Transaction) -> Double {
                target.kind == .card ? CardStatements.inCurrency(t, target.currency, fx: fx) : fx.baseAmount(t)
            }
            // Borç: kalan tutarın, sıradaki açık aylara zaten ayrılmış kısmı. Takip
            // başlangıcından yürümek için gezinti aralığın başından ÖNCE başlayabilir.
            var consumed = 0.0
            let walkFrom = from < target.startMonth ? from : target.startMonth

            for month in monthKeys(walkFrom, to) {
                let occ = occOf(month)
                let prev = shiftMonth(month, -1)
                let dueDate = dueOf(month)
                let prevDue = dueOf(prev)
                let tracked = month >= target.startMonth && (target.endMonth.map { month <= $0 } ?? true)

                // Ödeme penceresi (önceki vade + ek süre, bu vade + ek süre] — ardışık
                // aylar örtüşmez, arada boşluk da kalmaz. Elle bir aya bağlanmış işlem
                // başka ayda tespit edilmez.
                let winFrom = ISODay.add(prevDue, detectGraceDays)
                let winTo = ISODay.add(dueDate, detectGraceDays)
                let detected = payments.filter { t in
                    if linked.contains(t.id) { return false }
                    let d = String(t.date.prefix(10))
                    return d > winFrom && d <= winTo
                }
                let detectedSum = Money.sum(detected, paymentValue)

                var amount: Double?
                var amountSource: PaymentAmountSource?
                if let a = occ?.amount {
                    amount = a
                    amountSource = .custom
                } else if let a = target.defaultAmount {
                    amount = a
                    amountSource = target.defaultAmountSource
                }

                var state: PaymentState
                var paidAmount = 0.0
                var paidDate: String?
                var paidVia: PaymentPaidVia?
                var transactionIds: [String] = []

                if let occ, occ.status == "paid" {
                    state = .paid
                    paidVia = .manual
                    paidAmount = occ.paidAmount ?? amount ?? 0
                    paidDate = occ.paidDate
                    transactionIds = occ.transactionId.flatMap { $0.isEmpty ? nil : [$0] } ?? []
                } else if occ?.status == "skipped" {
                    state = .skipped
                } else if detectedSum > 0 {
                    paidVia = .detected
                    paidAmount = detectedSum
                    paidDate = detected.reduce("") { m, t in
                        let d = String(t.date.prefix(10))
                        return d > m ? d : m
                    }
                    transactionIds = detected.map(\.id)
                    state = (amount.map { detectedSum >= $0 } ?? true) ? .paid : .partial
                } else {
                    state = amount == 0 ? .clear : .open
                }

                var remaining = 0.0
                if isActionable(state), let a = amount { remaining = max(0, Money.round(a - paidAmount)) }

                // Borç: kalan tutar tükenince açık aylar biter, son taksit küçülür.
                if target.kind == .debt && tracked && isActionable(state) && amount != nil {
                    let cap = max(0, Money.round(target.outstanding - consumed))
                    if remaining > cap {
                        remaining = cap
                        amount = Money.round(paidAmount + cap)
                        if remaining == 0 { state = state == .partial ? .paid : .clear }
                    }
                    consumed = Money.round(consumed + remaining)
                }

                if month < from { continue }

                let actionable = isActionable(state)
                if occ == nil {
                    // Takip dışı açık ay ya da tükenmiş borç: satır yok.
                    if !tracked && (actionable || state == .clear) { continue }
                    if target.kind == .debt && state == .clear { continue }
                }

                let daysLeft = calendarDays(dueDate, today)
                let timing: PaymentTiming = actionable && tracked
                    ? (daysLeft < 0 ? .overdue : daysLeft == 0 ? .today : daysLeft <= dueSoonDays ? .soon : .later)
                    : .done

                rows.append(PaymentRow(
                    id: occ?.id ?? "\(target.key):\(month)",
                    target: target,
                    month: month,
                    dueDate: dueDate,
                    daysLeft: daysLeft,
                    amount: amount,
                    amountSource: amountSource,
                    fromAccountId: occ?.fromAccountId ?? target.defaultFromAccountId,
                    state: state,
                    timing: timing,
                    paidAmount: paidAmount,
                    paidDate: paidDate,
                    paidVia: paidVia,
                    transactionIds: transactionIds,
                    remaining: remaining,
                    custom: PaymentRowCustom(amount: occ?.amount != nil, dueDate: occ?.dueDate != nil,
                                             fromAccount: occ?.fromAccountId != nil),
                    outOfRange: !tracked,
                    note: occ?.note,
                    occurrence: occ
                ))
            }
        }

        return stableSorted(rows) { a, b in
            a.dueDate != b.dueDate ? a.dueDate < b.dueDate : trLess(a.target.name, b.target.name)
        }
    }

    // MARK: Özet

    public static func summarizeRows(_ rows: [PaymentRow], fx: FX) -> PaymentSummary {
        let live = rows.filter { $0.state != .skipped }
        let open = rows.filter(\.isActionable)
        let overdue = open.filter { $0.timing == .overdue }
        func tryOf(_ r: PaymentRow, _ v: Double) -> Double { fx.toBaseTry(v, r.target.currency) }
        let upcoming = open.filter { $0.timing != .overdue && $0.timing != .done }
        return PaymentSummary(
            count: rows.count,
            totalTry: Money.sum(live) { tryOf($0, max($0.amount ?? 0, $0.paidAmount)) },
            paidTry: Money.sum(live) { tryOf($0, $0.paidAmount) },
            remainingTry: Money.sum(open) { tryOf($0, $0.remaining) },
            overdueCount: overdue.count,
            overdueTry: Money.sum(overdue) { tryOf($0, $0.remaining) },
            unknownCount: open.filter { $0.amount == nil }.count,
            next: stableSorted(upcoming) { $0.dueDate < $1.dueDate }.first
        )
    }
}
